import { randomUUID } from "node:crypto"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import type { WorkspaceSnapshotStore } from "../storage/workspace-store"
import type { StoredWorkspaceWindow } from "../storage/types"

export interface WorkspaceWindowOptions {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface WorkspaceWindow {
  readonly webContents: {
    readonly id: number
    send(channel: string, ...args: unknown[]): void
    once(event: "did-finish-load", listener: () => void): void
    on(event: "did-finish-load" | "did-start-loading" | "render-process-gone", listener: () => void): void
  }
  once(event: "closed", listener: () => void): void
  on(event: "close" | "move" | "resize" | "focus", listener: () => void): void
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  getBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
  maximize(): void
}

export type WindowLifecycleEvent =
  | { kind: "renderer-ready"; owner: RuntimeOwner }
  | { kind: "renderer-reload" | "renderer-gone"; owner: RuntimeOwner }
  | { kind: "window-closed"; webContentsId: number }

export interface WorkspaceWindowManagerOptions {
  snapshots: Pick<WorkspaceSnapshotStore, "load" | "saveWindow" | "removeWindow" | "updateWindowBounds">
  createWindow(options?: WorkspaceWindowOptions): WorkspaceWindow
  onWindowClosed?(ownerWebContentsId: number): Promise<void> | void
  onRendererReleased?(owner: RuntimeOwner): Promise<void> | void
  onLifecycle?(event: WindowLifecycleEvent): void
  preserveLastWindowWorkspace?: boolean
}

interface RendererGenerationRecord {
  generation: number
  owner?: RuntimeOwner
}

export class WorkspaceWindowManager {
  private readonly workspaceByWebContentsId = new Map<number, string>()
  private readonly windows = new Map<number, WorkspaceWindow>()
  private readonly focusedWebContentsIds = new Set<number>()
  private readonly rendererGenerations = new Map<number, RendererGenerationRecord>()
  private quitting = false

  public constructor(private readonly options: WorkspaceWindowManagerOptions) {}

  public createNew(snapshot?: StoredWorkspaceWindow): WorkspaceWindow {
    const window = this.options.createWindow(snapshot?.bounds)
    const ownerWebContentsId = window.webContents.id
    const workspaceId = snapshot?.workspaceId ?? randomUUID()
    this.workspaceByWebContentsId.set(ownerWebContentsId, workspaceId)
    this.windows.set(ownerWebContentsId, window)
    const rendererRecord = this.rendererGenerations.get(ownerWebContentsId)
    if (rendererRecord) rendererRecord.owner = undefined
    else this.rendererGenerations.set(ownerWebContentsId, { generation: 0 })
    if (snapshot?.maximized) window.maximize()
    window.webContents.on("did-finish-load", () => {
      const record = this.rendererGenerations.get(ownerWebContentsId)
      if (!record || this.windows.get(ownerWebContentsId) !== window) return
      const owner: RuntimeOwner = {
        webContentsId: ownerWebContentsId,
        rendererGeneration: record.generation + 1
      }
      record.generation = owner.rendererGeneration
      record.owner = owner
      this.emitLifecycle({ kind: "renderer-ready", owner })
    })
    window.webContents.on("did-start-loading", () => {
      this.invalidateRenderer(window, ownerWebContentsId, "renderer-reload")
    })
    window.webContents.on("render-process-gone", () => {
      this.invalidateRenderer(window, ownerWebContentsId, "renderer-gone")
    })
    window.on("move", () => this.captureWindowBounds(ownerWebContentsId))
    window.on("resize", () => this.captureWindowBounds(ownerWebContentsId))
    window.on("close", () => this.captureWindowBounds(ownerWebContentsId))
    window.on("focus", () => this.recordFocus(window, ownerWebContentsId))
    window.once("closed", () => {
      void this.handleClosed(ownerWebContentsId)
    })
    return window
  }

  public focusMostRecentOrCreate(): WorkspaceWindow {
    const target = this.mostRecentLiveWindow()
    if (!target) return this.createNew()

    if (target.isMinimized()) target.restore()
    target.show()
    target.focus()
    return target
  }

  public async restoreWindows(): Promise<WorkspaceWindow[]> {
    const snapshot = await this.options.snapshots.load()
    return snapshot.windows.map((window) => this.createNew(window))
  }

  public workspaceForWebContents(ownerWebContentsId: number): string | undefined {
    return this.workspaceByWebContentsId.get(ownerWebContentsId)
  }

  public currentOwnerForWebContents(webContentsId: number): RuntimeOwner | undefined {
    return this.rendererGenerations.get(webContentsId)?.owner
  }

  public windowForOwner(owner: RuntimeOwner): WorkspaceWindow | undefined {
    const currentOwner = this.currentOwnerForWebContents(owner.webContentsId)
    if (!currentOwner || !sameRuntimeOwner(currentOwner, owner)) return undefined
    return this.windows.get(owner.webContentsId)
  }

  public windowForWebContents(ownerWebContentsId: number): WorkspaceWindow | undefined {
    return this.windows.get(ownerWebContentsId)
  }

  public sendToOwner(owner: RuntimeOwner, channel: string, ...args: unknown[]): boolean {
    const window = this.windowForOwner(owner)
    if (!window) return false
    try {
      if (window.isDestroyed()) return false
      window.webContents.send(channel, ...args)
      return true
    } catch {
      return false
    }
  }

  public ownerWebContentsIds(): number[] {
    return [...this.windows.keys()]
  }

  public async loadWorkspace(owner: RuntimeOwner): Promise<StoredWorkspaceWindow | undefined> {
    const window = this.windowForOwner(owner)
    if (!window) return undefined
    const workspaceId = this.workspaceForWebContents(owner.webContentsId)
    if (!workspaceId) return undefined
    const snapshot = await this.options.snapshots.load()
    if (!this.windowForOwner(owner)) return undefined
    return snapshot.windows.find((window) => window.workspaceId === workspaceId)
  }

  public saveWorkspace(
    owner: RuntimeOwner,
    snapshot: Omit<StoredWorkspaceWindow, "workspaceId" | "bounds" | "maximized">
  ): void {
    const window = this.windowForOwner(owner)
    const workspaceId = this.workspaceForWebContents(owner.webContentsId)
    if (!workspaceId || !window || window.isDestroyed()) throw new Error("Workspace window was not found")
    this.options.snapshots.saveWindow({
      ...snapshot,
      workspaceId,
      bounds: window.getBounds(),
      maximized: window.isMaximized()
    })
  }

  public flushWindowBounds(): void {
    for (const ownerWebContentsId of this.windows.keys()) this.captureWindowBounds(ownerWebContentsId)
  }

  public removeWorkspaceForWindow(ownerWebContentsId: number): void {
    this.workspaceByWebContentsId.delete(ownerWebContentsId)
    this.windows.delete(ownerWebContentsId)
    this.focusedWebContentsIds.delete(ownerWebContentsId)
    const rendererRecord = this.rendererGenerations.get(ownerWebContentsId)
    if (rendererRecord) rendererRecord.owner = undefined
  }

  public beginQuit(): void {
    this.quitting = true
  }

  public endQuitForTest(): void {
    this.quitting = false
  }

  public async handleClosed(ownerWebContentsId: number): Promise<void> {
    const workspaceId = this.workspaceForWebContents(ownerWebContentsId)
    const preserveLastWindowWorkspace = this.options.preserveLastWindowWorkspace === true && this.windows.size === 1
    const removeWorkspace = !this.quitting && !preserveLastWindowWorkspace && workspaceId !== undefined
    this.removeWorkspaceForWindow(ownerWebContentsId)
    this.emitLifecycle({ kind: "window-closed", webContentsId: ownerWebContentsId })
    if (removeWorkspace) this.options.snapshots.removeWindow(workspaceId)
    try {
      await this.options.onWindowClosed?.(ownerWebContentsId)
    } catch {
      // Window-close cleanup is best effort and must not escape the close handler.
    }
  }

  private invalidateRenderer(
    window: WorkspaceWindow,
    webContentsId: number,
    kind: "renderer-reload" | "renderer-gone"
  ): void {
    if (this.windows.get(webContentsId) !== window) return
    const record = this.rendererGenerations.get(webContentsId)
    const owner = record?.owner
    if (!record || !owner) return
    record.owner = undefined
    this.emitLifecycle({ kind, owner })
    this.releaseRenderer(owner)
  }

  private releaseRenderer(owner: RuntimeOwner): void {
    try {
      const cleanup = this.options.onRendererReleased?.(owner)
      void Promise.resolve(cleanup).catch(() => undefined)
    } catch {
      // Renderer cleanup must not escape the native window event callback.
    }
  }

  private emitLifecycle(event: WindowLifecycleEvent): void {
    try {
      this.options.onLifecycle?.(event)
    } catch {
      // Lifecycle observers are best effort and must not affect window state.
    }
  }

  private captureWindowBounds(ownerWebContentsId: number): void {
    const workspaceId = this.workspaceForWebContents(ownerWebContentsId)
    const window = this.windowForWebContents(ownerWebContentsId)
    if (!workspaceId || !window || window.isDestroyed()) return
    this.options.snapshots.updateWindowBounds(workspaceId, {
      bounds: window.getBounds(),
      maximized: window.isMaximized()
    })
  }

  private recordFocus(window: WorkspaceWindow, ownerWebContentsId: number): void {
    if (this.windows.get(ownerWebContentsId) !== window || window.isDestroyed()) return
    this.focusedWebContentsIds.delete(ownerWebContentsId)
    this.focusedWebContentsIds.add(ownerWebContentsId)
  }

  private mostRecentLiveWindow(): WorkspaceWindow | undefined {
    const focusedIds = [...this.focusedWebContentsIds].reverse()
    for (const ownerWebContentsId of focusedIds) {
      const window = this.windowForLiveWebContents(ownerWebContentsId)
      if (window) return window
    }

    const entries = [...this.windows.entries()].reverse()
    for (const [ownerWebContentsId] of entries) {
      const window = this.windowForLiveWebContents(ownerWebContentsId)
      if (window) return window
    }

    return undefined
  }

  private windowForLiveWebContents(ownerWebContentsId: number): WorkspaceWindow | undefined {
    const window = this.windows.get(ownerWebContentsId)
    if (!window || window.isDestroyed()) return undefined
    return window
  }
}
