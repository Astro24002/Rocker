import type { TerminalDimensions } from "../../../electron/ssh/types"
import type { ReactNode } from "react"
import type { TerminalCommandSurface } from "../commands/command-registry"
import { visibleSessionIds } from "./layout"
import { isSshSession, type SshWorkspaceSession, type TerminalWorkspaceState } from "./session-state"
import type { TerminalSearchController } from "./terminal-search"
import { TerminalView } from "./TerminalView"
import type { TerminalController, TerminalPreferences } from "./terminal-controller"

interface TerminalWorkspaceProps {
  workspace: TerminalWorkspaceState
  workspaceVisible?: boolean
  overlay?: ReactNode
  preferences: TerminalPreferences
  confirmMultilinePaste: boolean
  multilinePasteConfirmation?: string
  onInput(sessionId: string, channelGeneration: number, data: string): void
  onResize(sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void
  onAck(sessionId: string, channelGeneration: number, sequence: number): void
  onController(sessionId: string, controller: TerminalController | undefined): void
  onSearchController?(sessionId: string, controller: TerminalSearchController | undefined): void
  onCommandSurface?(sessionId: string, surface: TerminalCommandSurface | undefined): void
  onContextMenu?(sessionId: string, event: MouseEvent): void
  themeForHost?(hostId: string): string
}

export function TerminalWorkspace(props: TerminalWorkspaceProps) {
  const sshSessions = props.workspace.sessions.filter(isSshSession)
  const visibleSessionOrder = [...new Set(props.workspace.layout
    ? visibleSessionIds(props.workspace.layout)
    : props.workspace.activeSessionId && sshSessions.some((session) => session.id === props.workspace.activeSessionId)
      ? [props.workspace.activeSessionId]
      : sshSessions.slice(0, 1).map((session) => session.id))]
  const visibleIds = new Set(visibleSessionOrder)
  const visibleCount = visibleSessionOrder.filter((id) => sshSessions.some((session) => session.id === id)).length
  const orderedSessions = [
    ...visibleSessionOrder
      .map((sessionId) => sshSessions.find((session) => session.id === sessionId))
      .filter((session): session is SshWorkspaceSession => session !== undefined),
    ...sshSessions.filter((session) => !visibleIds.has(session.id))
  ]

  return (
    <section className="terminal-workspace">
      <div
        className="terminal-stack"
        data-split={visibleCount > 1}
        style={visibleCount > 1 ? { gridTemplateRows: `repeat(${visibleCount}, minmax(0, 1fr))` } : undefined}
      >
        {orderedSessions.map((session) => (
          <TerminalView
            key={session.id}
            session={session}
            visible={props.workspaceVisible !== false && visibleIds.has(session.id)}
            themeId={props.themeForHost?.(session.hostId)}
            preferences={props.preferences}
            confirmMultilinePaste={props.confirmMultilinePaste}
            multilinePasteConfirmation={props.multilinePasteConfirmation}
            onInput={(data) => props.onInput(session.id, session.channelGeneration, data)}
            onResize={(dimensions) => props.onResize(session.id, session.channelGeneration, dimensions)}
            onAck={(channelGeneration, sequence) => props.onAck(session.id, channelGeneration, sequence)}
            onController={props.onController}
            onSearchController={props.onSearchController}
            onCommandSurface={props.onCommandSurface}
            onContextMenu={(event) => props.onContextMenu?.(session.id, event)}
          />
        ))}
      </div>
      {props.overlay}
    </section>
  )
}
