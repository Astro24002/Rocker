import { describe, expect, it } from "vitest"
import { retryDelayMs } from "./reconnect-policy"

describe("retryDelayMs", () => {
  it("uses capped exponential backoff with bounded jitter", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(1_000)
    expect(retryDelayMs(5, () => 0.5)).toBe(16_000)
    expect(retryDelayMs(6, () => 0.5)).toBe(30_000)
    expect(retryDelayMs(1, () => 0)).toBe(800)
    expect(retryDelayMs(1, () => 1)).toBe(1_200)
  })
})
