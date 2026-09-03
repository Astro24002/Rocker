import { Clock3, Columns2, Copy, ExternalLink, FileCode2, FolderClosed, Network, Pencil, RotateCw, Search, Server, Settings, SquareTerminal, X } from "lucide-react"
import { useEffect, useState, type ButtonHTMLAttributes, type ReactElement } from "react"
import { useI18n } from "../i18n"
import { isCommandEnabled, type CommandContext, type CommandId } from "../features/commands/command-registry"
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
  commandContext?: CommandContext
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

export function Sidebar({ width, activeNav, sessions = [], activeSessionId, onWidthChange, onNavigate, onSessionActivate, onSessionCommand, commandContext }: SidebarProps) {
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
                  <SessionMenuItem commandId="session.reconnect" disabled={!isSessionCommandEnabled("session.reconnect", session, commandContext)} onClick={() => dispatchSessionCommand("session.reconnect", session, commandContext, onSessionCommand, setMenuSessionId)}><RotateCw aria-hidden="true" size={14} /><span>{t("commands.reconnect")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.rename" disabled={!isSessionCommandEnabled("session.rename", session, commandContext)} onClick={() => dispatchSessionCommand("session.rename", session, commandContext, onSessionCommand, setMenuSessionId)}><Pencil aria-hidden="true" size={14} /><span>{t("sidebar.rename")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.duplicate" disabled={!isSessionCommandEnabled("session.duplicate", session, commandContext)} onClick={() => dispatchSessionCommand("session.duplicate", session, commandContext, onSessionCommand, setMenuSessionId)}><Copy aria-hidden="true" size={14} /><span>{t("sidebar.duplicate")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.duplicate-window" disabled={!isSessionCommandEnabled("session.duplicate-window", session, commandContext)} onClick={() => dispatchSessionCommand("session.duplicate-window", session, commandContext, onSessionCommand, setMenuSessionId)}><ExternalLink aria-hidden="true" size={14} /><span>{t("sidebar.duplicateWindow")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.split-horizontal" disabled={!isSessionCommandEnabled("session.split-horizontal", session, commandContext)} onClick={() => dispatchSessionCommand("session.split-horizontal", session, commandContext, onSessionCommand, setMenuSessionId)}><Columns2 aria-hidden="true" size={14} /><span>{t("sidebar.splitHorizontal")}</span></SessionMenuItem>
                  <SessionMenuItem className="session-menu-danger" commandId="session.close" disabled={!isSessionCommandEnabled("session.close", session, commandContext)} onClick={() => dispatchSessionCommand("session.close", session, commandContext, onSessionCommand, setMenuSessionId)}><X aria-hidden="true" size={14} /><span>{t("sidebar.close")}</span></SessionMenuItem>
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

interface SessionMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  commandId: SessionCommandId
}

function SessionMenuItem({ commandId, children, ...props }: SessionMenuItemProps): ReactElement {
  return <button {...props} aria-disabled={props.disabled ? "true" : undefined} data-command-id={commandId} role="menuitem" type="button">{children}</button>
}

function dispatchSessionCommand(commandId: SessionCommandId, session: WorkspaceSession, commandContext: CommandContext | undefined, onSessionCommand: SidebarProps["onSessionCommand"], setMenuSessionId: (sessionId: string | undefined) => void): void {
  if (!isSessionCommandEnabled(commandId, session, commandContext)) return
  onSessionCommand?.(commandId, session)
  setMenuSessionId(undefined)
}

function isSessionCommandEnabled(commandId: SessionCommandId, session: WorkspaceSession, commandContext: CommandContext | undefined): boolean {
  return isCommandEnabled(commandId, createSessionCommandContext(commandContext, session))
}

function createSessionCommandContext(commandContext: CommandContext | undefined, session: WorkspaceSession): CommandContext {
  if (commandContext) return { ...commandContext, activeSession: session, connectionState: session.state }
  return {
    activeSession: session,
    connectionState: session.state,
    terminalBufferAvailable: false,
    activeNavigation: "terminal",
    settingsAvailable: true,
    recentSessions: [],
    actions: {
      terminal: {
        search: () => undefined,
        copy: () => undefined,
        paste: () => undefined,
        selectAll: () => undefined,
        clear: () => undefined,
        focus: () => undefined,
        increaseFont: () => undefined,
        decreaseFont: () => undefined,
        resetFont: () => undefined
      },
      session: {
        activate: () => undefined,
        reconnect: () => undefined,
        rename: () => undefined,
        duplicate: () => undefined,
        duplicateWindow: () => undefined,
        splitHorizontal: () => undefined,
        close: () => undefined
      },
      navigation: { navigate: () => undefined }
    }
  }
}
