import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useI18n } from "../../i18n"
import type { TerminalSearchController, TerminalSearchOptions, TerminalSearchState } from "./terminal-search"

export interface TerminalSearchOverlayProps {
  controller?: TerminalSearchController
  open: boolean
  onClose(): void
}

export function TerminalSearchOverlay({ controller, open, onClose }: TerminalSearchOverlayProps) {
  const { t } = useI18n()
  const queryRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<TerminalSearchState | undefined>(() => controller?.getState())

  useEffect(() => {
    if (!controller || !open) return
    let active = true
    setState(controller.getState())
    const subscription = controller.onStateChange((nextState) => {
      if (active) setState(nextState)
    })
    queryRef.current?.focus()
    return () => {
      active = false
      subscription.dispose()
    }
  }, [controller, open])

  if (!open || !controller) return null

  const controllerState = controller.getState()
  const visibleState = state?.sessionId === controllerState.sessionId ? state : controllerState
  const hasQuery = visibleState.query.length > 0
  const hasResult = visibleState.resultIndex !== undefined && visibleState.resultIndex >= 0 && (visibleState.resultCount ?? 0) > 0
  const hasNoResults = hasQuery && visibleState.resultCount === 0

  const updateOptions = (update: Partial<TerminalSearchOptions>): void => {
    controller.setOptions({ ...controller.getState().options, ...update })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    if (event.shiftKey) controller.findPrevious()
    else controller.findNext()
  }

  return (
    <section aria-label={t("terminal.search")} className="terminal-search-overlay" data-session-id={visibleState.sessionId} role="search">
      <div className="terminal-search-input-row">
        <input
          aria-label={t("terminal.searchInput")}
          autoComplete="off"
          onChange={(event) => controller.setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("terminal.searchInput")}
          ref={queryRef}
          role="searchbox"
          type="search"
          value={visibleState.query}
        />
        <span aria-live="polite" className="terminal-search-result" data-testid="terminal-search-result">
          {hasResult ? `${visibleState.resultIndex! + 1} / ${visibleState.resultCount}` : hasNoResults ? t("terminal.searchNoResults") : null}
        </span>
        <button aria-label={t("terminal.searchClear")} className="terminal-search-icon-button" disabled={!hasQuery} onClick={() => controller.clear()} title={t("terminal.searchClear")} type="button">
          <X size={14} />
        </button>
        <button aria-label={t("terminal.searchPrevious")} className="terminal-search-icon-button" disabled={!hasQuery} onClick={() => controller.findPrevious()} title={t("terminal.searchPrevious")} type="button">
          <ChevronUp size={14} />
        </button>
        <button aria-label={t("terminal.searchNext")} className="terminal-search-icon-button" disabled={!hasQuery} onClick={() => controller.findNext()} title={t("terminal.searchNext")} type="button">
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="terminal-search-options">
        <label>
          <input checked={visibleState.options.caseSensitive} onChange={(event) => updateOptions({ caseSensitive: event.target.checked })} type="checkbox" />
          <span>{t("terminal.searchCaseSensitive")}</span>
        </label>
        <label>
          <input checked={visibleState.options.wholeWord} onChange={(event) => updateOptions({ wholeWord: event.target.checked })} type="checkbox" />
          <span>{t("terminal.searchWholeWord")}</span>
        </label>
        <label>
          <input checked={visibleState.options.regex} onChange={(event) => updateOptions({ regex: event.target.checked })} type="checkbox" />
          <span>{t("terminal.searchRegex")}</span>
        </label>
      </div>
    </section>
  )
}
