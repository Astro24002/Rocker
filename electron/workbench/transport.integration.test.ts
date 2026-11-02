import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "../ssh/test-fixtures/ssh-server"
import { SshConnectionManager } from "../ssh/connection-manager"
import { createCodexTransport, quoteShell } from "./transport"
import { CodexRpc } from "./rpc"
import { record, type WorkbenchProfile } from "./types"

const owner = { webContentsId: 91, rendererGeneration: 1 }
function manager(port: number) {
  return new SshConnectionManager({
    resolve: async () => ({ host: "127.0.0.1", port, username: TEST_USERNAME, password: TEST_PASSWORD, authMethod: "password", readyTimeoutMs: 2000, securityContextKey: "workbench-test" }),
    inspectHostKey: async (_request, fingerprint) => ({ status: "match", fingerprint }),
    promptForHostKey: async () => true
  })
}

describe("Codex SSH transport", () => {
  it("uses non-PTY exec, quotes paths, and releases only its own lease", async () => {
    const commands: string[] = []
    const fixture = await createSshTestServer({ onExec(command, channel) {
      commands.push(command)
      channel.on("error", () => undefined)
      channel.on("data", (data: Buffer) => { channel.write(data) })
    } })
    const connections = manager(fixture.port), controller = new AbortController()
    const sibling = await connections.acquire({ hostId: "host", owner, kind: "terminal" })
    try {
      const transport = await createCodexTransport({ id: "p", name: "Project", source: "remote", hostId: "host", cwd: "/home/a b/it's", executable: "/bin/codex" }, owner, connections, controller.signal)
      const received = vi.fn(); transport.onData(received); transport.onClose(vi.fn())
      transport.write("protocol\n")
      await vi.waitFor(() => expect(received).toHaveBeenCalled())
      expect(fixture.ptyRequests).toHaveLength(0)
      expect(commands).toEqual([`cd -- ${quoteShell("/home/a b/it's")} && exec '/bin/codex' app-server --listen stdio://`])
      transport.close(); transport.close()
      await vi.waitFor(() => expect(fixture.resourceSnapshot().shells).toBe(0))
      expect(() => connections.getClientForConnection(sibling.connectionId)).not.toThrow()
    } finally { controller.abort(); await connections.releaseWebContents(owner.webContentsId); await fixture.close() }
  })

  it.skipIf(process.env.ROCKER_CODEX_SMOKE !== "1")("runs installed Codex locally and through SSH, without a model turn", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-codex-smoke-"))
    const fixture = await createSshTestServer({ onExec(_command, channel) {
      const child = spawn("codex", ["app-server", "--listen", "stdio://"], { cwd: directory, stdio: ["pipe", "pipe", "pipe"] })
      channel.on("error", () => undefined); child.stdin.on("error", () => undefined)
      channel.pipe(child.stdin); child.stdout.pipe(channel); child.stderr.pipe(channel.stderr)
      channel.once("close", () => { child.stdin.end(); child.kill() })
      child.once("close", () => channel.close())
    } })
    const connections = manager(fixture.port)
    try {
      for (const source of ["local", "remote"] as const) {
        const controller = new AbortController()
        const profile: WorkbenchProfile = { id: source, name: source, source, hostId: "host", cwd: directory, executable: "codex" }
        let output = ""
        const rpc = new CodexRpc(await createCodexTransport(profile, owner, connections, controller.signal), message => {
          if (message.method === "command/exec/outputDelta") output += Buffer.from(String(record(message.params).deltaBase64), "base64").toString()
        }, () => undefined)
        try {
          await rpc.request("initialize", { clientInfo: { name: "rocker_test", version: "0.1" }, capabilities: { experimentalApi: true } })
          rpc.notify("initialized")
          const result = record(await rpc.request("thread/start", { cwd: directory, ephemeral: true, approvalPolicy: "on-request", sandbox: "workspace-write" }))
          expect(record(result.thread).id).toEqual(expect.any(String))
          const shell = rpc.request("command/exec", { command: ["/bin/sh"], cwd: directory, processId: source, tty: true, disableTimeout: true, size: { rows: 24, cols: 80 } }, 0)
          // Register rejection immediately so test failures cannot leave unhandled work.
          const completed = shell.catch(error => error as Error)
          await vi.waitFor(() => expect(output.length).toBeGreaterThan(0), { timeout: 10_000 })
          await rpc.request("command/exec/resize", { processId: source, size: { rows: 30, cols: 100 } })
          await rpc.request("command/exec/write", { processId: source, deltaBase64: Buffer.from("printf 'ROCKER_%s_OK\\n' smoke\n").toString("base64") })
          await vi.waitFor(() => expect(output).toContain("ROCKER_smoke_OK"), { timeout: 5000 })
          await rpc.request("command/exec/terminate", { processId: source })
          expect(await completed).not.toBeInstanceOf(Error)
        } finally { rpc.close(); controller.abort() }
      }
    } finally { await connections.releaseWebContents(owner.webContentsId); await fixture.close(); await rm(directory, { recursive: true, force: true }) }
  }, 40_000)
})
