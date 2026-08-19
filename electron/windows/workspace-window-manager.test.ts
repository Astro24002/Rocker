import { describe, expect, it, vi, type Mock } from "vitest"
import {
  WorkspaceWindowManager,
  type WorkspaceWindow,
  type WorkspaceWindowOptions
} from "./workspace-window-manager"
import type { StoredWorkspaceDocument, StoredWorkspaceWindow } from "../storage/types"

const firstWorkspace = "11111111-1111-4111-8111-111111111111"
const secondWorkspace = "22222222-2222-4222-8222-222222222222"

describe("WorkspaceWindowManager", () => {
  it("keeps snapshots during app quit but removes a manually closed window", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const quittingWindow = manager.createNew(createWorkspace(firstWorkspace))

    manager.beginQuit()
    await manager.handleClosed(quittingWindow.webContents.id)

    expect(store.removeWindow).not.toHaveBeenCalled()

    manager.endQuitForTest()
    const manualWindow = manager.createNew(createWorkspace(secondWorkspace))
    await manager.handleClosed(manualWindow.webContents.id)

    expect(store.removeWindow).toHaveBeenCalledWith(secondWorkspace)
  })

  it("restores a saved workspace under its own web contents identity", async () => {
    const saved = createWorkspace(firstWorkspace, { x: 30, y: 40, width: 1360, height: 820 }, true)
    const store = createStore({ version: 1, windows: [saved] })
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })

    const restored = await manager.restoreWindows()

    expect(restored).toHaveLength(1)
    expect(windows.options[0]).toMatchObject({ x: 30, y: 40, width: 1360, height: 820 })
    expect(restored[0].maximize).toHaveBeenCalledOnce()
    expect(manager.workspaceForWebContents(restored[0].webContents.id)).toBe(firstWorkspace)
  })

  it("derives persisted window metadata from the owned native window", () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const window = manager.createNew(createWorkspace(firstWorkspace))

    manager.saveWorkspace(window.webContents.id, { sessions: [] })

    expect(store.saveWindow).toHaveBeenCalledWith({
      workspaceId: firstWorkspace,
      bounds: { x: 18, y: 24, width: 1440, height: 900 },
      maximized: false,
      sessions: []
    })
  })

  it("removes a manually closed workspace even if application shutdown starts during resource cleanup", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    let manager: WorkspaceWindowManager
    manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onWindowClosed: () => manager.beginQuit()
    })
    const window = manager.createNew(createWorkspace(firstWorkspace))

    await manager.handleClosed(window.webContents.id)

    expect(store.removeWindow).toHaveBeenCalledWith(firstWorkspace)
  })
})

function createStore(document: StoredWorkspaceDocument = { version: 1, windows: [] }) {
  return {
    load: vi.fn(async () => structuredClone(document)),
    saveWindow: vi.fn(),
    removeWindow: vi.fn()
  }
}

function createWindowFactory() {
  const options: Array<WorkspaceWindowOptions | undefined> = []
  const created: FakeWindow[] = []
  let nextId = 21
  return {
    options,
    created,
    create: vi.fn((windowOptions?: WorkspaceWindowOptions) => {
      options.push(windowOptions)
      const window = createWindow(nextId++)
      created.push(window)
      return window
    })
  }
}

function createWindow(id: number): FakeWindow {
  const closedListeners: Array<() => void> = []
  return {
    webContents: { id, send: vi.fn(), once: vi.fn() },
    maximize: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 18, y: 24, width: 1440, height: 900 })),
    isMaximized: vi.fn(() => false),
    once: vi.fn((event: "closed", listener: () => void) => {
      if (event === "closed") closedListeners.push(listener)
    }),
    close: () => closedListeners.forEach((listener) => listener())
  }
}

interface FakeWindow extends WorkspaceWindow {
  maximize: Mock<() => void>
  close(): void
}

function createWorkspace(
  workspaceId: string,
  bounds?: { x: number; y: number; width: number; height: number },
  maximized = false
): StoredWorkspaceWindow {
  return { workspaceId, bounds, maximized, sessions: [] }
}
