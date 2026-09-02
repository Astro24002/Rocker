import { afterEach, describe, expect, it } from "vitest"
import { getRockerBridge } from "./bridge"
import type { HostProfile } from "./types"

describe("browser preview bridge", () => {
  afterEach(() => {
    setPreviewWindowBridge(undefined)
  })

  it("redacts identity file paths from preview bootstrap hosts", async () => {
    setPreviewWindowBridge(undefined)
    const bridge = getRockerBridge()
    const profile: HostProfile = {
      id: "preview-private-key",
      name: "Preview private key",
      host: "preview.example.test",
      port: 22,
      username: "rock",
      authMethod: "privateKey",
      identityFile: "/private/user-data/.ssh/id_ed25519",
      favorite: false,
      notes: ""
    }

    try {
      await bridge.hosts.save({ profile })
      const snapshot = await bridge.bootstrap.load()
      const host = snapshot.hosts.value?.find((candidate) => candidate.id === profile.id)

      expect(host).toMatchObject({ id: profile.id, hasIdentityFile: true })
      expect(host).not.toHaveProperty("identityFile")
    } finally {
      await bridge.hosts.remove(profile.id)
    }
  })

  it("preserves an existing identity file when saving a redacted bootstrap host", async () => {
    setPreviewWindowBridge(undefined)
    const bridge = getRockerBridge()
    const profile: HostProfile = {
      id: "preview-round-trip",
      name: "Preview round trip",
      host: "preview.example.test",
      port: 22,
      username: "rock",
      authMethod: "privateKey",
      identityFile: "/private/user-data/.ssh/id_ed25519",
      favorite: false,
      notes: ""
    }

    try {
      await bridge.hosts.save({ profile })
      const snapshot = await bridge.bootstrap.load()
      const redacted = snapshot.hosts.value?.find((candidate) => candidate.id === profile.id)
      if (!redacted) throw new Error("Preview host was not bootstrapped")

      await bridge.hosts.save({ profile: { ...redacted, favorite: true } })
      const roundTrip = await bridge.bootstrap.load()
      const roundTripped = roundTrip.hosts.value?.find((candidate) => candidate.id === profile.id)
      const stored = (await bridge.hosts.list()).find((candidate) => candidate.id === profile.id)

      expect(roundTripped).toMatchObject({ id: profile.id, favorite: true, hasIdentityFile: true })
      expect(roundTripped).not.toHaveProperty("identityFile")
      expect(stored).toMatchObject({ id: profile.id, favorite: true, identityFile: profile.identityFile })
      expect(stored).not.toHaveProperty("hasIdentityFile")
    } finally {
      await bridge.hosts.remove(profile.id)
    }
  })
})

function setPreviewWindowBridge(bridge: Window["rocker"] | undefined): void {
  (window as unknown as { rocker?: Window["rocker"] }).rocker = bridge
}
