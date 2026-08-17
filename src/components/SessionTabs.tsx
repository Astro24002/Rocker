import { Plus } from "lucide-react"
import { IconButton } from "./IconButton"

export interface SessionTabItem {
  id: string
  label: string
  state: "connecting" | "connected" | "disconnected" | "error"
}

interface SessionTabsProps {
  tabs: SessionTabItem[]
  activeId?: string
  onActivate(id: string): void
  onNew(): void
}

export function SessionTabs({ tabs, activeId, onActivate, onNew }: SessionTabsProps) {
  return (
    <div className="session-tabs">
      {tabs.map((tab) => (
        <button key={tab.id} className="session-tab" data-active={tab.id === activeId} type="button" onClick={() => onActivate(tab.id)}>
          <span className="session-state-dot" data-state={tab.state} />
          <span>{tab.label}</span>
        </button>
      ))}
      <IconButton label="New session" className="new-session-button" onClick={onNew}>
        <Plus size={15} />
      </IconButton>
    </div>
  )
}
