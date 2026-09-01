import { describe, expect, it, vi, type Mock } from "vitest"
import {
  WorkspaceWindowManager,
  type WorkspaceWindow,
  type WorkspaceWindowOptions
} from "./workspace-window-manager"
import type { RuntimeOwner } from "../runtime/owner"
import type { StoredWorkspaceDocument, StoredWorkspaceWindow } from "../storage/types"

const firstWorkspace = "11111111-1111-4111-8111-111111111111"
const secondWorkspace = "22222222-2222-4222-8222-222222222222"

type IsExactRuntimeOwner<T> = T extends RuntimeOwner
  ? RuntimeOwner extends T ? true : false
  : false
type Assert<T extends true> = T
type LoadWorkspaceOwnerIsExact = Assert<IsExactRuntimeOwner<Parameters<WorkspaceWindowManager["loadWorkspace"]>[0]>>
type SaveWorkspaceOwnerIsExact = Assert<IsExactRuntimeOwner<Parameters<WorkspaceWindowManager["saveWorkspace"]>[0]>>

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

  it("preserves the last workspace when closing it exits the desktop process", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      preserveLastWindowWorkspace: true
    })
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow

    await manager.handleClosed(window.webContents.id)

    expect(store.removeWindow).not.toHaveBeenCalled()
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
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow
    window.webContents.emit("did-finish-load")
    const owner = manager.currentOwnerForWebContents(window.webContents.id)
    expect(owner).toBeDefined()

    manager.saveWorkspace(owner!, { sessions: [] })

    expect(store.saveWindow).toHaveBeenCalledWith({
      workspaceId: firstWorkspace,
      bounds: { x: 18, y: 24, width: 1440, height: 900 },
      maximized: false,
      sessions: []
    })
  })

  it("releases renderer-owned runtime resources after a completed renderer reload", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const onRendererReleased = vi.fn(async () => undefined)
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onRendererReleased
    })
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow

    window.webContents.emit("did-finish-load")
    window.webContents.emit("did-start-loading")
    await flush()

    expect(onRendererReleased).toHaveBeenCalledWith({
      webContentsId: window.webContents.id,
      rendererGeneration: 1
    })
    expect(manager.workspaceForWebContents(window.webContents.id)).toBe(firstWorkspace)
    expect(store.removeWindow).not.toHaveBeenCalled()
  })

  it("reports renderer and window lifecycle events through the fail-open observer", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const lifecycle: unknown[] = []
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onLifecycle: (event) => lifecycle.push(event)
    })
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow

    window.webContents.emit("did-finish-load")
    window.webContents.emit("did-start-loading")
    await manager.handleClosed(window.webContents.id)

    expect(lifecycle).toEqual([
      { kind: "renderer-ready", owner: { webContentsId: 21, rendererGeneration: 1 } },
      { kind: "renderer-reload", owner: { webContentsId: 21, rendererGeneration: 1 } },
      { kind: "window-closed", webContentsId: 21 }
    ])
  })

  it("contains lifecycle observer failures without changing window cleanup", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onLifecycle: () => { throw new Error("diagnostic sink failed") }
    })
    const window = manager.createNew(createWorkspace(firstWorkspace))

    await expect(manager.handleClosed(window.webContents.id)).resolves.toBeUndefined()
    expect(store.removeWindow).toHaveBeenCalledWith(firstWorkspace)
  })

  it("tracks renderer generations and rejects stale owner sends", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const released: RuntimeOwner[] = []
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onRendererReleased: async (owner) => { released.push(owner) }
    })
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow

    window.webContents.emit("did-finish-load")
    const ownerGeneration1 = {
      webContentsId: window.webContents.id,
      rendererGeneration: 1
    }
    expect(manager.currentOwnerForWebContents(window.webContents.id)).toEqual(ownerGeneration1)

    window.webContents.emit("did-start-loading")
    window.webContents.emit("did-finish-load")
    const ownerGeneration2 = {
      webContentsId: window.webContents.id,
      rendererGeneration: 2
    }
    expect(released).toEqual([ownerGeneration1])
    expect(manager.currentOwnerForWebContents(window.webContents.id)).toEqual(ownerGeneration2)

    expect(manager.sendToOwner(ownerGeneration1, "stale-event", { stale: true })).toBe(false)
    expect(manager.sendToOwner(ownerGeneration2, "current-event", { current: true })).toBe(true)
    expect(window.webContents.send).toHaveBeenCalledOnce()
    expect(window.webContents.send).toHaveBeenCalledWith("current-event", { current: true })

    await flush()
  })

  it("ignores late renderer events from a replaced native window", () => {
    const store = createStore()
    const firstWindow = createWindow(21)
    const replacementWindow = createWindow(21)
    const windows = {
      create: vi.fn()
        .mockReturnValueOnce(firstWindow)
        .mockReturnValueOnce(replacementWindow)
    }
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })

    manager.createNew(createWorkspace(firstWorkspace))
    firstWindow.webContents.emit("did-finish-load")
    manager.removeWorkspaceForWindow(firstWindow.webContents.id)
    manager.createNew(createWorkspace(secondWorkspace))
    replacementWindow.webContents.emit("did-finish-load")

    firstWindow.webContents.emit("did-start-loading")

    expect(manager.currentOwnerForWebContents(replacementWindow.webContents.id)).toEqual({
      webContentsId: replacementWindow.webContents.id,
      rendererGeneration: 2
    })
  })

  it("captures native bounds when a window moves without waiting for renderer state", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const window = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow

    window.emit("move")
    await flush()

    expect(store.updateWindowBounds).toHaveBeenCalledWith(firstWorkspace, {
      bounds: { x: 18, y: 24, width: 1440, height: 900 },
      maximized: false
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

  it("contains a rejecting window cleanup callback after removing its workspace", async () => {
    const store = createStore()
    const windows = createWindowFactory()
    const onWindowClosed = vi.fn(async () => {
      throw new Error("cleanup failed")
    })
    const manager = new WorkspaceWindowManager({
      snapshots: store,
      createWindow: windows.create,
      onWindowClosed
    })
    const window = manager.createNew(createWorkspace(firstWorkspace))

    await expect(manager.handleClosed(window.webContents.id)).resolves.toBeUndefined()

    expect(store.removeWindow).toHaveBeenCalledWith(firstWorkspace)
    expect(onWindowClosed).toHaveBeenCalledWith(window.webContents.id)
  })

  it("restores and focuses the most recently focused live window", () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const first = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow
    const second = manager.createNew(createWorkspace(secondWorkspace)) as FakeWindow
    vi.mocked(second.isMinimized).mockReturnValue(true)

    first.emit("focus")
    second.emit("focus")

    expect(manager.focusMostRecentOrCreate()).toBe(second)
    expect(second.restore).toHaveBeenCalledOnce()
    expect(second.show).toHaveBeenCalledOnce()
    expect(second.focus).toHaveBeenCalledOnce()
    expect(first.focus).not.toHaveBeenCalled()
  })

  it("skips destroyed windows when focusing the most recent live window", () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const first = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow
    const second = manager.createNew(createWorkspace(secondWorkspace)) as FakeWindow

    first.emit("focus")
    second.emit("focus")
    vi.mocked(second.isDestroyed).mockReturnValue(true)

    expect(manager.focusMostRecentOrCreate()).toBe(first)
    expect(first.show).toHaveBeenCalledOnce()
    expect(first.focus).toHaveBeenCalledOnce()
    expect(second.focus).not.toHaveBeenCalled()
  })

  it("creates a window when no live windows remain", () => {
    const store = createStore()
    const windows = createWindowFactory()
    const manager = new WorkspaceWindowManager({ snapshots: store, createWindow: windows.create })
    const existing = manager.createNew(createWorkspace(firstWorkspace)) as FakeWindow
    vi.mocked(existing.isDestroyed).mockReturnValue(true)

    const created = manager.focusMostRecentOrCreate()

    expect(windows.create).toHaveBeenCalledTimes(2)
    expect(created).toBe(windows.created[1])
  })
})

function createStore(document: StoredWorkspaceDocument = { version: 1, windows: [] }) {
  return {
    load: vi.fn(async () => structuredClone(document)),
    saveWindow: vi.fn(),
    removeWindow: vi.fn(),
    updateWindowBounds: vi.fn()
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
  const listeners = new Map<string, Array<() => void>>()
  const webContentsListeners = new Map<string, Array<() => void>>()
  return {
    webContents: {
      id,
      send: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        const once = (): void => {
          listener()
          const entries = webContentsListeners.get(event)
          if (entries) webContentsListeners.set(event, entries.filter((entry) => entry !== once))
        }
        webContentsListeners.set(event, [...(webContentsListeners.get(event) ?? []), once])
      }),
      on: vi.fn((event: string, listener: () => void) => {
        webContentsListeners.set(event, [...(webContentsListeners.get(event) ?? []), listener])
      }),
      emit: (event: string) => webContentsListeners.get(event)?.forEach((listener) => listener())
    },
    maximize: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 18, y: 24, width: 1440, height: 900 })),
    isMaximized: vi.fn(() => false),
    once: vi.fn((event: "closed", listener: () => void) => {
      if (event === "closed") closedListeners.push(listener)
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    emit: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
    close: () => closedListeners.forEach((listener) => listener())
  }
}

type FakeWindow = Omit<WorkspaceWindow, "maximize" | "isMinimized" | "restore" | "show" | "focus" | "on"> & {
  webContents: WorkspaceWindow["webContents"] & {
    on(event: string, listener: () => void): void
    emit(event: string): void
  }
  maximize: Mock<() => void>
  isMinimized: Mock<() => boolean>
  restore: Mock<() => void>
  show: Mock<() => void>
  focus: Mock<() => void>
  on(event: string, listener: () => void): void
  emit(event: string): void
  close(): void
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function createWorkspace(
  workspaceId: string,
  bounds?: { x: number; y: number; width: number; height: number },
  maximized = false
): StoredWorkspaceWindow {
  return { workspaceId, bounds, maximized, sessions: [] }
}
