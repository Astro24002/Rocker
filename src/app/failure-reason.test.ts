import { describe, expect, it } from "vitest"
import { failureReasonFor } from "./App"

describe("renderer failure reason mapping", () => {
  it("preserves a typed reason attached by the main process", () => {
    const error = new Error("Host denied (verification failed)")
    Object.defineProperty(error, "reason", { value: "host-key-changed" })

    expect(failureReasonFor(error)).toBe("host-key-changed")
  })

  it("recognizes native timeout and DNS error codes", () => {
    expect(failureReasonFor(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe("timeout")
    expect(failureReasonFor(Object.assign(new Error("getaddrinfo ENOTFOUND host.invalid"), { code: "ENOTFOUND" }))).toBe("dns")
  })
})
