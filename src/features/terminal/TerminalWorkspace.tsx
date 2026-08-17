import type { TerminalTab } from "./session-state"
import { TerminalTabs } from "./TerminalTabs"
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
  return (
    <section className="terminal-workspace">
      <TerminalTabs {...props} />
      <div className="terminal-stack">
        {props.tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            tab={tab}
            active={tab.id === props.activeId}
            onInput={(data) => props.onInput(tab, data)}
            onResize={(cols, rows) => props.onResize(tab, cols, rows)}
          />
        ))}
      </div>
    </section>
  )
}
