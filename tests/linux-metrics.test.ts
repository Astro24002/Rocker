import { describe, expect, it } from "vitest"
import { LinuxMetricsSampler, parseCpuUsage, parseDiskUsage, parseLoadAverage, parseMemoryUsage, parseNetworkTotals } from "../electron/monitoring/linux-metrics"
import { RemoteOperationError } from "../electron/ssh/types"

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

  it("parses the one-minute system load average", () => {
    expect(parseLoadAverage("0.42 0.31 0.18 1/234 12345")).toBe(0.42)
    expect(parseLoadAverage("unavailable")).toBeNull()
  })

  it("uses bounded options for every monitoring command", async () => {
    const calls: Array<{ command: string; options: unknown }> = []
    const responses = monitoringResponses()
    const sampler = new LinuxMetricsSampler({
      exec: async (_sessionId, command, options) => {
        calls.push({ command, options })
        return responses[command] ?? ""
      }
    })

    await sampler.sample("session-1")

    expect(calls).toHaveLength(5)
    expect(calls.map((call) => call.command).sort()).toEqual([
      "cat /proc/loadavg",
      "cat /proc/meminfo",
      "cat /proc/net/dev",
      "cat /proc/stat",
      "df -P /"
    ])
    for (const call of calls) expect(call.options).toEqual({ timeoutMs: 8_000, maxOutputBytes: 262_144 })
  })

  it("does not commit a failed monitoring sample as the next baseline", async () => {
    const calls: string[] = []
    const responses = monitoringResponses()
    let fail = false
    const sampler = new LinuxMetricsSampler({
      exec: async (_sessionId, command, options) => {
        void options
        calls.push(command)
        if (fail && command === "cat /proc/loadavg") throw new RemoteOperationError("sample timed out", "timeout")
        if (command === "cat /proc/stat" && !fail && calls.length > 5) return "cpu  220 0 90 890 0 0 0 0 0 0"
        return responses[command] ?? ""
      }
    })

    await sampler.sample("session-1")
    fail = true
    await expect(sampler.sample("session-1")).rejects.toMatchObject({ reason: "timeout" })
    fail = false
    const recovered = await sampler.sample("session-1")

    expect(recovered.cpuPercent).toBeCloseTo(80, 3)
  })
})

function monitoringResponses(): Record<string, string> {
  return {
    "cat /proc/stat": "cpu  100 0 50 850 0 0 0 0 0 0",
    "cat /proc/meminfo": "MemTotal: 1000 kB\nMemAvailable: 250 kB",
    "df -P /": "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 640 360 64% /",
    "cat /proc/net/dev": "eth0: 1200 0 0 0 0 0 0 0 800 0 0 0 0 0 0 0",
    "cat /proc/loadavg": "0.42 0.31 0.18 1/234 12345"
  }
}
