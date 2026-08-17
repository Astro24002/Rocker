import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("rocker package scaffold", () => {
  it("declares the desktop identity and core scripts", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      name: string
      scripts: Record<string, string>
      build: { appId: string }
    }

    expect(packageJson.name).toBe("rocker")
    expect(packageJson.build.appId).toBe("rocker")
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      test: expect.any(String),
      typecheck: expect.any(String)
    })
  })
})
