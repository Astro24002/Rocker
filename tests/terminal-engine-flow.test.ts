import { describe, expect, it } from "vitest"
import { createTerminalEngineHarness } from "./fixtures/terminal-engine"

describe("terminal engine flow", () => {
  it("drains SSH bytes through xterm acknowledgements and rejects stale output after reconnect", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111"
    const harness = createTerminalEngineHarness(sessionId)

    await harness.open()
    harness.channel.emitData(Buffer.from("before"))
    harness.terminal.completeAllWrites()

    expect(harness.terminal.writes).toContainEqual(Buffer.from("before"))
    expect(harness.channel.paused).toBe(false)

    await harness.dropAndRecover()
    harness.emitOldPacket({ sessionId, channelGeneration: 1, sequence: 99, bytes: Buffer.from("stale") })

    expect(harness.terminal.writes).not.toContainEqual(Buffer.from("stale"))
  })
})
