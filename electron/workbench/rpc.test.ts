import { describe, expect, it, vi } from "vitest"
import { CodexRpc } from "./rpc"
import { TestTransport } from "./test-transport"

describe("Codex JSONL", () => {
  it("handles fragmented UTF-8 and batched messages with independent request IDs", async () => {
    const transport = new TestTransport(false), message = vi.fn(), failure = vi.fn()
    const rpc = new CodexRpc(transport, message, failure)
    const first = rpc.request("one", {}), second = rpc.request("two", {})
    const bytes = Buffer.from('{"method":"delta","params":{"text":"中文"}}\n{"id":2,"result":2}\n{"id":1,"result":1}\n')
    for (const byte of bytes) transport.bytes(Buffer.from([byte]))
    await expect(first).resolves.toBe(1); await expect(second).resolves.toBe(2)
    expect(message).toHaveBeenCalledWith({ method: "delta", params: { text: "中文" } })
    expect(failure).not.toHaveBeenCalled(); rpc.close()
  })
  it.each(["disconnect", "invalid", "oversize", "timeout"])("rejects all pending calls on %s and closes once", async (reason) => {
    const transport = new TestTransport(false), failure = vi.fn()
    const rpc = new CodexRpc(transport, vi.fn(), failure)
    const pending = Promise.allSettled([rpc.request("one", {}, reason === "timeout" ? 5 : 30_000), rpc.request("two", {})])
    if (reason === "disconnect") transport.disconnect()
    if (reason === "invalid") transport.bytes(Buffer.from("not JSON\n"))
    if (reason === "oversize") transport.bytes(Buffer.alloc(8 * 1024 * 1024 + 1, 65))
    expect((await pending).every(r => r.status === "rejected")).toBe(true)
    rpc.close(); transport.disconnect()
    expect(transport.close).toHaveBeenCalledTimes(1); expect(failure).toHaveBeenCalledTimes(1)
  })
})
