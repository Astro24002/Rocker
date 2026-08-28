import { Client } from "ssh2"
import { afterEach, describe, expect, it } from "vitest"
import { createSshTestServer, TEST_PASSWORD, TEST_USERNAME } from "./ssh-server"

const clients: Client[] = []
const servers: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  clients.splice(0).forEach((client) => client.end())
  await Promise.all(servers.splice(0).map((server) => server.close()))
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
})
