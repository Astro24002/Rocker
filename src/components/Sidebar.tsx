import { Clock3, Columns2, Copy, ExternalLink, FileCode2, FolderClosed, Network, Pencil, RotateCw, Search, Server, Settings, SquareTerminal, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useI18n } from "../i18n"
import type { CommandId } from "../features/commands/command-registry"
import { IconButton } from "./IconButton"
import { NavItem } from "./NavItem"
import type { WorkspaceSession } from "../features/terminal/session-state"

export type NavKey = "hosts" | "sftp" | "ports" | "snippets" | "history" | "settings"
export type WorkspaceNavKey = NavKey | "terminal" | "local-terminal"
export type SessionCommandId = Extract<CommandId, `session.${string}`>

interface SidebarProps {
  width: number
  activeNav: WorkspaceNavKey
  sessions?: WorkspaceSession[]
  activeSessionId?: string
  onWidthChange(width: number): void
  onNavigate(nav: WorkspaceNavKey): void
  onSessionActivate?(id: string): void
  onSessionCommand?(commandId: SessionCommandId, session: WorkspaceSession): void
}

const navItems: Array<{ key: NavKey; icon: typeof Server }> = [
  { key: "hosts", icon: Server },
  { key: "sftp", icon: FolderClosed },
  { key: "ports", icon: Network },
  { key: "snippets", icon: FileCode2 },
  { key: "history", icon: Clock3 }
]

export function clampSidebarWidth(width: number): number {
  return Math.max(180, Math.min(360, Math.round(width)))
}

export function Sidebar({ width, activeNav, sessions = [], activeSessionId, onWidthChange, onNavigate, onSessionActivate, onSessionCommand }: SidebarProps) {
  const { t } = useI18n()
  const [menuSessionId, setMenuSessionId] = useState<string>()

  useEffect(() => {
    if (!menuSessionId) return
    const close = (): void => setMenuSessionId(undefined)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [menuSessionId])

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent): void => onWidthChange(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    const stop = (): void => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft") onWidthChange(clampSidebarWidth(width - 12))
    if (event.key === "ArrowRight") onWidthChange(clampSidebarWidth(width + 12))
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-quick-actions">
        <button className="local-terminal-action" data-active={activeNav === "local-terminal"} type="button" onClick={() => onNavigate("local-terminal")}>
          <SquareTerminal aria-hidden="true" size={16} />
          <span>{t("sidebar.localTerminal")}</span>
        </button>
        <IconButton label={t("nav.settings")} className="sidebar-settings-action" data-active={activeNav === "settings"} onClick={() => onNavigate("settings")}>
          <Settings size={16} />
        </IconButton>
      </div>

      <nav className="primary-nav" aria-label="Primary">
        {navItems.map(({ key, icon }) => (
          <NavItem
            key={key}
            icon={icon}
            label={t(`nav.${key === "ports" ? "portForwarding" : key}`)}
            active={activeNav === key}
            onClick={() => onNavigate(key)}
          />
        ))}
      </nav>

      <section className="session-section">
        <div className="sidebar-section-heading">
          <span>{t("sidebar.sessions")}</span>
          <Search aria-hidden="true" size={14} />
        </div>
        {sessions.length === 0 ? <p className="sidebar-empty">{t("sidebar.noSessions")}</p> : (
          <div className="sidebar-session-list">
            {sessions.map((session) => (
              <div key={session.id} className="sidebar-session-row">
                <button data-active={session.id === activeSessionId} type="button" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenuSessionId(session.id) }} onClick={() => {
                  onSessionActivate?.(session.id)
                  onNavigate("terminal")
                }}>
                  <span className="session-state-dot" data-state={session.state} />
                  <span>{session.label}</span>
                </button>
                {menuSessionId === session.id && <div className="session-menu" role="menu" aria-label={`Session actions for ${session.label}`} onClick={(event) => event.stopPropagation()}>
                  <button disabled={!canReconnect(session)} data-command-id="session.reconnect" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.reconnect", session, onSessionCommand, setMenuSessionId)}><RotateCw aria-hidden="true" size={14} /><span>{t("commands.reconnect")}</span></button>
                  <button data-command-id="session.rename" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.rename", session, onSessionCommand, setMenuSessionId)}><Pencil aria-hidden="true" size={14} /><span>{t("sidebar.rename")}</span></button>
                  <button data-command-id="session.duplicate" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.duplicate", session, onSessionCommand, setMenuSessionId)}><Copy aria-hidden="true" size={14} /><span>{t("sidebar.duplicate")}</span></button>
                  <button data-command-id="session.duplicate-window" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.duplicate-window", session, onSessionCommand, setMenuSessionId)}><ExternalLink aria-hidden="true" size={14} /><span>{t("sidebar.duplicateWindow")}</span></button>
                  <button data-command-id="session.split-horizontal" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.split-horizontal", session, onSessionCommand, setMenuSessionId)}><Columns2 aria-hidden="true" size={14} /><span>{t("sidebar.splitHorizontal")}</span></button>
                  <button className="session-menu-danger" data-command-id="session.close" role="menuitem" type="button" onClick={() => dispatchSessionCommand("session.close", session, onSessionCommand, setMenuSessionId)}><X aria-hidden="true" size={14} /><span>{t("sidebar.close")}</span></button>
                </div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      />
    </aside>
  )
}

function canReconnect(session: WorkspaceSession): boolean {
  return session.state === "disconnected" || session.state === "error"
}

function dispatchSessionCommand(commandId: SessionCommandId, session: WorkspaceSession, onSessionCommand: SidebarProps["onSessionCommand"], setMenuSessionId: (sessionId: string | undefined) => void): void {
  onSessionCommand?.(commandId, session)
  setMenuSessionId(undefined)
}
