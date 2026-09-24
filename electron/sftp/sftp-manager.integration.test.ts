import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { normalizeRemotePath, SftpManager } from "./sftp-manager"
import { SshConnectionManager, type ResolvedConnectionRequest } from "../ssh/connection-manager"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "../ssh/test-fixtures/ssh-server"
import type { RuntimeOwner } from "../runtime/owner"

const owner: RuntimeOwner = { webContentsId: 41, rendererGeneration: 1 }
const managers: SftpManager[] = []
const connections: SshConnectionManager[] = []
const fixtures: Array<{ close(): Promise<void>; resourceSnapshot(): { clients: number; sessions: number; shells: number; forwards: number } }> = []
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.releaseOwner(owner)))
  await Promise.all(connections.splice(0).map((connection) => connection.releaseOwner(owner)))
  const closing = fixtures.splice(0)
  await Promise.all(closing.map((fixture) => fixture.close()))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  for (const fixture of closing) expect(fixture.resourceSnapshot()).toEqual({ clients: 0, sessions: 0, shells: 0, forwards: 0 })
})

describe("SftpManager", () => {
  it("resolves the server's home directory for a new workspace without changing explicit paths", async () => {
    const fixture = await createSshTestServer({ sftpHome: "/home/rocker-test", sftpFiles: { "/home/rocker-test/hello.txt": "hello" } })
    fixtures.push(fixture)
    const { manager } = createManager(fixture.port)
    const workspace = await manager.open("00000000-0000-4000-8000-000000000104", "fixture", owner)

    const home = await manager.list(workspace.workspaceId, ".", owner)
    expect(home.path).toBe("/home/rocker-test")
    expect(home.entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "hello.txt", path: "/home/rocker-test/hello.txt" })]))
    expect((await manager.list(workspace.workspaceId, "/", owner)).path).toBe("/")
  })

  it("shares the verified SSH transport and performs real directory operations", async () => {
    const fixture = await createSshTestServer({ sftpFiles: { "/docs/guide.txt": "guide" } })
    fixtures.push(fixture)
    const { manager, connectionManager } = createManager(fixture.port)
    const terminalLease = await connectionManager.acquire({ hostId: "fixture", owner, kind: "terminal" })
    const workspace = await manager.open("00000000-0000-4000-8000-000000000101", "fixture", owner)

    expect(workspace.connectionId).toBe(terminalLease.connectionId)
    expect(connectionManager.resourceSnapshot()).toMatchObject({ connections: 1, leases: 2 })

    const root = await manager.list(workspace.workspaceId, "/", owner)
    expect(root.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(["README.txt", "docs"]))
    await manager.mkdir(workspace.workspaceId, "/created", owner)
    expect((await manager.list(workspace.workspaceId, "/", owner)).entries.map((entry) => entry.name)).toContain("created")
    await manager.rename(workspace.workspaceId, "/docs/guide.txt", "/docs/renamed.txt", owner)
    expect((await manager.list(workspace.workspaceId, "/docs", owner)).entries.map((entry) => entry.name)).toContain("renamed.txt")
    await manager.remove(workspace.workspaceId, "/created", "directory", owner)
    expect((await manager.list(workspace.workspaceId, "/", owner)).entries.map((entry) => entry.name)).not.toContain("created")

    await connectionManager.release(terminalLease.id)
  })

  it("rejects remote traversal instead of silently resolving it", () => {
    expect(() => normalizeRemotePath("/../etc/passwd")).toThrow("Remote path traversal is not allowed")
    expect(() => normalizeRemotePath("docs/../../etc")).toThrow("Remote path traversal is not allowed")
  })

  it("runs file and folder moves as non-blocking transfer tasks", async () => {
    const fixture = await createSshTestServer({ sftpFiles: { "/docs/guide.txt": "guide" } })
    fixtures.push(fixture)
    const { manager } = createManager(fixture.port)
    const workspace = await manager.open("00000000-0000-4000-8000-000000000105", "fixture", owner)

    const fileMove = await manager.move(workspace.workspaceId, "/docs/guide.txt", "/docs/moved.txt", "file", owner)
    expect(fileMove).toMatchObject({ kind: "started", task: { direction: "move", sourcePath: "/docs/guide.txt", remotePath: "/docs/moved.txt", entryType: "file" } })
    if (fileMove.kind !== "started") throw new Error("Expected file move task")
    await waitFor(() => manager.listTransfers(owner).some((task) => task.id === fileMove.task.id && task.status === "completed"))

    const folderMove = await manager.move(workspace.workspaceId, "/docs", "/archive", "directory", owner)
    expect(folderMove).toMatchObject({ kind: "started", task: { direction: "move", sourcePath: "/docs", remotePath: "/archive", entryType: "directory" } })
    if (folderMove.kind !== "started") throw new Error("Expected folder move task")
    await waitFor(() => manager.listTransfers(owner).some((task) => task.id === folderMove.task.id && task.status === "completed"))

    const archive = await manager.list(workspace.workspaceId, "/archive", owner)
    expect(archive.entries.map((entry) => entry.name)).toContain("moved.txt")
  })

  it("uploads and downloads real files with overwrite confirmation", async () => {
    const fixture = await createSshTestServer()
    fixtures.push(fixture)
    const { manager } = createManager(fixture.port)
    const workspace = await manager.open("00000000-0000-4000-8000-000000000102", "fixture", owner)
    const localDirectory = await mkdtemp(join(tmpdir(), "rocker-sftp-test-"))
    temporaryDirectories.push(localDirectory)
    const sourcePath = join(localDirectory, "payload.txt")
    await writeFile(sourcePath, "payload from Rocker\n", "utf8")

    const uploadSelection = await manager.selectUpload(workspace.workspaceId, "/", sourcePath, owner)
    const upload = await manager.upload(uploadSelection.selectionId, false, owner)
    expect(upload.kind).toBe("started")
    expect(upload).toMatchObject({ kind: "started", task: { sourcePath, entryType: "file" } })
    await waitFor(() => manager.listTransfers(owner).some((task) => task.id === (upload.kind === "started" ? upload.task.id : "") && task.status === "completed"))

    const duplicateSelection = await manager.selectUpload(workspace.workspaceId, "/", sourcePath, owner)
    await expect(manager.upload(duplicateSelection.selectionId, false, owner)).resolves.toMatchObject({ kind: "overwrite-required", path: "/payload.txt" })
    expect(await manager.upload(duplicateSelection.selectionId, true, owner)).toMatchObject({ kind: "started" })

    const targetPath = join(localDirectory, "downloaded.txt")
    const downloadSelection = await manager.selectDownload(workspace.workspaceId, "/payload.txt", targetPath, owner)
    const download = await manager.download(downloadSelection.selectionId, false, owner)
    expect(download.kind).toBe("started")
    await waitFor(() => manager.listTransfers(owner).some((task) => task.id === (download.kind === "started" ? download.task.id : "") && task.status === "completed"))
    await expect(readFile(targetPath, "utf8")).resolves.toBe("payload from Rocker\n")
  })

  it("keeps a transfer alive when its visible SFTP workspace closes", async () => {
    const fixture = await createSshTestServer()
    fixtures.push(fixture)
    const { manager, connectionManager } = createManager(fixture.port)
    const workspace = await manager.open("00000000-0000-4000-8000-000000000103", "fixture", owner)
    const localDirectory = await mkdtemp(join(tmpdir(), "rocker-sftp-test-"))
    temporaryDirectories.push(localDirectory)
    const sourcePath = join(localDirectory, "background.txt")
    await writeFile(sourcePath, "transfer remains owned by the main process\n", "utf8")
    const selection = await manager.selectUpload(workspace.workspaceId, "/", sourcePath, owner)
    const started = await manager.upload(selection.selectionId, true, owner)
    if (started.kind !== "started") throw new Error("Expected upload task")

    await manager.close(workspace.workspaceId, owner)
    await waitFor(() => manager.listTransfers(owner).some((task) => task.id === started.task.id && task.status === "completed"))
    expect(connectionManager.resourceSnapshot().leases).toBe(0)
  })
})

function createManager(port: number): { manager: SftpManager; connectionManager: SshConnectionManager } {
  const resolved: ResolvedConnectionRequest = {
    host: "127.0.0.1",
    port,
    username: TEST_USERNAME,
    authMethod: "password",
    password: TEST_PASSWORD,
    readyTimeoutMs: 2_000,
    securityContextKey: "sftp-integration"
  }
  const trusted = new Set<string>()
  const connectionManager = new SshConnectionManager({
    resolve: async () => resolved,
    inspectHostKey: async (_request, fingerprint) => trusted.has(fingerprint) ? { status: "match", fingerprint } : { status: "unknown", fingerprint },
    promptForHostKey: async () => true,
    trustHostKey: async (_host, _port, fingerprint) => { trusted.add(fingerprint) }
  })
  const manager = new SftpManager(connectionManager)
  managers.push(manager)
  connections.push(connectionManager)
  return { manager, connectionManager }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for SFTP transfer")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
