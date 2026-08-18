import { describe, expect, it } from "vitest"
import { applyMetrics, createMonitorState, formatMetric, toggleMonitor } from "./monitor-state"

describe("current host monitor state", () => {
  it("is collapsed by default and can expand", () => {
    const state = createMonitorState()
    expect(state.expanded).toBe(false)
    expect(toggleMonitor(state).expanded).toBe(true)
  })

  it("renders unavailable metrics as a dash instead of zero", () => {
    expect(formatMetric(null, "%")).toBe("—")
    expect(formatMetric(0, "%")).toBe("0%")
  })

  it("stores the latest sample", () => {
    const state = applyMetrics(createMonitorState(), {
      sessionId: "one",
      latencyMs: 17,
      cpuPercent: null,
      memoryPercent: 42,
      diskPercent: 60,
      loadAverage: 1.2,
      receiveBytesPerSecond: null,
      transmitBytesPerSecond: null,
      sampledAt: "2026-08-17T12:00:00.000Z"
    })
    expect(state.metrics?.memoryPercent).toBe(42)
  })
})
