import { describe, expect, it } from "vitest"
import { parseOpenSSHConfig } from "../electron/storage/host-store"

describe("OpenSSH config import", () => {
  it("normalizes supported fields and expands the identity path", () => {
    const profiles = parseOpenSSHConfig(
      `Host dev\n  HostName 10.0.0.8\n  User root\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519\n\nHost *\n  AddKeysToAgent yes\n`,
      "/Users/alex"
    )

    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({
      name: "dev",
      host: "10.0.0.8",
      port: 2222,
      username: "root",
      authMethod: "privateKey",
      identityFile: "/Users/alex/.ssh/id_ed25519",
      favorite: false,
      notes: ""
    })
  })

  it("skips wildcard and incomplete host blocks", () => {
    const profiles = parseOpenSSHConfig("Host *\n  User root\n\nHost empty\n  User root\n", "/tmp")

    expect(profiles).toHaveLength(0)
  })
})
