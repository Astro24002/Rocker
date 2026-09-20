import { describe, expect, it, vi } from "vitest"
import { WorkAreaMaximizer, type WindowBounds, type WorkAreaWindow } from "./work-area-maximizer"

const normal = { x: -1200, y: 80, width: 1100, height: 760 }
const display = { x: -1280, y: 0, width: 1280, height: 800 }
const reservedTaskbar = { ...display, height: 752 }

function createWindow() {
  let bounds = normal
  let nativeMaximized = false
  const listeners = new Map<string, () => void>()
  const window: WorkAreaWindow = {
    getBounds: vi.fn(() => bounds),
    getNormalBounds: vi.fn(() => normal),
    setBounds: vi.fn((next: WindowBounds) => { bounds = next }),
    setContentBounds: vi.fn((next: WindowBounds) => { bounds = next }),
    isMaximized: vi.fn(() => nativeMaximized),
    unmaximize: vi.fn(() => { nativeMaximized = false }),
    on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) }),
    once: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener) })
  }
  return { window, emit: (event: string) => listeners.get(event)?.(), setNativeMaximized: (next: boolean) => { nativeMaximized = next } }
}

describe("WorkAreaMaximizer", () => {
  it("uses the current display work area and restores the original bounds", () => {
    const { window } = createWindow()
    const workAreaFor = vi.fn(() => reservedTaskbar)
    const placement = new WorkAreaMaximizer(workAreaFor)

    placement.toggle(window)
    expect(workAreaFor).toHaveBeenCalledWith(normal)
    expect(window.setContentBounds).toHaveBeenCalledWith(reservedTaskbar)
    expect(placement.isMaximized(window)).toBe(true)
    expect(placement.boundsToSave(window)).toEqual(normal)

    placement.toggle(window)
    expect(window.setBounds).toHaveBeenCalledWith(normal)
    expect(placement.isMaximized(window)).toBe(false)
  })

  it("fills the display when an auto-hidden taskbar frees the work area", () => {
    const { window } = createWindow()
    let available = reservedTaskbar
    const placement = new WorkAreaMaximizer(() => available)
    placement.track(window)
    placement.maximize(window)

    available = display
    placement.refreshWorkAreas()
    expect(window.setContentBounds).toHaveBeenLastCalledWith(display)
    expect(placement.boundsToSave(window)).toEqual(normal)
  })

  it("converts native title-bar maximization and releases closed windows", () => {
    const { window, emit, setNativeMaximized } = createWindow()
    const placement = new WorkAreaMaximizer(() => reservedTaskbar)
    placement.track(window)
    setNativeMaximized(true)
    emit("maximize")

    expect(window.unmaximize).toHaveBeenCalledOnce()
    expect(window.setContentBounds).toHaveBeenCalledWith(reservedTaskbar)
    expect(placement.isMaximized(window)).toBe(true)

    emit("closed")
    vi.mocked(window.setContentBounds).mockClear()
    placement.refreshWorkAreas()
    expect(window.setContentBounds).not.toHaveBeenCalled()
  })
})
