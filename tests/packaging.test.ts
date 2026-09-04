import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"

type DependencyMap = Record<string, string>

type PackageMetadata = {
  version: string
  dependencies?: DependencyMap
  devDependencies?: DependencyMap
}

type LockfileMetadata = {
  version: string
  packages: {
    "": {
      version: string
      dependencies?: DependencyMap
      devDependencies?: DependencyMap
    }
  }
}

type BuilderTarget = {
  target: string
  arch: string[]
}

type BuilderConfig = {
  win?: { target?: BuilderTarget[] }
  mac?: { target?: BuilderTarget[] }
}

type WorkflowConfig = {
  jobs?: {
    package?: {
      strategy?: {
        matrix?: {
          include?: Array<{
            os: string
            command: string
            artifacts: string
          }>
        }
      }
    }
  }
}

const require = createRequire(import.meta.url)
const { load: parseYaml } = require("js-yaml") as {
  load: (source: string) => unknown
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageMetadata
const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as LockfileMetadata

const APPROVED_RUNTIME_DEPENDENCY_KEYS = ["ssh2"]
const APPROVED_DEV_DEPENDENCY_KEYS = [
  "@testing-library/jest-dom",
  "@testing-library/react",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "@types/ssh2",
  "@vitejs/plugin-react",
  "@xterm/addon-fit",
  "@xterm/addon-search",
  "@xterm/xterm",
  "electron",
  "electron-builder",
  "electron-vite",
  "jsdom",
  "lucide-react",
  "react",
  "react-dom",
  "sharp",
  "typescript",
  "vite",
  "vitest"
]

const sortedKeys = (dependencies: DependencyMap | undefined) => Object.keys(dependencies ?? {}).sort()

describe("desktop packaging metadata", () => {
  it("prepares the 0.4.0 release version in package and lock metadata", () => {
    expect(packageJson.version).toBe("0.4.0")
    expect(lockfile.version).toBe("0.4.0")
    expect(lockfile.packages[""].version).toBe("0.4.0")
  })

  it("targets only Rocker for Windows and macOS", () => {
    const config = readFileSync("electron-builder.yml", "utf8")

    expect(config).toMatch(/^appId:\s*rocker$/m)
    expect(config).toMatch(/^productName:\s*Rocker$/m)
    expect(config).toMatch(/^executableName:\s*rocker$/m)
    const builder = parseYaml(config) as BuilderConfig
    expect(builder.win?.target).toEqual([
      { target: "nsis", arch: ["x64", "arm64"] }
    ])
    expect(builder.mac?.target).toEqual([
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] }
    ])
    expect(config).toContain("artifactName: Rocker-v${version}-${arch}.${ext}")
    expect(config).toContain("!node_modules/cpu-features/**")
    expect(config).toContain("!node_modules/nan/**")
    expect(config).not.toContain("artifactName: Rocker-${arch}.${ext}")
    expect(config).not.toMatch(/^linux:/m)
    expect(config).not.toMatch(/android|ios/i)
  })

  it("keeps only approved dependency keys in package and lock metadata", () => {
    const packageRoot = packageJson
    const lockRoot = lockfile.packages[""]

    expect(sortedKeys(packageRoot.dependencies)).toEqual(APPROVED_RUNTIME_DEPENDENCY_KEYS)
    expect(sortedKeys(packageRoot.devDependencies)).toEqual([...APPROVED_DEV_DEPENDENCY_KEYS].sort())
    expect(sortedKeys(lockRoot.dependencies)).toEqual(APPROVED_RUNTIME_DEPENDENCY_KEYS)
    expect(sortedKeys(lockRoot.devDependencies)).toEqual([...APPROVED_DEV_DEPENDENCY_KEYS].sort())
    expect(lockRoot.dependencies).toEqual(packageRoot.dependencies)
    expect(lockRoot.devDependencies).toEqual(packageRoot.devDependencies)
  })

  it("gates packaging on release-grade verification and uploads only installer assets", () => {
    const workflow = readFileSync(".github/workflows/build.yml", "utf8")
    const releaseJob = workflow.slice(workflow.indexOf("\n  release:"))
    const soakJob = workflow.slice(workflow.indexOf("\n  soak:"), workflow.indexOf("\n  package:"))
    const workflowConfig = parseYaml(workflow) as WorkflowConfig

    expect(workflowConfig.jobs?.package?.strategy?.matrix).toEqual({
      include: [
        {
          os: "windows-latest",
          command: "npm run dist:win",
          artifacts: "release/Rocker-v*-x64.exe\nrelease/Rocker-v*-arm64.exe\n"
        },
        {
          os: "macos-14",
          command: "npm run dist:mac",
          artifacts: "release/Rocker-v*.dmg\nrelease/Rocker-v*.zip\n"
        }
      ]
    })

    expect(workflow).toContain("npm test")
    expect(workflow).toContain("npm run typecheck")
    expect(workflow).toContain("npm run build")
    expect(workflow).toContain("workflow_dispatch:")
    expect(soakJob).toContain("if: startsWith(github.ref, 'refs/tags/v1.') || github.event_name == 'workflow_dispatch'")
    expect(soakJob).toContain("timeout-minutes: 45")
    expect(soakJob).toContain("npm run test:soak")
    expect(releaseJob).toMatch(/if:\s*always\(\).*needs\.package\.result == 'success'.*needs\.soak\.result == 'success'.*needs\.soak\.result == 'skipped'/s)
    expect(releaseJob).toMatch(/needs:\s*\[package, soak\]/)
    expect(workflow).toContain("npm audit --omit=dev --audit-level=moderate")
    expect(workflow).toContain("env npm_config_registry=https://registry.npmjs.org")
    expect(workflow).toContain("timeout 90s env npm_config_registry=https://registry.npmjs.org npm audit")
    expect(workflow).toContain("::error::")
    expect(workflow).toContain("mkdir -p release-publish")
    expect(workflow).toContain("release/Rocker-v*-x64.exe")
    expect(workflow).toContain("release/Rocker-v*-arm64.exe")
    expect(workflow).not.toContain("release/Rocker-v*.exe")
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

    expect(windowsImage).toContain("electronuserland/builder:24-wine@sha256:")
    expect(windowsImage).toContain("WORKDIR /project")
    expect(windowsSmoke).toContain("docker build")
    expect(windowsSmoke).toContain("npm ci")
    expect(windowsSmoke).toContain("node_modules/cpu-features")
    expect(windowsSmoke).toContain(".rocker-win-release")
    expect(windowsSmoke).toContain("npm run dist:win")
    expect(macSmoke).toContain("Darwin")
    expect(macSmoke).toContain("npm run dist:mac")
    expect(macSmoke).toContain("native macOS")
  })

  it("keeps v0 workflow release and soak intent explicit", () => {
    const workflow = readFileSync(".github/workflows/build.yml", "utf8")
    const soakJob = workflow.slice(workflow.indexOf("\n  soak:"), workflow.indexOf("\n  package:"))

    expect(workflow).toContain("command: npm run dist:win")
    expect(workflow).toContain("command: npm run dist:mac")
    expect(workflow).toContain("release/Rocker-v*-x64.exe")
    expect(workflow).toContain("release/Rocker-v*-arm64.exe")
    expect(workflow).toContain("release/Rocker-v*.dmg")
    expect(workflow).toContain("release/Rocker-v*.zip")
    expect(workflow).toContain("The long soak is a v1 release gate")
    expect(workflow).toContain("v0 releases use the local short soak")
    expect(soakJob).toContain("startsWith(github.ref, 'refs/tags/v1.')")
    expect(soakJob).toContain("timeout-minutes: 45")
    expect(workflow).not.toMatch(/dist:(?:linux|android|ios)/i)
  })

  it("keeps the v0.4 implementation evidence and smoke checklist present", () => {
    const verificationPath = "docs/releases/v0.4.0-implementation-verification.md"
    const smokePath = "docs/releases/v0.4.0-smoke-checklist.md"

    expect(existsSync(verificationPath)).toBe(true)
    expect(existsSync(smokePath)).toBe(true)

    const verification = readFileSync(verificationPath, "utf8")
    const smokeChecklist = readFileSync(smokePath, "utf8")

    expect(verification).toContain("Base before v0.4 implementation")
    expect(verification).toContain("Task 5 final commit")
    expect(verification).toContain("Task 6 verification record")
    expect(verification).toContain("| Task 6 verification record | `b9e9fd2` |")
    expect(verification).toContain("npm audit")
    expect(verification).toContain("native Windows/macOS startup")
    expect(verification).toContain("DEFERRED")
    expect(smokeChecklist).toContain("Result values: `PASS`, `FAIL`, `BLOCKED`, `DEFERRED`, or `PENDING`.")

    for (const section of [
      "Search",
      "Command Palette",
      "Shell Key Pass-Through",
      "Session Menu",
      "Duplicate and New Window",
      "Recent Sessions",
      "Live Terminal Settings",
      "Blocked Settings Storage",
      "Placeholder Navigation"
    ]) {
      expect(smokeChecklist).toContain(section)
    }
  })
})
