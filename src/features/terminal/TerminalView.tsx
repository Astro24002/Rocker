import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useEffect, useRef } from "react"
import type { TerminalTab } from "./session-state"

interface TerminalViewProps {
  tab: TerminalTab
  active: boolean
  onInput(data: string): void
  onResize(cols: number, rows: number): void
}

export function TerminalView({ tab, active, onInput, onResize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const writtenRef = useRef(0)

  useEffect(() => {
    if (!containerRef.current) return
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 8_000,
      theme: {
        background: "#11131b",
        foreground: "#d8ddcf",
        cursor: "#86de67",
        selectionBackground: "#38533a",
        black: "#171921",
        red: "#ef7777",
        green: "#86de67",
        yellow: "#e7b85f",
        blue: "#71a9e8",
        magenta: "#c792d6",
        cyan: "#51c8c1",
        white: "#d9dce4"
      }
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(containerRef.current)
    terminal.write(tab.output)
    writtenRef.current = tab.output.length
    terminalRef.current = terminal
    fitRef.current = fit
    const dataDisposable = terminal.onData(onInput)
    const resizeDisposable = terminal.onResize(({ cols, rows }) => onResize(cols, rows))
    const observer = new ResizeObserver(() => {
      if (active) fit.fit()
    })
    observer.observe(containerRef.current)
    queueMicrotask(() => fit.fit())
    return () => {
      observer.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || tab.output.length <= writtenRef.current) return
    terminal.write(tab.output.slice(writtenRef.current))
    writtenRef.current = tab.output.length
  }, [tab.output])

  useEffect(() => {
    if (active) queueMicrotask(() => fitRef.current?.fit())
  }, [active])

  return <div className="terminal-surface" data-active={active} ref={containerRef} />
}
