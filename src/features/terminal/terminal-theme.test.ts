import { beforeEach, describe, expect, it } from "vitest"
import { readRockerTerminalTheme, ROCKER_TERMINAL_TOKEN_NAMES } from "./terminal-theme"

describe("Rocker terminal theme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style")
  })

  it("maps every terminal token to the xterm theme contract", () => {
    for (const [index, token] of ROCKER_TERMINAL_TOKEN_NAMES.entries()) {
      document.documentElement.style.setProperty(token, "value-" + index)
    }

    expect(readRockerTerminalTheme()).toEqual({
      background: "value-0",
      foreground: "value-1",
      cursor: "value-2",
      selectionBackground: "value-3",
      black: "value-4",
      red: "value-5",
      green: "value-6",
      yellow: "value-7",
      blue: "value-8",
      magenta: "value-9",
      cyan: "value-10",
      white: "value-11",
      brightBlack: "value-12",
      brightRed: "value-13",
      brightGreen: "value-14",
      brightYellow: "value-15",
      brightBlue: "value-16",
      brightMagenta: "value-17",
      brightCyan: "value-18",
      brightWhite: "value-19"
    })
  })

  it("fails with the missing token name instead of inventing a fallback color", () => {
    for (const token of ROCKER_TERMINAL_TOKEN_NAMES.slice(0, -1)) {
      document.documentElement.style.setProperty(token, "#ffffff")
    }

    expect(() => readRockerTerminalTheme()).toThrow("--terminal-bright-white")
  })
})
