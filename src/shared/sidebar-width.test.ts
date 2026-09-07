import { describe, expect, it } from "vitest"
import {
  DEFAULT_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
  stepSidebarWidth
} from "./sidebar-width"

describe("sidebar width policy", () => {
  it.each([
    [58, 58],
    [119, 58],
    [120, 180],
    [179, 180],
    [180, 180],
    [220, 220],
    [320, 320],
    [321, 320],
    [Number.NaN, DEFAULT_SIDEBAR_WIDTH],
    ["invalid", DEFAULT_SIDEBAR_WIDTH]
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizeSidebarWidth(value)).toBe(expected)
  })

  it("jumps between compact and expanded modes with keyboard steps", () => {
    expect(stepSidebarWidth(58, "increase")).toBe(180)
    expect(stepSidebarWidth(180, "decrease")).toBe(58)
    expect(stepSidebarWidth(220, "decrease")).toBe(208)
    expect(stepSidebarWidth(220, "increase")).toBe(232)
  })
})
