import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import { PassThrough } from "node:stream"
import type { ClientChannel } from "ssh2"
import type { SshConnectionManager } from "../ssh/connection-manager"
import type { RuntimeOwner } from "../runtime/owner"
import type { CodexTransport } from "./rpc"
import type { WorkbenchProfile } from "./types"

export const quoteShell = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export function codexCommand(executable: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const args = ["app-server", "--listen", "stdio://"]
  if (process.platform === "win32") {
    const shim = executable === "codex"
      ? (process.env.PATH ?? "").split(delimiter).map(p => join(p, "codex.cmd")).find(existsSync)
      : executable.endsWith(".cmd") ? executable : undefined
    if (shim) {
      const script = join(dirname(shim), "node_modules", "@openai", "codex", "bin", "codex.js")
      if (!existsSync(script)) throw new Error("Select the Codex executable installed by @openai/codex")
      return { command: process.execPath, args: [script, ...args], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }
    }
  }
  return { command: executable, args, env: process.env }
}

export async function createCodexTransport(profile: WorkbenchProfile, owner: RuntimeOwner, connections: Pick<SshConnectionManager, "acquire" | "release" | "getClientForConnection">, signal: AbortSignal): Promise<CodexTransport> {
  const output = new PassThrough()
  let failure: Error | undefined
  let failureListener: ((error: Error) => void) | undefined
  let stderr = ""
  let disposed = false
  let cleanup = (): void => {}
  const dispose = (): void => { if (disposed) return; disposed = true; signal.removeEventListener("abort", aborted); cleanup() }
  const fail = (error: Error): void => { if (failure) return; failure = error; dispose(); failureListener?.(error) }
  const appendError = (data: Buffer): void => { stderr = (stderr + data.toString()).slice(-2000) }
  const aborted = (): void => fail(new Error("Codex connection cancelled"))
  const closed = (): void => fail(new Error(stderr.trim() || "Codex connection closed. Reconnect explicitly to resume the conversation."))
  let write: (data: string) => void
  if (profile.source === "local") {
    const command = codexCommand(profile.executable)
    const child = spawn(command.command, command.args, { cwd: profile.cwd, env: command.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    child.stdout.pipe(output); child.stderr.on("data", appendError)
    child.on("error", fail); child.on("close", closed); child.stdin.on("error", fail)
    cleanup = () => { child.stdin.end(); child.kill() }
    write = data => { child.stdin.write(data) }
  } else {
    const lease = await connections.acquire({ hostId: profile.hostId!, owner, kind: "codex", signal })
    let channel: ClientChannel | undefined
    cleanup = () => { channel?.close(); void connections.release(lease.id).catch(() => undefined) }
    try {
      channel = await new Promise<ClientChannel>((resolve, reject) => {
        let done = false
        const finish = (): void => { clearTimeout(timer); signal.removeEventListener("abort", cancel) }
        const cancel = (): void => { done = true; finish(); reject(new Error("Codex connection cancelled")) }
        const timer = setTimeout(() => { done = true; finish(); reject(new Error("Codex SSH channel timed out")) }, 15_000)
        signal.addEventListener("abort", cancel, { once: true })
        if (signal.aborted) { cancel(); return }
        try {
          connections.getClientForConnection(lease.connectionId).exec(`cd -- ${quoteShell(profile.cwd)} && exec ${quoteShell(profile.executable)} app-server --listen stdio://`, (error, opened) => {
            finish()
            if (done || signal.aborted) { opened?.on("error", () => undefined); opened?.close(); return }
            done = true
            if (error) reject(error)
            else {
              channel = opened
              // A channel can fail before the awaiting caller resumes.
              opened.on("error", fail); opened.on("close", closed)
              resolve(opened)
            }
          })
        } catch (error) { done = true; finish(); reject(error) }
      })
    } catch (error) { dispose(); throw error }
    channel.pipe(output); channel.stderr.on("data", appendError)
    channel.stderr.on("error", fail)
    write = data => { channel?.write(data) }
  }
  signal.addEventListener("abort", aborted, { once: true })
  if (signal.aborted) aborted()
  return { write, close: dispose, onData: listener => { output.on("data", listener) }, onClose: listener => { failureListener = listener; if (failure) listener(failure) } }
}
