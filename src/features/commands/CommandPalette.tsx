import { Command, CornerDownLeft, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useI18n } from "../../i18n"
import type { TranslationKey } from "../../i18n/en"
import {
  commandRegistry,
  executeCommand,
  filterCommands,
  groupCommands,
  isCommandEnabled,
  type CommandCategory,
  type CommandContext,
  type CommandDefinition,
  type RecentSessionCommand
} from "./command-registry"

export interface CommandPaletteProps {
  open: boolean
  context: CommandContext
  onClose(): void
  onRestoreFocus(): void
}

type PaletteStatus = "failed" | "disabled"
type PaletteItem =
  | { kind: "recent"; entry: RecentSessionCommand }
  | { kind: "command"; command: CommandDefinition }

const categoryLabels: Record<CommandCategory, TranslationKey> = {
  terminal: "commands.terminal",
  session: "commands.session",
  navigation: "commands.navigation",
  palette: "commands.palette"
}

export function CommandPalette({ open, context, onClose, onRestoreFocus }: CommandPaletteProps) {
  const { t } = useI18n()
  const queryRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [status, setStatus] = useState<PaletteStatus>()

  const visibleCommands = useMemo(() => {
    const paletteCommands = commandRegistry.filter((command) => command.id !== "palette.open")
    return filterCommands(paletteCommands, query)
  }, [query])
  const recentSessions = useMemo(() => {
    if (query.trim().length > 0) return []
    return [...context.recentSessions].sort((left, right) => right.lastFocusedAt - left.lastFocusedAt || left.id.localeCompare(right.id))
  }, [context.recentSessions, query])
  const items = useMemo<PaletteItem[]>(() => [
    ...recentSessions.map((entry) => ({ kind: "recent" as const, entry })),
    ...visibleCommands.map((command) => ({ kind: "command" as const, command }))
  ], [recentSessions, visibleCommands])
  const groups = useMemo(() => groupCommands(visibleCommands), [visibleCommands])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedIndex(0)
    setStatus(undefined)
    queryRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || items.length === 0) return
    setSelectedIndex((current) => {
      if (current >= 0 && current < items.length && isSelectable(items[current], context)) return current
      return items.findIndex((item) => isSelectable(item, context))
    })
  }, [context, items, open])

  if (!open) return null

  const closePalette = (): void => {
    onClose()
    onRestoreFocus()
  }

  const moveSelection = (direction: 1 | -1): void => {
    if (items.length === 0) return
    let next = selectedIndex
    for (let step = 0; step < items.length; step += 1) {
      next = (next + direction + items.length) % items.length
      if (isSelectable(items[next], context)) {
        setSelectedIndex(next)
        return
      }
    }
  }

  const executeItem = async (itemIndex: number): Promise<void> => {
    const item = items[itemIndex]
    if (!item) return
    if (item.kind === "recent") {
      try {
        await context.actions.session.activate(item.entry.session)
        closePalette()
      } catch {
        setStatus("failed")
      }
      return
    }

    const result = await executeCommand(item.command.id, context)
    if (result.status === "executed") {
      closePalette()
    } else {
      setStatus(result.status === "disabled" ? "disabled" : "failed")
    }
  }

  const executeSelected = (): Promise<void> => executeItem(selectedIndex)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault()
      closePalette()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      moveSelection(1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      moveSelection(-1)
    } else if (event.key === "Enter") {
      event.preventDefault()
      void executeSelected()
    }
  }

  return (
    <div className="command-palette-backdrop" data-command-palette="true" onMouseDown={(event) => { if (event.target === event.currentTarget) closePalette() }}>
      <section aria-label={t("commands.title")} aria-modal="true" className="command-palette" onKeyDownCapture={handleKeyDown} role="dialog">
        <div className="command-palette-header">
          <div className="command-palette-title"><Command aria-hidden="true" size={16} /><strong>{t("commands.title")}</strong></div>
          <button aria-label={t("commands.closePalette")} className="command-palette-close" onClick={closePalette} title={t("commands.closePalette")} type="button"><X size={15} /></button>
        </div>
        <label className="command-palette-query">
          <Search aria-hidden="true" size={15} />
          <input
            aria-activedescendant={items[selectedIndex] ? paletteItemId(items[selectedIndex], selectedIndex) : undefined}
            aria-label={t("commands.input")}
            autoComplete="off"
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); setStatus(undefined) }}
            ref={queryRef}
            role="searchbox"
            type="search"
            value={query}
          />
          <kbd><CornerDownLeft aria-hidden="true" size={12} /> Enter</kbd>
        </label>
        <div aria-label={t("commands.title")} className="command-palette-list" role="listbox">
          {recentSessions.length > 0 && (
            <div className="command-palette-group command-palette-recent-group">
              <h3>{t("commands.recentSessions")}</h3>
              {recentSessions.map((entry, index) => {
                const itemIndex = index
                return <PaletteRow key={entry.id} disabled={false} id={paletteItemId({ kind: "recent", entry }, itemIndex)} label={entry.label} selected={selectedIndex === itemIndex} onClick={() => { setSelectedIndex(itemIndex); void executeItem(itemIndex) }} onMouseEnter={() => setSelectedIndex(itemIndex)} />
              })}
            </div>
          )}
          {groups.map((group) => {
            let groupOffset = recentSessions.length
            for (const preceding of groups) {
              if (preceding === group) break
              groupOffset += preceding.commands.length
            }
            return (
              <div className="command-palette-group" key={group.category}>
                <h3>{t(categoryLabels[group.category])}</h3>
                {group.commands.map((command, index) => {
                  const itemIndex = groupOffset + index
                  const enabled = isCommandEnabled(command.id, context)
                  return <PaletteRow key={command.id} command={command} disabled={!enabled} id={paletteItemId({ kind: "command", command }, itemIndex)} label={t(command.labelKey)} selected={selectedIndex === itemIndex} onClick={() => { if (!enabled) return; setSelectedIndex(itemIndex); void executeItem(itemIndex) }} onMouseEnter={() => setSelectedIndex(itemIndex)} />
                })}
              </div>
            )
          })}
          {items.length === 0 && <p className="command-palette-empty">{t("commands.noResults")}</p>}
        </div>
        {status && <p className="command-palette-status" role="status">{t(status === "failed" ? "commands.actionFailed" : "commands.unavailable")}</p>}
      </section>
    </div>
  )
}

function PaletteRow({ command, disabled, id, label, selected, onClick, onMouseEnter }: {
  command?: CommandDefinition
  disabled: boolean
  id: string
  label: string
  selected: boolean
  onClick(): void
  onMouseEnter(): void
}) {
  return (
    <div
      aria-disabled={disabled ? "true" : undefined}
      aria-label={label}
      className="command-palette-row"
      data-command-id={command?.id}
      data-disabled={disabled}
      data-selected={selected}
      id={id}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
    >
      <span className="command-palette-row-copy"><strong>{label}</strong>{command?.shortcut && <small>{command.shortcut}</small>}</span>
    </div>
  )
}

function isSelectable(item: PaletteItem | undefined, context: CommandContext): boolean {
  return item?.kind === "recent" || (item?.kind === "command" && isCommandEnabled(item.command.id, context))
}

function paletteItemId(item: PaletteItem, index: number): string {
  return `command-palette-item-${item.kind}-${item.kind === "recent" ? item.entry.id : item.command.id}-${index}`
}
