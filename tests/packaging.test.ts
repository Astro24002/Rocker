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
    expect(config).toContain("artifactName: Rocker-v${version}-${arch}.${ext}")
    expect(config).not.toContain("artifactName: Rocker-${arch}.${ext}")
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

  it("gates packaging on release-grade verification and uploads only installer assets", () => {
    const workflow = readFileSync(".github/workflows/build.yml", "utf8")

    expect(workflow).toContain("npm test")
    expect(workflow).toContain("npm run typecheck")
    expect(workflow).toContain("npm run build")
    expect(workflow).toContain("npm audit --omit=dev --audit-level=moderate")
    expect(workflow).toContain("env npm_config_registry=https://registry.npmjs.org")
    expect(workflow).toContain("timeout 90s env npm_config_registry=https://registry.npmjs.org npm audit")
    expect(workflow).toContain("::error::")
    expect(workflow).toContain("node scripts/verify-release-assets.mjs \"$release_version\" release")
    expect(workflow).toMatch(/gh release upload \"\$GITHUB_REF_NAME\" \"\$asset\"/)
    expect(workflow).not.toMatch(/gh release (?:create|upload).*release\/\*/)
    for (const asset of ["x64.exe", "arm64.exe", "x64.dmg", "arm64.dmg", "x64.zip", "arm64.zip"]) {
      expect(workflow).toContain(`Rocker-v${"${release_version}"}-${asset}`)
    }
  })
})
