import { Buffer } from "node:buffer"
import { describe, expect, it, vi } from "vitest"
import { TerminalOutputPump } from "./terminal-output-pump"
import type { TerminalOutputPacket } from "./types"

describe("TerminalOutputPump", () => {
  it("preserves UTF-8 fragments and ANSI bytes in ordered 64 KiB packets", () => {
    const channel = { pause: vi.fn(), resume: vi.fn() }
    const packets: TerminalOutputPacket[] = []
    const pump = new TerminalOutputPump(channel, "session-a", 3, (packet) => packets.push(packet))
    const character = Buffer.from([0xe4, 0xb8, 0xad])
    const input = Buffer.concat([
      character.subarray(0, 1),
      character.subarray(1),
      Buffer.from([0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x72, 0x65, 0x64, 0x1b, 0x5b, 0x30, 0x6d]),
      Buffer.alloc(65_536, 0x78)
    ])

    pump.enqueue(input.subarray(0, 2))
    pump.enqueue(input.subarray(2))

    expect(Buffer.concat(packets.map((packet) => Buffer.from(packet.bytes)))).toEqual(input)
    expect(packets.map((packet) => packet.sequence)).toEqual([1, 2, 3])
    expect(packets.map((packet) => packet.bytes.byteLength)).toEqual([2, 65_536, 13])
    expect(pump.queuedByteCount).toBe(input.byteLength)
  })

  it("pauses at four MiB and resumes only below one MiB", () => {
    const channel = { pause: vi.fn(), resume: vi.fn() }
    const packets: TerminalOutputPacket[] = []
    const pump = new TerminalOutputPump(channel, "session-a", 1, (packet) => packets.push(packet))

    pump.enqueue(Buffer.alloc(4 * 1024 * 1024))

    expect(channel.pause).toHaveBeenCalledOnce()
    expect(pump.isPaused).toBe(true)
    pump.acknowledge(0, packets[0].sequence)
    expect(channel.resume).not.toHaveBeenCalled()

    for (const packet of packets.slice(0, -8)) pump.acknowledge(1, packet.sequence)

    expect(channel.resume).toHaveBeenCalledOnce()
    expect(pump.isPaused).toBe(false)
    expect(pump.queuedByteCount).toBe(8 * 65_536)
  })

  it("ignores unknown, duplicate, stale, and closed acknowledgements", () => {
    const channel = { pause: vi.fn(), resume: vi.fn() }
    const packets: TerminalOutputPacket[] = []
    const pump = new TerminalOutputPump(channel, "session-a", 2, (packet) => packets.push(packet))
    const input = Uint8Array.from([1, 2, 3])

    pump.enqueue(input)
    pump.acknowledge(2, 99)
    pump.acknowledge(1, packets[0].sequence)
    expect(pump.queuedByteCount).toBe(3)

    pump.acknowledge(2, packets[0].sequence)
    pump.acknowledge(2, packets[0].sequence)
    expect(pump.queuedByteCount).toBe(0)

    pump.close()
    pump.acknowledge(2, packets[0].sequence)
    pump.enqueue(Uint8Array.from([4]))
    expect(pump.queuedByteCount).toBe(0)
    expect(packets).toHaveLength(1)
  })
})
