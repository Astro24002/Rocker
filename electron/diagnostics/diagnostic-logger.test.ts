import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DiagnosticLogger } from "./diagnostic-logger"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-diagnostic-logger-"))
  directories.push(directory)
  return directory
}

function event(action: string): Parameters<DiagnosticLogger["record"]>[0] {
  return { category: "session", action, sessionId: "session-1", state: "connected" }
}

describe("DiagnosticLogger", () => {
  it("appends sanitized events with timestamps from the injected clock", async () => {
    const directory = await createDirectory()
    const clock = vi.fn(() => new Date("2026-08-28T12:00:00.000Z"))
    const logger = new DiagnosticLogger({ directory, clock })

    logger.record({
      ...event("connected"),
      details: { retryable: true, password: "secret" } as Record<string, string | number | boolean>
    })
    await logger.flush()

    expect(logger.snapshot()).toEqual([{
      at: "2026-08-28T12:00:00.000Z",
      category: "session",
      action: "connected",
      state: "connected",
      sessionId: "session-1",
      details: { retryable: true }
    }])
    expect(await readFile(join(directory, "diagnostics.jsonl"), "utf8")).toBe(
      `${JSON.stringify(logger.snapshot()[0])}\n`
    )
    expect(clock).toHaveBeenCalled()
  })

  it("keeps only the newest bounded ring entries on disk", async () => {
    const directory = await createDirectory()
    const logger = new DiagnosticLogger({ directory, clock: () => new Date("2026-08-28T12:00:00.000Z") })

    for (let index = 0; index < 505; index += 1) logger.record(event(`event-${index}`))
    await logger.flush()

    const lines = (await readFile(join(directory, "diagnostics.jsonl"), "utf8")).trimEnd().split("\n")
    expect(lines).toHaveLength(500)
    expect(JSON.parse(lines[0]).action).toBe("event-5")
    expect(JSON.parse(lines.at(-1) as string).action).toBe("event-504")
    expect(logger.snapshot()).toHaveLength(500)
  })

  it("reloads complete lines after restart and ignores a partial final line", async () => {
    const directory = await createDirectory()
    const clock = () => new Date("2026-08-28T12:00:00.000Z")
    const first = new DiagnosticLogger({ directory, clock })
    first.record(event("first"))
    await first.close()

    await appendFile(join(directory, "diagnostics.jsonl"), '{"at":"partial"')
    const restarted = new DiagnosticLogger({ directory, clock })

    expect(restarted.snapshot().map((item) => item.action)).toEqual(["first"])
  })

  it("flushes pending events and close is idempotent", async () => {
    const directory = await createDirectory()
    const logger = new DiagnosticLogger({ directory, clock: () => new Date("2026-08-28T12:00:00.000Z") })

    logger.record(event("before-close"))
    await logger.close()
    await logger.close()
    logger.record(event("after-close"))

    expect((await readFile(join(directory, "diagnostics.jsonl"), "utf8")).match(/\n/g)).toHaveLength(1)
    expect(logger.snapshot().map((item) => item.action)).toEqual(["before-close"])
  })

  it("fails open when its directory cannot be written", async () => {
    const parent = await createDirectory()
    const directory = join(parent, "not-a-directory")
    await writeFile(directory, "file")
    const logger = new DiagnosticLogger({ directory, clock: () => new Date("2026-08-28T12:00:00.000Z") })

    logger.record(event("connected"))

    await expect(logger.flush()).resolves.toBeUndefined()
    await expect(logger.close()).resolves.toBeUndefined()
    expect(logger.snapshot().map((item) => item.action)).toEqual(["connected"])
  })

  it("does not reject connection or session lifecycle work when writes fail", async () => {
    const parent = await createDirectory()
    const directory = join(parent, "not-a-directory")
    await writeFile(directory, "file")
    const logger = new DiagnosticLogger({ directory, clock: () => new Date("2026-08-28T12:00:00.000Z") })

    const connectionOperation = recordAndComplete(logger, "connection", "ready")
    const sessionOperation = recordAndComplete(logger, "session", "connected")

    await expect(Promise.all([connectionOperation, sessionOperation])).resolves.toEqual(["ready", "connected"])
  })
})

async function recordAndComplete(logger: DiagnosticLogger, category: "connection" | "session", action: string): Promise<string> {
  logger.record({ category, action })
  await logger.flush()
  return action
}
