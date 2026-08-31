import { describe, expect, it, vi, type Mock } from "vitest"
import { bootstrapPrimaryInstance } from "./single-instance"

describe("bootstrapPrimaryInstance", () => {
  it("quits before startup when the lock is unavailable", () => {
    const app = fakeApp({ lock: false })
    const start = vi.fn()

    expect(bootstrapPrimaryInstance(app, {
      start,
      focusExisting: vi.fn(),
      onStartError: vi.fn()
    })).toBe(false)

    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.whenReady).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })

  it("focuses the primary window and starts only after readiness", async () => {
    const ready = deferred<void>()
    const focus = vi.fn()
    const start = vi.fn()
    const app = fakeApp({ lock: true, ready: ready.promise })

    expect(bootstrapPrimaryInstance(app, {
      start,
      focusExisting: focus,
      onStartError: vi.fn()
    })).toBe(true)

    app.emit("second-instance")
    expect(focus).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()

    ready.resolve()
    await flush()

    expect(start).toHaveBeenCalledOnce()
  })

  it("passes startup rejection to the error callback", async () => {
    const error = new Error("startup failed")
    const ready = deferred<void>()
    const start = vi.fn(async () => {
      throw error
    })
    const onStartError = vi.fn()
    const app = fakeApp({ lock: true, ready: ready.promise })

    bootstrapPrimaryInstance(app, { start, focusExisting: vi.fn(), onStartError })
    ready.resolve()
    await flush()

    expect(onStartError).toHaveBeenCalledOnce()
    expect(onStartError).toHaveBeenCalledWith(error)
  })
})

interface FakeApp {
  requestSingleInstanceLock: Mock<() => boolean>
  quit: Mock<() => void>
  on: Mock<(event: "second-instance", listener: () => void) => void>
  whenReady: Mock<() => Promise<void>>
  emit(event: "second-instance"): void
}

function fakeApp(options: { lock: boolean; ready?: Promise<void> }): FakeApp {
  let secondInstanceListener: (() => void) | undefined
  const app: FakeApp = {
    requestSingleInstanceLock: vi.fn(() => options.lock),
    quit: vi.fn(),
    on: vi.fn((_event, listener) => {
      secondInstanceListener = listener
    }),
    whenReady: vi.fn(() => options.ready ?? Promise.resolve()),
    emit: () => secondInstanceListener?.()
  }
  return app
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
