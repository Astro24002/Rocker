import type { ITheme } from "@xterm/xterm"

export const ROCKER_TERMINAL_TOKEN_NAMES = [
  "--terminal-bg",
  "--terminal-fg",
  "--terminal-cursor",
  "--terminal-selection",
  "--terminal-black",
  "--terminal-red",
  "--terminal-green",
  "--terminal-yellow",
  "--terminal-blue",
  "--terminal-magenta",
  "--terminal-cyan",
  "--terminal-white",
  "--terminal-bright-black",
  "--terminal-bright-red",
  "--terminal-bright-green",
  "--terminal-bright-yellow",
  "--terminal-bright-blue",
  "--terminal-bright-magenta",
  "--terminal-bright-cyan",
  "--terminal-bright-white"
] as const

export function readRockerTerminalTheme(root: Element = document.documentElement): ITheme {
  const computed = root.ownerDocument?.defaultView?.getComputedStyle(root) ?? getComputedStyle(root)
  const values = ROCKER_TERMINAL_TOKEN_NAMES.map((name) => {
    const value = computed.getPropertyValue(name).trim()
    if (!value) throw new Error("Missing required terminal theme token " + name)
    return value
  })

  return {
    background: values[0],
    foreground: values[1],
    cursor: values[2],
    selectionBackground: values[3],
    black: values[4],
    red: values[5],
    green: values[6],
    yellow: values[7],
    blue: values[8],
    magenta: values[9],
    cyan: values[10],
    white: values[11],
    brightBlack: values[12],
    brightRed: values[13],
    brightGreen: values[14],
    brightYellow: values[15],
    brightBlue: values[16],
    brightMagenta: values[17],
    brightCyan: values[18],
    brightWhite: values[19]
  }
}
