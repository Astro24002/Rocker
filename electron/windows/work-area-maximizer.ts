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
  on(event: "maximize", listener: () => void): void
  once(event: "closed", listener: () => void): void
}

export class WorkAreaMaximizer {
  private readonly normalBounds = new Map<WorkAreaWindow, WindowBounds>()

  public constructor(private readonly workAreaFor: (bounds: WindowBounds) => WindowBounds) {}

  public track(window: WorkAreaWindow): void {
    window.on("maximize", () => this.maximize(window))
    window.once("closed", () => this.normalBounds.delete(window))
  }

  public maximize(window: WorkAreaWindow): void {
    if (this.normalBounds.has(window)) return
    const normal = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
    if (window.isMaximized()) window.unmaximize()
    this.normalBounds.set(window, normal)
    window.setBounds(this.workAreaFor(normal))
  }

  public toggle(window: WorkAreaWindow): void {
    const normal = this.normalBounds.get(window)
    if (!normal) {
      this.maximize(window)
      return
    }
    this.normalBounds.delete(window)
    if (window.isMaximized()) window.unmaximize()
    window.setBounds(normal)
  }

  public isMaximized(window: WorkAreaWindow): boolean {
    return this.normalBounds.has(window) || window.isMaximized()
  }

  public boundsToSave(window: WorkAreaWindow): WindowBounds {
    return this.normalBounds.get(window) ?? (window.isMaximized() ? window.getNormalBounds() : window.getBounds())
  }

  public refreshWorkAreas(): void {
    for (const [window] of this.normalBounds) {
      window.setBounds(this.workAreaFor(window.getBounds()))
    }
  }
}
