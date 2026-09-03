import { ClipboardPaste, Copy, Eraser, Focus, ListChecks, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n"
import {
  executeCommand,
  getCommand,
  isCommandEnabled,
  type CommandContext,
  type CommandId
} from "../commands/command-registry"

export interface TerminalContextMenuProps {
  open: boolean
  x: number
  y: number
  context: CommandContext
  onClose(): void
  onRestoreFocus?(request?: CommandId): void
}

const terminalMenuCommands: ReadonlyArray<{ id: Extract<CommandId, `terminal.${string}`>; icon: typeof Copy }> = [
  { id: "terminal.copy", icon: Copy },
  { id: "terminal.paste", icon: ClipboardPaste },
  { id: "terminal.selectAll", icon: ListChecks },
  { id: "terminal.search", icon: Search },
  { id: "terminal.clear", icon: Eraser },
  { id: "terminal.focus", icon: Focus }
]

export function TerminalContextMenu({ open, x, y, context, onClose, onRestoreFocus }: TerminalContextMenuProps) {
  const { t } = useI18n()
  const menuRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"failed" | "disabled">()

  useEffect(() => {
    if (!open) return
    setStatus(undefined)
    menuRef.current?.focus()

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose()
        onRestoreFocus?.()
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return
      event.preventDefault()
      onClose()
      onRestoreFocus?.()
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [onClose, onRestoreFocus, open])

  if (!open) return null

  const runCommand = async (commandId: Extract<CommandId, `terminal.${string}`>): Promise<void> => {
    const result = await executeCommand(commandId, context)
    if (result.status !== "executed") {
      setStatus(result.status)
      return
    }
    onClose()
    onRestoreFocus?.(commandId)
  }

  return (
    <div
      aria-label={t("terminal.contextMenu")}
      className="terminal-context-menu"
      onContextMenu={(event) => event.preventDefault()}
      ref={menuRef}
      role="menu"
      style={{ left: Math.max(8, x), top: Math.max(8, y) }}
      tabIndex={-1}
    >
      {terminalMenuCommands.map(({ id, icon: Icon }) => {
        const command = getCommand(id)
        if (!command) return null
        const enabled = isCommandEnabled(id, context)
        return (
          <button
            aria-disabled={!enabled ? "true" : undefined}
            data-command-id={id}
            disabled={!enabled}
            key={id}
            onClick={() => { if (enabled) void runCommand(id) }}
            role="menuitem"
            title={t(command.labelKey)}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            <span>{t(command.labelKey)}</span>
          </button>
        )
      })}
      {status && <p className="terminal-context-menu-status" role="status">{t(status === "failed" ? "commands.actionFailed" : "commands.unavailable")}</p>}
    </div>
  )
}
