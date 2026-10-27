import type { SFTPWrapper } from "ssh2"

export class SftpCleanupError extends Error {}

// A request callback is not guaranteed after a channel ends. Keep settlement
// independent of that callback, while the channel owner awaits actual closure.
export function sftpOperation<T>(
  channel: SFTPWrapper,
  signal: AbortSignal | undefined,
  start: (complete: (error: Error | null | undefined, value: T) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const complete = (error: Error | null | undefined, value?: T): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      channel.removeListener("end", ended)
      channel.removeListener("close", ended)
      channel.removeListener("error", failed)
      if (signal?.aborted) reject(new Error("SFTP transfer was cancelled"))
      else if (error) reject(error)
      else resolve(value as T)
    }
    const ended = (): void => complete(new Error("SFTP channel closed during operation"))
    const failed = (error: Error): void => complete(error)
    const abort = (): void => {
      try { channel.destroy() } catch (error) {
        complete(error instanceof Error ? error : new Error("SFTP channel could not be closed"))
        return
      }
      complete(new Error("SFTP transfer was cancelled"))
    }
    channel.once("end", ended)
    channel.once("close", ended)
    channel.once("error", failed)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { start(complete) } catch (error) {
      complete(error instanceof Error ? error : new Error("SFTP operation failed"))
    }
  })
}

export function trackSftpClosure(channel: SFTPWrapper): () => Promise<void> {
  let closed = false
  let resolveClosed!: () => void
  const completion = new Promise<void>((resolve) => { resolveClosed = resolve })
  const ignoreError = (): void => undefined
  channel.on("error", ignoreError)
  channel.once("close", () => {
    closed = true
    channel.removeListener("error", ignoreError)
    resolveClosed()
  })
  return async () => {
    if (!closed) channel.end()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new SftpCleanupError("SFTP channel cleanup timed out")), 5_000)
        })
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
