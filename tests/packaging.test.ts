import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe("desktop packaging metadata", () => {
  it("targets only Rocker for Windows and macOS", () => {
    const config = readFileSync("electron-builder.yml", "utf8")

    expect(config).toMatch(/^appId:\s*rocker$/m)
    expect(config).toMatch(/^productName:\s*Rocker$/m)
    expect(config).toMatch(/^executableName:\s*rocker$/m)
    expect(config).toContain("target: nsis")
    expect(config).toContain("target: dmg")
    expect(config).toContain("target: zip")
    expect(config).toContain("artifactName: Rocker-${arch}.${ext}")
    expect(config).not.toContain("artifactName: Rocker-${version}-${arch}.${ext}")
    expect(config).not.toMatch(/^linux:/m)
    expect(config).not.toMatch(/android|ios/i)
  })

  it("keeps bundled UI libraries out of production dependencies", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(["ssh2"])
    expect(packageJson.devDependencies).toMatchObject({
      "@xterm/xterm": expect.any(String),
      "@xterm/addon-fit": expect.any(String),
      "lucide-react": expect.any(String),
      react: expect.any(String),
      "react-dom": expect.any(String)
    })
  })
})
