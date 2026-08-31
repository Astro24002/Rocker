import { describe, expect, it } from "vitest"
import { isRuntimeOwner, runtimeOwnerKey, sameRuntimeOwner } from "./owner"

describe("RuntimeOwner", () => {
  const owner = { webContentsId: 21, rendererGeneration: 3 }

  it("requires both webContents id and renderer generation", () => {
    expect(sameRuntimeOwner(owner, { ...owner })).toBe(true)
    expect(sameRuntimeOwner(owner, { ...owner, rendererGeneration: 4 })).toBe(false)
  })

  it("rejects untrusted owner values", () => {
    expect(isRuntimeOwner(owner)).toBe(true)
    expect(isRuntimeOwner({ webContentsId: 21, rendererGeneration: -1 })).toBe(false)
    expect(isRuntimeOwner({ webContentsId: "21", rendererGeneration: 3 })).toBe(false)
  })

  it("builds a collision-free internal key", () => {
    expect(runtimeOwnerKey(owner)).toBe("21:3")
  })
})
