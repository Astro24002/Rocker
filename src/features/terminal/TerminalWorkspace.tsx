import type { MonitorState } from "../monitoring/monitor-state"
import { MonitorSummary } from "../monitoring/MonitorSummary"
import type { TerminalTab } from "./session-state"
import { TerminalView } from "./TerminalView"

interface TerminalWorkspaceProps {
  tabs: TerminalTab[]
  activeId?: string
  monitor: MonitorState
  monitorHostName?: string
  onMonitorToggle(): void
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
      <MonitorSummary state={props.monitor} hostName={props.monitorHostName} onToggle={props.onMonitorToggle} />
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
