import { describe, expect, it } from "vitest"
import { verifyHostFingerprint } from "../electron/ssh/host-keys"

describe("SSH host fingerprints", () => {
  it("accepts an unknown fingerprint only when the user approves it", async () => {
    await expect(verifyHostFingerprint("abc", undefined, async () => true)).resolves.toBe(true)
    await expect(verifyHostFingerprint("abc", undefined, async () => false)).resolves.toBe(false)
  })

  it("rejects a changed fingerprint", async () => {
    await expect(verifyHostFingerprint("new", "old", async () => true)).resolves.toBe(false)
  })

  it("accepts a matching fingerprint", async () => {
    await expect(verifyHostFingerprint("same", "same", async () => false)).resolves.toBe(true)
  })
})
