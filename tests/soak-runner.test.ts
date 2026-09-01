import { describe, expect, it } from "vitest"
import { parseSoakArgs } from "../scripts/run-soak.mjs"

describe("terminal soak runner arguments", () => {
  it("defaults to the planned thirty-minute duration", () => {
    expect(parseSoakArgs([])).toEqual({ durationMs: 1_800_000 })
  })

  it("accepts an explicit duration in either CLI form", () => {
    expect(parseSoakArgs(["--duration-ms=3000"])).toEqual({ durationMs: 3_000 })
    expect(parseSoakArgs(["--duration-ms", "3000"])).toEqual({ durationMs: 3_000 })
  })

  it("rejects unsafe or unknown options", () => {
    expect(() => parseSoakArgs(["--duration-ms=999"])).toThrow("at least 1000ms")
    expect(() => parseSoakArgs(["--unknown"])).toThrow("Unknown soak option")
  })
})
