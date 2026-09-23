export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkAreaWindow {
  getBounds(): WindowBounds
  getNormalBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
  setContentBounds(bounds: WindowBounds): void
  isMaximized(): boolean
  unmaximize(): void
  isResizable(): boolean
  setResizable(resizable: boolean): void
  on(event: "maximize", listener: () => void): void
  once(event: "closed", listener: () => void): void
}

interface SavedWindowState {
  bounds: WindowBounds
  resizable: boolean
}

export class WorkAreaMaximizer {
  private readonly normalBounds = new Map<WorkAreaWindow, SavedWindowState>()

  public constructor(private readonly workAreaFor: (bounds: WindowBounds) => WindowBounds) {}

  public track(window: WorkAreaWindow): void {
    window.on("maximize", () => this.maximize(window))
    window.once("closed", () => this.normalBounds.delete(window))
  }

  public maximize(window: WorkAreaWindow): void {
    if (this.normalBounds.has(window)) return
    const state: SavedWindowState = {
      bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
      resizable: window.isResizable()
    }
    this.normalBounds.set(window, state)
    if (window.isMaximized()) window.unmaximize()
    // Electron's Windows frameless thick frame adds an invisible resize inset.
    // Disable it while maximized so the visible HWND stays inside workArea.
    window.setResizable(false)
    window.setBounds(this.workAreaFor(state.bounds))
  }

  public toggle(window: WorkAreaWindow): void {
    const state = this.normalBounds.get(window)
    if (!state) {
      this.maximize(window)
      return
    }
    this.normalBounds.delete(window)
    if (window.isMaximized()) window.unmaximize()
    window.setBounds(state.bounds)
    window.setResizable(state.resizable)
  }

  public isMaximized(window: WorkAreaWindow): boolean {
    return this.normalBounds.has(window) || window.isMaximized()
  }

  public boundsToSave(window: WorkAreaWindow): WindowBounds {
    return this.normalBounds.get(window)?.bounds ?? (window.isMaximized() ? window.getNormalBounds() : window.getBounds())
  }

  public refreshWorkAreas(): void {
    for (const [window] of this.normalBounds) {
      window.setBounds(this.workAreaFor(window.getBounds()))
    }
  }
}
