import { describe, expect, it } from "vitest"
import { parseListeningPorts } from "../electron/ports/linux-port-parser"

describe("Linux listening port parsing", () => {
  it("parses ss IPv4, IPv6, process, pid, and uid fields", () => {
    const ports = parseListeningPorts(
      `LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=18)) uid:1000\nLISTEN 0 4096 [::1]:8080 [::]:* users:(("python",pid=82,fd=3)) uid:1001`,
      "ss"
    )

    expect(ports).toHaveLength(2)
    expect(ports[0]).toMatchObject({
      remoteAddress: "0.0.0.0",
      remotePort: 3000,
      process: "node",
      pid: 1234,
      user: "1000",
      source: "ss",
      status: "discovered"
    })
    expect(ports[1]).toMatchObject({ remoteAddress: "::1", remotePort: 8080, process: "python" })
  })

  it("parses netstat output and de-duplicates repeated sockets", () => {
    const ports = parseListeningPorts(
      `tcp 0 0 127.0.0.1:5432 0.0.0.0:* LISTEN 999 12345 88/postgres\ntcp 0 0 127.0.0.1:5432 0.0.0.0:* LISTEN 999 12345 88/postgres`,
      "netstat"
    )

    expect(ports).toHaveLength(1)
    expect(ports[0]).toMatchObject({
      remoteAddress: "127.0.0.1",
      remotePort: 5432,
      process: "postgres",
      pid: 88,
      user: "999",
      source: "netstat"
    })
  })
})
