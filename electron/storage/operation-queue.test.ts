import { describe, expect, it } from "vitest"
import { SerializedOperationQueue } from "./operation-queue"

describe("SerializedOperationQueue", () => {
  it("serializes writes and continues after a rejected operation", async () => {
    const queue = new SerializedOperationQueue()
    const events: string[] = []
    let release!: () => void
    const first = queue.run(async () => {
      events.push("first:start")
      await new Promise<void>((resolve) => { release = resolve })
      events.push("first:end")
    })
    const second = queue.run(async () => {
      events.push("second")
      throw new Error("expected")
    })
    const third = queue.run(async () => { events.push("third") })

    expect(events).toEqual([])
    await Promise.resolve()
    expect(events).toEqual(["first:start"])
    release()
    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toThrow("expected")
    await expect(third).resolves.toBeUndefined()
    expect(events).toEqual(["first:start", "first:end", "second", "third"])
  })
})
