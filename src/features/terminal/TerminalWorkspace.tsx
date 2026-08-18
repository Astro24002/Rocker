import { CircleStop, RotateCcw, Trash2 } from "lucide-react"
import { IconButton } from "../../components/IconButton"
import type { TerminalTab } from "./session-state"
import { TerminalView } from "./TerminalView"

interface TerminalWorkspaceProps {
  tabs: TerminalTab[]
  activeId?: string
  onActivate(id: string): void
  onClose(tab: TerminalTab): void
  onNew(): void
  onReconnect(tab: TerminalTab): void
  onDisconnect(tab: TerminalTab): void
  onClear(tab: TerminalTab): void
  onInput(tab: TerminalTab, data: string): void
  onResize(tab: TerminalTab, cols: number, rows: number): void
}

export function TerminalWorkspace(props: TerminalWorkspaceProps) {
  const activeTab = props.tabs.find((tab) => tab.id === props.activeId)
  const splitTabs = activeTab?.pane
    ? props.tabs.filter((tab) => tab.id === activeTab.id || tab.id === activeTab.pane?.parentId)
    : props.tabs.filter((tab) => tab.id === activeTab?.id || tab.pane?.parentId === activeTab?.id)
  return (
    <section className="terminal-workspace">
      <div className="terminal-toolbar">
        <span className="terminal-session-title">{activeTab?.label ?? "Session"}</span>
        {activeTab && <div className="terminal-actions">
          <IconButton label="Reconnect" onClick={() => props.onReconnect(activeTab)}><RotateCcw size={15} /></IconButton>
          <IconButton label="Disconnect" onClick={() => props.onDisconnect(activeTab)}><CircleStop size={15} /></IconButton>
          <IconButton label="Clear terminal" onClick={() => props.onClear(activeTab)}><Trash2 size={15} /></IconButton>
        </div>}
      </div>
      <div className="terminal-stack" data-split={splitTabs.length > 1}>
        {splitTabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={true}
            onInput={(data) => props.onInput(tab, data)}
            onResize={(cols, rows) => props.onResize(tab, cols, rows)}
          />
        ))}
      </div>
    </section>
  )
}
