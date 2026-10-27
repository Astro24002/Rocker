import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { SFTPWrapper } from "ssh2"
import { SftpCleanupError, sftpOperation, trackSftpClosure } from "./sftp-operation"

describe("SFTP operation settlement", () => {
  it.each(["end", "close", "error"])("settles on %s without an operation callback and ignores a late callback", async (event) => {
    const emitter = new EventEmitter()
    const channel = emitter as SFTPWrapper
    let complete!: (error: Error | null, value: string) => void
    const request = sftpOperation<string>(channel, undefined, (done) => { complete = done })
    const rejected = expect(request).rejects.toThrow(event === "error" ? "remote failure" : "channel closed")
    emitter.emit(event, new Error("remote failure"))
    complete(null, "late response")
    await rejected
    expect(emitter.eventNames()).toEqual([])
  })

  it("cancels a pending request but waits for channel acknowledgement before cleanup completes", async () => {
    const emitter = new EventEmitter()
    const channel = Object.assign(emitter, { destroy: vi.fn(), end: vi.fn() }) as unknown as SFTPWrapper
    const close = trackSftpClosure(channel)
    const controller = new AbortController()
    const request = sftpOperation<void>(channel, controller.signal, () => undefined)
    const rejected = expect(request).rejects.toThrow("cancelled")
    controller.abort()
    await rejected
    let cleaned = false
    const cleaning = close().then(() => { cleaned = true })
    await Promise.resolve()
    expect(cleaned).toBe(false)
    expect(channel.destroy).toHaveBeenCalledOnce()
    emitter.emit("close")
    await cleaning
    expect(cleaned).toBe(true)
    expect(emitter.eventNames()).toEqual([])
  })

  it("does not reopen a completed operation when cancellation arrives later", async () => {
    const emitter = new EventEmitter()
    const channel = Object.assign(emitter, { destroy: vi.fn() }) as unknown as SFTPWrapper
    const controller = new AbortController()
    const request = sftpOperation(channel, controller.signal, (done) => done(null, "complete"))
    controller.abort()
    await expect(request).resolves.toBe("complete")
    expect(channel.destroy).not.toHaveBeenCalled()
    expect(emitter.eventNames()).toEqual([])
  })

  it("reports missing close acknowledgement as cleanup failure instead of success", async () => {
    vi.useFakeTimers()
    const emitter = new EventEmitter()
    const channel = Object.assign(emitter, { end: vi.fn() }) as unknown as SFTPWrapper
    try {
      const closing = trackSftpClosure(channel)()
      const rejected = expect(closing).rejects.toBeInstanceOf(SftpCleanupError)
      await vi.advanceTimersByTimeAsync(5_000)
      await rejected
      emitter.emit("close")
      expect(emitter.eventNames()).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
