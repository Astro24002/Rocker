import { describe, expect, it } from "vitest"
import { isValidSessionId, validateDimensions, validatePort, validateTerminalData } from "../electron/ipc/validation"

describe("IPC payload validation", () => {
  it("accepts bounded ports and rejects invalid values", () => {
    expect(validatePort(22)).toBe(true)
    expect(validatePort(65535)).toBe(true)
    expect(validatePort(0)).toBe(false)
    expect(validatePort(65536)).toBe(false)
    expect(validatePort("22")).toBe(false)
  })

  it("bounds terminal dimensions and input size", () => {
    expect(validateDimensions(120, 40)).toBe(true)
    expect(validateDimensions(0, 40)).toBe(false)
    expect(validateDimensions(501, 40)).toBe(false)
    expect(validateTerminalData("echo hi")).toBe(true)
    expect(validateTerminalData("x".repeat(64 * 1024 + 1))).toBe(false)
  })

  it("accepts only generated-looking session identifiers", () => {
    expect(isValidSessionId("6fa459ea-ee8a-3ca4-894e-db77e160355e")).toBe(true)
    expect(isValidSessionId("session-1")).toBe(false)
  })
})
