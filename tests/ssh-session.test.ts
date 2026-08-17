import { generateKeyPairSync } from "node:crypto"
import { once } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { Server } from "ssh2"
import { SshManager, type SessionEvent } from "../electron/ssh/ssh-manager"
import type { HostKeyStore } from "../electron/ssh/host-keys"

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close()
      await once(server, "close")
    }
  }))
})

describe("SSH sessions", () => {
  it("opens a PTY, streams output, accepts input, and closes", async () => {
    const hostKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs1" },
      publicKeyEncoding: { format: "pem", type: "spki" }
    }).privateKey
    const server = new Server({ hostKeys: [hostKey] })
    servers.push(server)
    server.on("connection", (client) => {
      client.on("authentication", (context) => {
        if (context.method === "password" && context.password === "secret") {
          context.accept()
        } else {
          context.reject()
        }
      })
      client.on("ready", () => {
        client.on("session", (accept) => {
          const session = accept()
          session.on("pty", (acceptPty) => acceptPty())
          session.on("shell", (acceptShell) => {
            const stream = acceptShell()
            stream.write("welcome\\n")
            stream.on("data", (data: Buffer) => stream.write(`echo:${data.toString()}`))
          })
        })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve())
      server.once("error", reject)
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("mock server did not expose a port")

    const fingerprints = new Map<string, string>()
    const hostKeys: HostKeyStore = {
      get: async (host, port) => fingerprints.get(`${host}:${port}`),
      trust: async (host, port, fingerprint) => {
        fingerprints.set(`${host}:${port}`, fingerprint)
      }
    }
    const events: SessionEvent[] = []
    const manager = new SshManager({ hostKeys, onUnknownHostKey: async () => true })
    manager.onEvent((event) => events.push(event))

    const session = await manager.open({
      hostId: "mock",
      host: "127.0.0.1",
      port: address.port,
      username: "tester",
      authMethod: "password",
      password: "secret",
      cols: 100,
      rows: 30
    })

    await waitFor(() => events.some((event) => event.kind === "data" && event.data.includes("welcome")))
    manager.write(session.sessionId, "ping\n")
    await waitFor(() => events.some((event) => event.kind === "data" && event.data.includes("echo:ping")))
    expect(events.some((event) => event.kind === "state" && event.state === "connected")).toBe(true)

    await manager.close(session.sessionId)
    await waitFor(() => events.some((event) => event.kind === "state" && event.state === "closed"))
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > 3_000) throw new Error("timed out waiting for SSH event")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
