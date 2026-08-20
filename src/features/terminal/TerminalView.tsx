import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { useCallback, useEffect, useRef, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from "react"
import type { TerminalDimensions } from "../../../electron/ssh/types"
import type { WorkspaceSession } from "./session-state"
import { TerminalController } from "./terminal-controller"

export interface TerminalViewProps {
  session: WorkspaceSession
  visible: boolean
  fontFamily: string
  fontSize: number
  confirmMultilinePaste: boolean
  multilinePasteConfirmation?: string
  onInput(data: string): void
  onResize(dimensions: TerminalDimensions): void
  onAck(channelGeneration: number, sequence: number): void
  onController(sessionId: string, controller: TerminalController | undefined): void
}

export function TerminalView(props: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const controllerRef = useRef<TerminalController | null>(null)
  const propsRef = useRef(props)
  const frameRef = useRef<number | undefined>(undefined)
  const fitHiddenRef = useRef(false)

  propsRef.current = props

  const scheduleFit = useCallback((includeHidden = false) => {
    if (includeHidden) fitHiddenRef.current = true
    if (frameRef.current !== undefined) return
    const run = (): void => {
      frameRef.current = undefined
      const shouldFit = fitHiddenRef.current || propsRef.current.visible
      fitHiddenRef.current = false
      if (shouldFit) controllerRef.current?.fit()
    }
    if (typeof window.requestAnimationFrame === "function") {
      frameRef.current = window.requestAnimationFrame(run)
      return
    }
    frameRef.current = 0
    queueMicrotask(run)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      disableStdin: propsRef.current.session.state !== "connected",
      fontFamily: propsRef.current.fontFamily,
      fontSize: propsRef.current.fontSize,
      lineHeight: 1.25,
      scrollback: 10_000,
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
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)

    const controller = new TerminalController(
      props.session.id,
      {
        write: (bytes, done) => terminal.write(bytes, done),
        focus: () => terminal.focus(),
        dispose: () => terminal.dispose(),
        setDisableStdin: (disabled) => { terminal.options.disableStdin = disabled },
        setFont: (fontFamily, fontSize) => {
          terminal.options.fontFamily = fontFamily
          terminal.options.fontSize = fontSize
        }
      },
      {
        fit: () => fitAddon.fit(),
        dimensions: () => {
          const dimensions = fitAddon.proposeDimensions()
          return dimensions ? { cols: dimensions.cols, rows: dimensions.rows } : undefined
        }
      },
      {
        onInput: (data) => propsRef.current.onInput(data),
        onResize: (dimensions) => propsRef.current.onResize(dimensions),
        onAck: (channelGeneration, sequence) => propsRef.current.onAck(channelGeneration, sequence)
      }
    )
    controller.setChannelGeneration(propsRef.current.session.channelGeneration)
    controller.setConnected(propsRef.current.session.state === "connected")
    controller.attach()
    terminalRef.current = terminal
    controllerRef.current = controller
    propsRef.current.onController(props.session.id, controller)

    const dataDisposable = terminal.onData((data) => controller.sendInput(data))
    terminal.attachCustomKeyEventHandler((event) => {
      if (isCopyShortcut(event, terminal)) {
        event.preventDefault()
        const selection = terminal.getSelection()
        if (selection) void navigator.clipboard?.writeText(selection).catch(() => undefined)
        return false
      }
      if (!isInterruptKey(event, terminal)) return true
      event.preventDefault()
      controller.sendInput("\u0003")
      return false
    })
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(() => scheduleFit())
    observer?.observe(container)
    scheduleFit(true)

    return () => {
      observer?.disconnect()
      dataDisposable.dispose()
      if (frameRef.current !== undefined && frameRef.current !== 0 && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameRef.current)
      }
      frameRef.current = undefined
      fitHiddenRef.current = false
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
      if (terminalRef.current === terminal) terminalRef.current = null
      propsRef.current.onController(props.session.id, undefined)
    }
  }, [props.session.id, scheduleFit])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setChannelGeneration(props.session.channelGeneration)
    controller.setConnected(props.session.state === "connected")
  }, [props.session.channelGeneration, props.session.state])

  useEffect(() => {
    controllerRef.current?.applyPreferences(props.fontFamily, props.fontSize)
    scheduleFit()
  }, [props.fontFamily, props.fontSize, scheduleFit])

  useEffect(() => {
    if (props.visible) scheduleFit()
  }, [props.visible, scheduleFit])

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const text = event.clipboardData.getData("text/plain")
    if (!text) return
    if (text.includes("\n") && propsRef.current.confirmMultilinePaste) {
      const message = propsRef.current.multilinePasteConfirmation ?? "Paste multiple lines into the terminal?"
      if (!window.confirm(message)) return
    }
    controllerRef.current?.sendInput(text)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || !isInterruptKey(event.nativeEvent, terminalRef.current)) return
    event.preventDefault()
    controllerRef.current?.sendInput("\u0003")
  }

  return (
    <div
      aria-hidden={props.visible ? undefined : true}
      className="terminal-surface"
      data-active={props.visible}
      data-session-id={props.session.id}
      data-testid="terminal-surface"
      data-visible={props.visible}
      onClick={() => controllerRef.current?.focus()}
      onKeyDown={handleKeyDown}
      onPasteCapture={handlePaste}
      ref={containerRef}
      style={props.visible ? undefined : hiddenSurfaceStyle}
      tabIndex={0}
    />
  )
}

const hiddenSurfaceStyle = {
  position: "absolute" as const,
  inset: 0,
  visibility: "hidden" as const,
  pointerEvents: "none" as const
}

function isCopyShortcut(event: globalThis.KeyboardEvent, terminal: Pick<Terminal, "hasSelection" | "getSelection">): boolean {
  if (!terminal.hasSelection() || event.altKey || event.key.toLowerCase() !== "c") return false
  return (event.ctrlKey && event.shiftKey && !event.metaKey) || (event.metaKey && !event.ctrlKey)
}

function isInterruptKey(event: globalThis.KeyboardEvent, terminal: Pick<Terminal, "hasSelection"> | null): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "c" && !terminal?.hasSelection()
}
