import { Client } from "ssh2"
import { afterEach, describe, expect, it } from "vitest"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "./ssh-server"

const clients: Client[] = []
const servers: Array<{ close(): Promise<void>; resourceSnapshot(): { clients: number; sessions: number; shells: number; forwards: number } }> = []

afterEach(async () => {
  clients.splice(0).forEach((client) => client.end())
  const closing = servers.splice(0)
  await Promise.all(closing.map((server) => server.close()))
  for (const server of closing) expect(server.resourceSnapshot()).toEqual({ clients: 0, sessions: 0, shells: 0, forwards: 0 })
})

function connect(port: number, client = new Client()): Promise<Client> {
  clients.push(client)
  return new Promise((resolve, reject) => {
    client.once("ready", () => resolve(client))
    client.once("error", reject)
    client.connect({ host: "127.0.0.1", port, username: TEST_USERNAME, password: TEST_PASSWORD })
  })
}

describe("ssh test server fixture", () => {
  it("starts on an ephemeral port, authenticates, serves PTY UTF-8 output and echoes stdin", async () => {
    const fixture = await createSshTestServer({ welcome: "hello, 世界\n" })
    servers.push(fixture)
    expect(fixture.port).toBeGreaterThan(0)

    const client = await connect(fixture.port)
    const output = await new Promise<string>((resolve, reject) => {
      client.shell({ rows: 24, cols: 80, term: "xterm" }, (error, stream) => {
        if (error) return reject(error)
        let text = ""
        stream.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8")
          if (text.includes("echo: ping")) resolve(text)
        })
        stream.write("ping\n")
      })
    })
    expect(output).toContain("hello, 世界")
    expect(output).toContain("echo: ping")
    expect(fixture.ptyRequests[0]).toMatchObject({ rows: 24, cols: 80 })
  })

  it("records PTY resize, drops transports, and closes cleanly", async () => {
    const fixture = await createSshTestServer()
    servers.push(fixture)
    const client = await connect(fixture.port)
    await new Promise<void>((resolve, reject) => client.shell((error, stream) => error ? reject(error) : (stream.once("data", () => resolve()), stream.write("x\n"))))
    expect(fixture.connectionCount).toBe(1)
    fixture.resizePty(120, 40)
    expect(fixture.ptyResizes.at(-1)).toMatchObject({ cols: 120, rows: 40 })
    fixture.dropTransports()
    await new Promise<void>((resolve) => client.once("close" as never, () => resolve()))
    await fixture.close()
    expect(fixture.server.address()).toBeNull()
  })

  it("holds and releases authentication deterministically", async () => {
    const fixture = await createSshTestServer()
    servers.push(fixture)
    fixture.holdAuthentication()
    const opening = connect(fixture.port)

    await waitFor(() => fixture.resourceSnapshot().clients === 1)
    let settled = false
    void opening.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    fixture.releaseAuthentication()
    await opening
  })

  it("holds and releases the next shell without leaking the session", async () => {
    const fixture = await createSshTestServer()
    servers.push(fixture)
    const client = await connect(fixture.port)
    fixture.holdNextShell()
    let settled = false
    const shell = new Promise<void>((resolve, reject) => {
      client.shell({ rows: 24, cols: 80, term: "xterm" }, (error, stream) => {
        if (error) return reject(error)
        settled = true
        stream.end()
        resolve()
      })
    })

    await waitFor(() => fixture.ptyRequests.length === 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    fixture.releaseNextShell()
    await shell
  })

  it("toggles keepalive responses and reports active resource counts", async () => {
    const fixture = await createSshTestServer()
    servers.push(fixture)
    const client = await connect(fixture.port)
    expect(fixture.resourceSnapshot()).toMatchObject({ clients: 1, sessions: 0, shells: 0, forwards: 0 })
    fixture.setKeepaliveResponse(false)
    fixture.setKeepaliveResponse(true)
    client.end()
    await waitFor(() => fixture.resourceSnapshot().clients === 0)
  })

  it("closes exec channels so bounded monitoring commands can settle", async () => {
    const fixture = await createSshTestServer()
    servers.push(fixture)
    const client = await connect(fixture.port)
    let execCallbackCalled = false

    const opening = new Promise<void>((resolve, reject) => {
      client.exec("cat /proc/stat", (error, channel) => {
        execCallbackCalled = true
        if (error || !channel) return reject(error ?? new Error("exec channel was not opened"))
        channel.on("data", () => undefined)
        channel.once("close", () => resolve())
      })
    })

    await opening
    expect(execCallbackCalled).toBe(true)
    await waitFor(() => fixture.resourceSnapshot().shells === 0)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for fixture state")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
