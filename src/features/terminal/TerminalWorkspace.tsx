import type { TerminalDimensions } from "../../../electron/ssh/types"
import type { ReactNode } from "react"
import type { MonitorState } from "../monitoring/monitor-state"
import { MonitorSummary } from "../monitoring/MonitorSummary"
import { visibleSessionIds } from "./layout"
import type { TerminalWorkspaceState } from "./session-state"
import type { TerminalSearchController } from "./terminal-search"
import { TerminalView } from "./TerminalView"
import type { TerminalController, TerminalPreferences } from "./terminal-controller"

interface TerminalWorkspaceProps {
  workspace: TerminalWorkspaceState
  workspaceVisible?: boolean
  overlay?: ReactNode
  monitor: MonitorState
  monitorHostName?: string
  onMonitorToggle(): void
  preferences: TerminalPreferences
  confirmMultilinePaste: boolean
  multilinePasteConfirmation?: string
  onInput(sessionId: string, channelGeneration: number, data: string): void
  onResize(sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void
  onAck(sessionId: string, channelGeneration: number, sequence: number): void
  onController(sessionId: string, controller: TerminalController | undefined): void
  onSearchController?(sessionId: string, controller: TerminalSearchController | undefined): void
}

export function TerminalWorkspace(props: TerminalWorkspaceProps) {
  const visibleIds = new Set(props.workspace.layout
    ? visibleSessionIds(props.workspace.layout)
    : props.workspace.activeSessionId ? [props.workspace.activeSessionId] : props.workspace.sessions.slice(0, 1).map((session) => session.id))
  const visibleCount = [...visibleIds].filter((id) => props.workspace.sessions.some((session) => session.id === id)).length

  return (
    <section className="terminal-workspace">
      <MonitorSummary state={props.monitor} hostName={props.monitorHostName} onToggle={props.onMonitorToggle} />
      {props.overlay}
      <div
        className="terminal-stack"
        data-split={visibleCount > 1}
        style={visibleCount > 1 ? { gridTemplateRows: `repeat(${visibleCount}, minmax(0, 1fr))` } : undefined}
      >
        {props.workspace.sessions.map((session) => (
          <TerminalView
            key={session.id}
            session={session}
            visible={props.workspaceVisible !== false && visibleIds.has(session.id)}
            preferences={props.preferences}
            confirmMultilinePaste={props.confirmMultilinePaste}
            multilinePasteConfirmation={props.multilinePasteConfirmation}
            onInput={(data) => props.onInput(session.id, session.channelGeneration, data)}
            onResize={(dimensions) => props.onResize(session.id, session.channelGeneration, dimensions)}
            onAck={(channelGeneration, sequence) => props.onAck(session.id, channelGeneration, sequence)}
            onController={props.onController}
            onSearchController={props.onSearchController}
          />
        ))}
      </div>
    </section>
  )
}
