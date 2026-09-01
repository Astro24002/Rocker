import { describe, expect, it } from "vitest"
import { runTerminalSoak } from "./terminal-soak"

const soak = process.env.ROCKER_SOAK === "1" ? describe : describe.skip

soak("terminal reliability soak", () => {
  it("returns to the exact resource baseline after repeated recovery cycles", async () => {
    const durationMs = Number(process.env.ROCKER_SOAK_DURATION_MS ?? 1_800_000)
    const summary = await runTerminalSoak({ durationMs })

    process.stdout.write(`ROCKER_SOAK_SUMMARY=${JSON.stringify(summary)}\n`)

    expect(summary.failures).toBe(0)
    expect(summary.iterations).toBeGreaterThanOrEqual(2)
    expect(summary.reconnects).toBeGreaterThanOrEqual(1)
    expect(summary.finalResourcesAtBaseline).toBe(true)
    if (summary.finalRssGrowthRatio !== null) expect(summary.finalRssGrowthRatio).toBeLessThanOrEqual(1.25)
  }, 1_900_000)
})
