import { describe, expect, it } from "vitest"
import { parseCpuUsage, parseDiskUsage, parseMemoryUsage, parseNetworkTotals } from "../electron/monitoring/linux-metrics"

describe("Linux host metrics", () => {
  it("calculates CPU utilization from consecutive /proc/stat samples", () => {
    const previous = "cpu  100 0 50 850 0 0 0 0 0 0"
    const current = "cpu  160 0 70 870 0 0 0 0 0 0"

    expect(parseCpuUsage(previous, current)).toBeCloseTo(80, 3)
  })

  it("calculates memory and disk utilization", () => {
    expect(parseMemoryUsage("MemTotal: 1000 kB\nMemAvailable: 250 kB")).toBe(75)
    expect(parseDiskUsage("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 640 360 64% /"))
      .toBe(64)
  })

  it("sums receive and transmit bytes while ignoring loopback", () => {
    const totals = parseNetworkTotals(
      `Inter-| Receive | Transmit\n lo: 100 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0\neth0: 1200 0 0 0 0 0 0 0 800 0 0 0 0 0 0 0`
    )

    expect(totals).toEqual({ receivedBytes: 1200, transmittedBytes: 800 })
  })
})
