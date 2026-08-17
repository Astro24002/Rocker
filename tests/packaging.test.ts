import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("desktop packaging metadata", () => {
  it("targets only Rocker for Windows and macOS", () => {
    const config = readFileSync("electron-builder.yml", "utf8")

    expect(config).toMatch(/^appId:\s*rocker$/m)
    expect(config).toMatch(/^productName:\s*Rocker$/m)
    expect(config).toMatch(/^executableName:\s*rocker$/m)
    expect(config).toContain("target: nsis")
    expect(config).toContain("target: dmg")
    expect(config).toContain("target: zip")
    expect(config).not.toMatch(/^linux:/m)
    expect(config).not.toMatch(/android|ios/i)
  })
})
