import { describe, expect, it, vi } from "vitest"
import { handleGlobalShortcut, matchGlobalShortcut, shouldIgnoreGlobalShortcutTarget } from "./command-shortcuts"

describe("global command shortcuts", () => {
  it.each([
    ["win32", "f", true, false, "terminal.search"],
    ["linux", "P", true, false, "palette.open"],
    ["darwin", "f", false, true, "terminal.search"],
    ["darwin", "P", false, true, "palette.open"]
  ])("matches the exact platform shortcut on %s", (platform, key, ctrlKey, metaKey, commandId) => {
    const event = shortcutEvent({ key, ctrlKey, metaKey, shiftKey: true })

    expect(matchGlobalShortcut(event, platform as NodeJS.Platform)).toBe(commandId)
  })

  it.each([
    { altKey: true },
    { ctrlKey: true, metaKey: true },
    { shiftKey: false },
    { key: "Shift", ctrlKey: true, shiftKey: true },
    { key: "Control", ctrlKey: true, shiftKey: true },
    { key: "f", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, defaultPrevented: true }
  ])("rejects an inexact or already-prevented event", (override) => {
    expect(matchGlobalShortcut(shortcutEvent(override), "linux")).toBeUndefined()
  })

  it("passes every listed Linux shell shortcut through without preventing it", () => {
    for (const key of ["c", "d", "z", "l", "a", "e", "f", "k", "u", "w"]) {
      const preventDefault = vi.fn()
      const event = shortcutEvent({ key, ctrlKey: true, shiftKey: false, preventDefault })

      expect(handleGlobalShortcut(event, "linux", vi.fn())).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    }
  })

  it("handles only a matched exact shortcut and prevents its browser default", () => {
    const preventDefault = vi.fn()
    const onCommand = vi.fn()
    const event = shortcutEvent({ key: "p", ctrlKey: true, shiftKey: true, preventDefault })

    expect(handleGlobalShortcut(event, "linux", onCommand)).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledWith("palette.open")
  })

  it("ignores editable targets unless they are in an explicit palette or search surface", () => {
    const input = document.createElement("input")
    const textarea = document.createElement("textarea")
    const contentEditable = document.createElement("div")
    contentEditable.contentEditable = "true"
    const palette = document.createElement("div")
    palette.dataset.commandPalette = "true"
    const paletteInput = document.createElement("input")
    palette.append(paletteInput)
    const search = document.createElement("div")
    search.className = "terminal-search-overlay"
    const searchInput = document.createElement("input")
    search.append(searchInput)

    expect(shouldIgnoreGlobalShortcutTarget(input)).toBe(true)
    expect(shouldIgnoreGlobalShortcutTarget(textarea)).toBe(true)
    expect(shouldIgnoreGlobalShortcutTarget(contentEditable)).toBe(true)
    expect(shouldIgnoreGlobalShortcutTarget(paletteInput)).toBe(false)
    expect(shouldIgnoreGlobalShortcutTarget(searchInput)).toBe(false)
    expect(shouldIgnoreGlobalShortcutTarget(document.createElement("button"))).toBe(false)
  })
})

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const event = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "f",
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    target: null,
    ...overrides
  }
  return event as unknown as KeyboardEvent
}
