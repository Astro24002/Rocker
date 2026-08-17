import { CircleStop, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { IconButton } from "../../components/IconButton"
import type { TerminalTab } from "./session-state"

interface TerminalTabsProps {
  tabs: TerminalTab[]
  activeId?: string
  onActivate(id: string): void
  onClose(tab: TerminalTab): void
  onNew(): void
  onReconnect(tab: TerminalTab): void
  onDisconnect(tab: TerminalTab): void
  onClear(tab: TerminalTab): void
}

export function TerminalTabs({ tabs, activeId, onActivate, onClose, onNew, onReconnect, onDisconnect, onClear }: TerminalTabsProps) {
  const activeTab = tabs.find((tab) => tab.id === activeId)
  return (
    <div className="terminal-toolbar">
      <div className="terminal-tab-strip">
        {tabs.map((tab) => (
          <button key={tab.id} className="terminal-tab" data-active={tab.id === activeId} type="button" onClick={() => onActivate(tab.id)}>
            <span className="session-state-dot" data-state={tab.state} />
            <span className="terminal-tab-label">{tab.label}</span>
            <span className="terminal-tab-close" role="button" aria-label={`Close ${tab.label}`} onClick={(event) => { event.stopPropagation(); onClose(tab) }}><X size={13} /></span>
          </button>
        ))}
        <IconButton label="New session" className="new-session-button" onClick={onNew}><Plus size={15} /></IconButton>
      </div>
      {activeTab && <div className="terminal-actions">
        <IconButton label="Reconnect" onClick={() => onReconnect(activeTab)}><RotateCcw size={15} /></IconButton>
        <IconButton label="Disconnect" onClick={() => onDisconnect(activeTab)}><CircleStop size={15} /></IconButton>
        <IconButton label="Clear terminal" onClick={() => onClear(activeTab)}><Trash2 size={15} /></IconButton>
      </div>}
    </div>
  )
}
