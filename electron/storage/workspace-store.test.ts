import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WorkspaceSnapshotStore } from "./workspace-store"
import type { StoredWorkspaceWindow } from "./types"

const workspaceId = "11111111-1111-4111-8111-111111111111"
const sessionId = "22222222-2222-4222-8222-222222222222"
const secondSessionId = "33333333-3333-4333-8333-333333333333"
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("WorkspaceSnapshotStore", () => {
  it("persists only normalized workspace metadata", async () => {
    const filePath = await temporaryFilePath()
    const store = new WorkspaceSnapshotStore(filePath)

    store.saveWindow({
      workspaceId,
      bounds: { x: 10, y: 20, width: 1440, height: 900 },
      maximized: false,
      activeSessionId: sessionId,
      sessions: [{
        sessionId,
        hostId: "host-a",
        label: "G11",
        cols: 120,
        rows: 40,
        output: "must not persist",
        connectionId: "runtime-only",
        channelGeneration: 4,
        password: "must not persist"
      }, {
        sessionId: secondSessionId,
        hostId: "host-b",
        label: "G12",
        cols: 100,
        rows: 30
      }],
      layout: {
        kind: "split",
        direction: "horizontal",
        ratio: 0.05,
        first: { kind: "leaf", sessionId },
        second: { kind: "leaf", sessionId: secondSessionId }
      },
      credentials: { password: "must not persist" }
    } as unknown as StoredWorkspaceWindow)
    await store.flush()

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      windows: [{
        workspaceId,
        bounds: { x: 10, y: 20, width: 1440, height: 900 },
        maximized: false,
        activeSessionId: sessionId,
        sessions: [
          { sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 },
          { sessionId: secondSessionId, hostId: "host-b", label: "G12", cols: 100, rows: 30 }
        ],
        layout: {
          kind: "split",
          direction: "horizontal",
          ratio: 0.2,
          first: { kind: "leaf", sessionId },
          second: { kind: "leaf", sessionId: secondSessionId }
        }
      }]
    })
  })

  it("drops an invalid layout leaf without blocking startup", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, JSON.stringify({
      version: 1,
      windows: [{
        workspaceId,
        maximized: false,
        sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }],
        layout: { kind: "leaf", sessionId: "missing-session" }
      }]
    }), "utf8")

    expect((await new WorkspaceSnapshotStore(filePath).load()).windows).toEqual([])
  })

  it("keeps valid windows when another persisted entry is malformed", async () => {
    const filePath = await temporaryFilePath()
    const validWindow: StoredWorkspaceWindow = {
      workspaceId,
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }],
      layout: { kind: "leaf", sessionId }
    }
    await writeFile(filePath, JSON.stringify({
      version: 1,
      windows: [validWindow, { workspaceId: "not-a-uuid", maximized: false, sessions: [] }]
    }), "utf8")

    expect((await new WorkspaceSnapshotStore(filePath).load()).windows).toEqual([validWindow])
  })

  it("starts with an empty document when the persisted JSON is unreadable", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{not json", "utf8")

    expect(await new WorkspaceSnapshotStore(filePath).load()).toEqual({ version: 1, windows: [] })
  })

  it("reports a malformed top-level document as defaulted while preserving the value shape", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, JSON.stringify({ version: 2, windows: [] }), "utf8")

    expect(await new WorkspaceSnapshotStore(filePath).loadWithStatus()).toEqual({
      status: "defaulted",
      value: { version: 1, windows: [] },
      reason: "corrupt"
    })
  })

  it("reloads a repaired backup after a cached defaulted result", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{not json", "utf8")
    const store = new WorkspaceSnapshotStore(filePath)
    const cached = await store.loadWithStatus()
    expect(cached).toMatchObject({ status: "defaulted", reason: "corrupt" })

    const repaired: StoredWorkspaceWindow = {
      workspaceId,
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }]
    }
    await writeFile(`${filePath}.bak`, JSON.stringify({ version: 1, windows: [repaired] }), "utf8")

    expect(await store.loadWithStatus({ reload: true })).toEqual({
      status: "recovered",
      value: { version: 1, windows: [repaired] },
      source: "backup"
    })
  })

  it("keeps a cached defaulted notice when reload does not consume health", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{not json", "utf8")
    const store = new WorkspaceSnapshotStore(filePath)
    expect(await store.loadWithStatus()).toMatchObject({ status: "defaulted", reason: "corrupt" })

    await writeFile(filePath, JSON.stringify({ version: 1, windows: [] }), "utf8")

    expect(await store.loadWithStatus({ reload: true })).toEqual({
      status: "defaulted",
      value: { version: 1, windows: [] },
      reason: "corrupt"
    })
    expect(await store.loadWithStatus()).toEqual({
      status: "defaulted",
      value: { version: 1, windows: [] },
      reason: "corrupt"
    })
  })

  it("consumes a still-corrupt defaulted notice across both reload reads", async () => {
    const filePath = await temporaryFilePath()
    await writeFile(filePath, "{not json", "utf8")
    const store = new WorkspaceSnapshotStore(filePath)
    expect(await store.loadWithStatus()).toMatchObject({ status: "defaulted", reason: "corrupt" })

    expect(await store.loadWithStatus({ reload: true, consumeHealth: true })).toEqual({
      status: "defaulted",
      value: { version: 1, windows: [] },
      reason: "corrupt"
    })
    expect(await store.loadWithStatus()).toEqual({
      status: "ok",
      value: { version: 1, windows: [] }
    })
  })

  it("reloads a repaired primary after an existing document write is blocked", async () => {
    const filePath = await temporaryFilePath()
    const store = new WorkspaceSnapshotStore(filePath, 0)
    const original: StoredWorkspaceWindow = {
      workspaceId,
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }]
    }
    store.saveWindow(original)
    await store.flush()

    await rm(filePath, { recursive: true, force: true })
    await mkdir(filePath)
    store.saveWindow({
      ...original,
      workspaceId: secondSessionId
    })
    await expect(store.flush()).rejects.toThrow()

    await rm(filePath, { recursive: true, force: true })
    await writeFile(filePath, JSON.stringify({ version: 1, windows: [original] }), "utf8")

    expect(await store.loadWithStatus({ reload: true })).toEqual({
      status: "ok",
      value: { version: 1, windows: [original] }
    })
  })

  it("flushes pending saves and removes one workspace without disturbing another", async () => {
    const filePath = await temporaryFilePath()
    const store = new WorkspaceSnapshotStore(filePath)
    const secondWorkspaceId = "33333333-3333-4333-8333-333333333333"
    store.saveWindow({
      workspaceId,
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }]
    })
    store.saveWindow({
      workspaceId: secondWorkspaceId,
      maximized: true,
      sessions: []
    })
    await store.flush()

    store.removeWindow(workspaceId)
    await store.flush()

    expect((await store.load()).windows).toEqual([{
      workspaceId: secondWorkspaceId,
      maximized: true,
      sessions: []
    }])
  })

  it("updates persisted native bounds without receiving a new renderer workspace", async () => {
    const filePath = await temporaryFilePath()
    const store = new WorkspaceSnapshotStore(filePath)
    store.saveWindow({
      workspaceId,
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
      maximized: false,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }]
    })
    await store.flush()

    store.updateWindowBounds(workspaceId, {
      bounds: { x: 42, y: 56, width: 1520, height: 940 },
      maximized: true
    })
    await store.flush()

    expect((await store.load()).windows).toEqual([{
      workspaceId,
      bounds: { x: 42, y: 56, width: 1520, height: 940 },
      maximized: true,
      sessions: [{ sessionId, hostId: "host-a", label: "G11", cols: 120, rows: 40 }]
    }])
  })
})

async function temporaryFilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rocker-workspace-store-"))
  temporaryDirectories.push(directory)
  return join(directory, "workspace.json")
}
