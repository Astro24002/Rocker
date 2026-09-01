import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

describe("desktop packaging metadata", () => {
  it("prepares the 0.3.2 release version in package and lock metadata", () => {
    const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      version: string
      packages: { "": { version: string } }
    }

    expect(packageJson.version).toBe("0.3.2")
    expect(lockfile.version).toBe("0.3.2")
    expect(lockfile.packages[""].version).toBe("0.3.2")
  })

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
    const releaseJob = workflow.slice(workflow.indexOf("\n  release:"))
    const soakJob = workflow.slice(workflow.indexOf("\n  soak:"), workflow.indexOf("\n  package:"))

    expect(workflow).toContain("npm test")
    expect(workflow).toContain("npm run typecheck")
    expect(workflow).toContain("npm run build")
    expect(workflow).toContain("workflow_dispatch:")
    expect(soakJob).toContain("if: startsWith(github.ref, 'refs/tags/v') || github.event_name == 'workflow_dispatch'")
    expect(soakJob).toContain("timeout-minutes: 45")
    expect(soakJob).toContain("npm run test:soak")
    expect(releaseJob).toMatch(/needs:\s*\[package, soak\]/)
    expect(workflow).toContain("npm audit --omit=dev --audit-level=moderate")
    expect(workflow).toContain("env npm_config_registry=https://registry.npmjs.org")
    expect(workflow).toContain("timeout 90s env npm_config_registry=https://registry.npmjs.org npm audit")
    expect(workflow).toContain("::error::")
    expect(workflow).toContain("mkdir -p release-publish")
    expect(releaseJob).toMatch(/steps:\s+- uses: actions\/checkout@v4/)
    expect(workflow).toContain("cp \"$asset\" \"release-publish/$asset_name\"")
    expect(workflow).toContain("node scripts/verify-release-assets.mjs \"$release_version\" release-publish")
    expect(workflow).toContain("--jq '.assets | map(.name) | .[]' || true")
    expect(workflow).toMatch(/gh release upload \"\$GITHUB_REF_NAME\" \"\$asset\"/)
    expect(workflow).not.toMatch(/gh release (?:create|upload).*release\/\*/)
    for (const asset of ["x64.exe", "arm64.exe", "x64.dmg", "arm64.dmg", "x64.zip", "arm64.zip"]) {
      expect(workflow).toContain(`Rocker-v${"${release_version}"}-${asset}`)
    }
  })

  it("provides explicit cross-platform packaging checks", () => {
    const windowsImage = readFileSync("containers/windows-builder.Dockerfile", "utf8")
    const windowsSmoke = readFileSync("scripts/run-windows-container-smoke.sh", "utf8")
    const macSmoke = readFileSync("scripts/run-macos-smoke.sh", "utf8")

    expect(windowsImage).toContain("electronuserland/builder:24-wine")
    expect(windowsImage).toContain("WORKDIR /project")
    expect(windowsSmoke).toContain("docker build")
    expect(windowsSmoke).toContain("npm run dist:win")
    expect(macSmoke).toContain("Darwin")
    expect(macSmoke).toContain("npm run dist:mac")
    expect(macSmoke).toContain("native macOS")
  })
})
