import { randomUUID } from "node:crypto"
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
  }
  once(event: "closed", listener: () => void): void
  isDestroyed(): boolean
  getBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
  maximize(): void
}

export interface WorkspaceWindowManagerOptions {
  snapshots: Pick<WorkspaceSnapshotStore, "load" | "saveWindow" | "removeWindow">
  createWindow(options?: WorkspaceWindowOptions): WorkspaceWindow
  onWindowClosed?(ownerWebContentsId: number): Promise<void> | void
}

export class WorkspaceWindowManager {
  private readonly workspaceByWebContentsId = new Map<number, string>()
  private readonly windows = new Map<number, WorkspaceWindow>()
  private quitting = false

  public constructor(private readonly options: WorkspaceWindowManagerOptions) {}

  public createNew(snapshot?: StoredWorkspaceWindow): WorkspaceWindow {
    const window = this.options.createWindow(snapshot?.bounds)
    const ownerWebContentsId = window.webContents.id
    const workspaceId = snapshot?.workspaceId ?? randomUUID()
    this.workspaceByWebContentsId.set(ownerWebContentsId, workspaceId)
    this.windows.set(ownerWebContentsId, window)
    if (snapshot?.maximized) window.maximize()
    window.once("closed", () => {
      void this.handleClosed(ownerWebContentsId)
    })
    return window
  }

  public async restoreWindows(): Promise<WorkspaceWindow[]> {
    const snapshot = await this.options.snapshots.load()
    return snapshot.windows.map((window) => this.createNew(window))
  }

  public workspaceForWebContents(ownerWebContentsId: number): string | undefined {
    return this.workspaceByWebContentsId.get(ownerWebContentsId)
  }

  public windowForWebContents(ownerWebContentsId: number): WorkspaceWindow | undefined {
    return this.windows.get(ownerWebContentsId)
  }

  public ownerWebContentsIds(): number[] {
    return [...this.windows.keys()]
  }

  public async loadWorkspace(ownerWebContentsId: number): Promise<StoredWorkspaceWindow | undefined> {
    const workspaceId = this.workspaceForWebContents(ownerWebContentsId)
    if (!workspaceId) return undefined
    const snapshot = await this.options.snapshots.load()
    return snapshot.windows.find((window) => window.workspaceId === workspaceId)
  }

  public saveWorkspace(
    ownerWebContentsId: number,
    snapshot: Omit<StoredWorkspaceWindow, "workspaceId" | "bounds" | "maximized">
  ): void {
    const workspaceId = this.workspaceForWebContents(ownerWebContentsId)
    const window = this.windowForWebContents(ownerWebContentsId)
    if (!workspaceId || !window || window.isDestroyed()) throw new Error("Workspace window was not found")
    this.options.snapshots.saveWindow({
      ...snapshot,
      workspaceId,
      bounds: window.getBounds(),
      maximized: window.isMaximized()
    })
  }

  public removeWorkspaceForWindow(ownerWebContentsId: number): void {
    this.workspaceByWebContentsId.delete(ownerWebContentsId)
    this.windows.delete(ownerWebContentsId)
  }

  public beginQuit(): void {
    this.quitting = true
  }

  public endQuitForTest(): void {
    this.quitting = false
  }

  public async handleClosed(ownerWebContentsId: number): Promise<void> {
    const workspaceId = this.workspaceForWebContents(ownerWebContentsId)
    const removeWorkspace = !this.quitting && workspaceId !== undefined
    this.removeWorkspaceForWindow(ownerWebContentsId)
    if (removeWorkspace) this.options.snapshots.removeWindow(workspaceId)
    await this.options.onWindowClosed?.(ownerWebContentsId)
  }
}
