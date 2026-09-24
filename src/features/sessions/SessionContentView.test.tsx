import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import type { SftpWorkspaceSession } from "../terminal/session-state"
import { SessionContentView } from "./SessionContentView"

const session: SftpWorkspaceSession = {
  id: "00000000-0000-4000-8000-000000000201",
  hostId: "host-a",
  label: "Server A",
  kind: "sftp",
  state: "idle",
  browser: { path: "/", entries: [], loading: false }
}

describe("SessionContentView SFTP", () => {
  it("loads a real bridge directory and keeps keyboard navigation available", async () => {
    const open = vi.fn(async () => ({ workspaceId: session.id, hostId: session.hostId, connectionId: "connection-a", state: "ready" as const }))
    const list = vi.fn(async () => ({
      path: "/",
      entries: [
        { name: "docs", path: "/docs", type: "directory" as const },
        { name: "README.txt", path: "/README.txt", type: "file" as const, size: 12 }
      ]
    }))
    const bridge = {
      sftp: {
        listLocal: vi.fn(async () => ({ path: "/home/test", entries: [] })),
        open,
        close: vi.fn(async () => undefined),
        list,
        mkdir: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        chooseUpload: vi.fn(async () => undefined),
        chooseDownload: vi.fn(async () => undefined),
        upload: vi.fn(),
        download: vi.fn(),
        listTransfers: vi.fn(async () => []),
        cancelTransfer: vi.fn(async () => undefined),
        retryTransfer: vi.fn()
      },
      events: { onSftpEvent: vi.fn(() => () => undefined) }
    } as unknown as RockerBridge
    const onPatch = vi.fn()

    const rendered = render(<I18nProvider><SessionContentView session={session} bridge={bridge} onPatch={onPatch} /></I18nProvider>)

    await waitFor(() => expect(list).toHaveBeenCalledWith(session.id, "/"))
    const directory = await list()
    rendered.rerender(<I18nProvider><SessionContentView session={{ ...session, state: "connected", browser: { path: directory.path, entries: directory.entries, loading: false } }} bridge={bridge} onPatch={onPatch} /></I18nProvider>)
    expect(screen.getByText("README.txt")).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("button", { name: "docs" }), { key: "Enter" })
    expect(onPatch).toHaveBeenCalledWith(session.id, expect.objectContaining({ kind: "sftp", browser: expect.objectContaining({ path: "/docs" }) }))
  })

  it("renames entries and queues files dropped onto the remote directory", async () => {
    const open = vi.fn(async () => ({ workspaceId: session.id, hostId: session.hostId, connectionId: "connection-a", state: "ready" as const }))
    const list = vi.fn(async () => ({
      path: "/",
      entries: [{
        name: "README.txt",
        path: "/README.txt",
        type: "file" as const,
        size: 12,
        modifiedAt: "2026-09-18T00:00:00.000Z",
        permissions: 0o100644,
        uid: 1000,
        gid: 1000
      }]
    }))
    const rename = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const chooseUpload = vi.fn(async (_workspaceId: string, _remoteDirectory: string, localPath?: string) => ({
      selectionId: localPath ? "dropped-selection" : "button-selection",
      workspaceId: session.id,
      name: "payload.txt",
      size: 7,
      remotePath: "/payload.txt"
    }))
    const upload = vi.fn(async () => ({
      kind: "started" as const,
      task: {
        id: "task-1",
        workspaceId: session.id,
        hostId: session.hostId,
        direction: "upload" as const,
        name: "payload.txt",
        remotePath: "/payload.txt",
        status: "queued" as const,
        bytesTransferred: 0,
        totalBytes: 7,
        attempt: 1,
        createdAt: "2026-09-18T00:00:00.000Z",
        updatedAt: "2026-09-18T00:00:00.000Z"
      }
    }))
    const bridge = {
      sftp: {
        listLocal: vi.fn(async () => ({ path: "/home/test", entries: [] })),
        open,
        close: vi.fn(async () => undefined),
        list,
        mkdir: vi.fn(async () => undefined),
        rename,
        remove,
        chooseUpload,
        chooseDownload: vi.fn(async () => undefined),
        upload,
        download: vi.fn(),
        listTransfers: vi.fn(async () => []),
        cancelTransfer: vi.fn(async () => undefined),
        retryTransfer: vi.fn()
      },
      events: { onSftpEvent: vi.fn(() => () => undefined) }
    } as unknown as RockerBridge
    const onPatch = vi.fn()
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("renamed.txt")
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const file = new File(["payload"], "payload.txt")
    Object.defineProperty(file, "path", { value: "/tmp/payload.txt" })

    render(<I18nProvider><SessionContentView session={{ ...session, state: "connected", browser: { ...session.browser, entries: await list().then((result) => result.entries) } }} bridge={bridge} onPatch={onPatch} /></I18nProvider>)

    await waitFor(() => expect(screen.getByText("README.txt")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith(session.id, "/README.txt", "/renamed.txt"))
    fireEvent.drop(screen.getByRole("region", { name: "Remote directory" }), { dataTransfer: { files: [file] } })
    await waitFor(() => expect(chooseUpload).toHaveBeenCalledWith(session.id, "/", "/tmp/payload.txt"))
    expect(screen.getByText("0644")).toBeInTheDocument()
    expect(screen.getByText("1000:1000")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(session.id, "/README.txt", "file"))
    expect(confirm).toHaveBeenCalledTimes(2)
    prompt.mockRestore()
    confirm.mockRestore()
  })
})
