import { describe, expect, it } from "vitest"
import type { ForwardingProfile, HostProfile } from "../../../electron/storage/types"
import { forwardingSshCommand } from "./forwarding-command"

const host: HostProfile = { id: "g11", name: "G11", host: "example.org", port: 2222, username: "root", authMethod: "agent", favorite: false, notes: "" }
const profile: ForwardingProfile = { id: "web", hostId: "g11", name: "Web", localAddress: "127.0.0.1", localPort: 18080, remoteAddress: "127.0.0.1", remotePort: 8080, autoStart: false, createdAt: "2026-09-01", updatedAt: "2026-09-01" }

describe("forwardingSshCommand", () => {
  it("copies the same local bind, remote endpoint, and SSH Host port as the saved rule", () => {
    expect(forwardingSshCommand(profile, host)).toBe('ssh -N -L "127.0.0.1:18080:127.0.0.1:8080" -p 2222 "root@example.org"')
  })

  it("preserves public binds and brackets IPv6 forwarding endpoints", () => {
    expect(forwardingSshCommand({ ...profile, localAddress: "0.0.0.0", remoteAddress: "::1" }, host)).toBe('ssh -N -L "0.0.0.0:18080:[::1]:8080" -p 2222 "root@example.org"')
    expect(forwardingSshCommand({ ...profile, localAddress: "::1", remoteAddress: "[::1]" }, host)).toBe('ssh -N -L "[::1]:18080:[::1]:8080" -p 2222 "root@example.org"')
    expect(forwardingSshCommand(profile, { ...host, host: "::1" })).toBe('ssh -N -L "127.0.0.1:18080:127.0.0.1:8080" -p 2222 "root@::1"')
  })

  it("does not generate a shell command from unsafe or invalid fields", () => {
    expect(forwardingSshCommand({ ...profile, remoteAddress: "localhost;echo injected" }, host)).toBeUndefined()
    expect(forwardingSshCommand(profile, { ...host, username: "root $(id)" })).toBeUndefined()
    expect(forwardingSshCommand(profile, { ...host, host: "%PATH%" })).toBeUndefined()
    expect(forwardingSshCommand(profile, { ...host, port: 0 })).toBeUndefined()
  })
})
