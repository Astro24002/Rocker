import { ChevronRight, Columns2, Copy, ExternalLink, FileCode2, FolderClosed, Network, Pencil, RotateCw, Server, Settings, ShieldCheck, X } from "lucide-react"
import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from "react"
import { useI18n } from "../i18n"
import { isCommandEnabled, type CommandContext, type CommandId } from "../features/commands/command-registry"
import { NavItem } from "./NavItem"
import { isCompactSidebar, normalizeSidebarWidth } from "../shared/sidebar-width"
import rockerMark from "../../build/icon.svg"
import { sessionKind, type SessionKind, type WorkspaceSession } from "../features/terminal/session-state"

export type NavKey = "hosts" | "sftp" | "snippets" | "ports" | "connections" | "settings"
export type WorkspaceNavKey = NavKey | "terminal" | "history" | "trust"
export type SessionCommandId = Extract<CommandId, `session.${string}`>
export type ContextMenuOwner = "sidebar" | "terminal"

interface SidebarProps {
  width: number
  activeNav: WorkspaceNavKey
  sessions?: WorkspaceSession[]
  activeSessionId?: string
  commandPaletteOpen?: boolean
  contextMenuOwner?: ContextMenuOwner
  onNavigate(nav: WorkspaceNavKey): void
  onSessionActivate?(id: string): void
  onSessionCommand?(commandId: SessionCommandId, session: WorkspaceSession): void
  onContextMenuOwnerChange?(owner: ContextMenuOwner | undefined): void
  onRestoreFocus?(sessionId: string): void
  commandContext?: CommandContext
}

const navItems: Array<{ key: NavKey; icon: typeof Server }> = [
  { key: "hosts", icon: Server },
  { key: "sftp", icon: FolderClosed },
  { key: "snippets", icon: FileCode2 },
  { key: "ports", icon: Network },
  { key: "connections", icon: ShieldCheck }
]

export const clampSidebarWidth = normalizeSidebarWidth

export function Sidebar({ width, activeNav, sessions = [], activeSessionId, commandPaletteOpen = false, contextMenuOwner, onNavigate, onSessionActivate, onSessionCommand, onContextMenuOwnerChange, onRestoreFocus, commandContext }: SidebarProps) {
  const { t } = useI18n()
  const [menuSessionId, setMenuSessionId] = useState<string>()
  const [duplicateMenuSessionId, setDuplicateMenuSessionId] = useState<string>()
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const duplicateTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingRestoreSessionId = useRef<string | undefined>(undefined)
  const previousActiveNav = useRef<WorkspaceNavKey>(activeNav)

  const closeSessionMenu = useCallback((restoreFocus = true): void => {
    if (!menuSessionId) return
    if (restoreFocus) pendingRestoreSessionId.current = menuSessionId
    else pendingRestoreSessionId.current = undefined
    setMenuSessionId(undefined)
    setDuplicateMenuSessionId(undefined)
    if (contextMenuOwner !== "terminal") onContextMenuOwnerChange?.(undefined)
  }, [contextMenuOwner, menuSessionId, onContextMenuOwnerChange])

  useEffect(() => {
    if (!menuSessionId) return
    if (contextMenuOwner === "terminal") {
      pendingRestoreSessionId.current = undefined
      setMenuSessionId(undefined)
      setDuplicateMenuSessionId(undefined)
      return
    }
    menuRef.current?.focus()
    const close = (): void => closeSessionMenu()
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [closeSessionMenu, contextMenuOwner, menuSessionId])

  useEffect(() => {
    if (!commandPaletteOpen) return
    pendingRestoreSessionId.current = undefined
    setMenuSessionId(undefined)
    setDuplicateMenuSessionId(undefined)
    if (contextMenuOwner === "sidebar") onContextMenuOwnerChange?.(undefined)
  }, [commandPaletteOpen, contextMenuOwner, onContextMenuOwnerChange])

  useEffect(() => {
    const navigationChanged = previousActiveNav.current !== activeNav
    previousActiveNav.current = activeNav
    if (!navigationChanged || !menuSessionId) return
    closeSessionMenu()
  }, [activeNav, closeSessionMenu, menuSessionId])

  useEffect(() => {
    const sessionId = pendingRestoreSessionId.current
    if (menuSessionId || !sessionId) return
    pendingRestoreSessionId.current = undefined
    if (menuTriggerRef.current?.isConnected) {
      menuTriggerRef.current.focus()
      return
    }
    onRestoreFocus?.(sessionId)
  }, [menuSessionId, onRestoreFocus])

  const openDuplicateMenu = useCallback((sessionId: string, session: WorkspaceSession, commandContext: CommandContext | undefined): void => {
    if (!isSessionCommandEnabled("session.duplicate", session, commandContext)) return
    setDuplicateMenuSessionId(sessionId)
  }, [])

  const openSessionMenu = useCallback((sessionId: string, trigger: HTMLButtonElement): void => {
    if (commandPaletteOpen) return
    pendingRestoreSessionId.current = undefined
    menuTriggerRef.current = trigger
    onContextMenuOwnerChange?.("sidebar")
    setMenuSessionId(sessionId)
  }, [commandPaletteOpen, onContextMenuOwnerChange])

  return (
    <aside className="sidebar" data-compact={isCompactSidebar(width)} style={{ width: normalizeSidebarWidth(width) }}>
      <button aria-label="Rocker" className="sidebar-brand" type="button" onClick={() => onNavigate("hosts")}>
        <img alt="" aria-hidden="true" src={rockerMark} />
        <span>Rocker</span>
      </button>

      <nav className="primary-nav" aria-label={t("sidebar.primaryNavigation")}>
        {navItems.map(({ key, icon }) => (
          <NavItem
            key={key}
            icon={icon}
            label={t(`nav.${key === "ports" ? "portForwarding" : key}`)}
            active={activeNav === key}
            onClick={() => onNavigate(key)}
          />
        ))}
        <NavItem
          icon={Settings}
          label={t("nav.settings")}
          active={activeNav === "settings"}
          onClick={() => onNavigate("settings")}
        />
      </nav>

      <section className="session-section" aria-label={t("sidebar.workspaceSessions")}>
        {sessions.length === 0 ? null : (
          <div className="sidebar-session-list">
            {sessions.map((session) => (
              <div key={session.id} className="sidebar-session-row">
                <button aria-expanded={menuSessionId === session.id} aria-haspopup="menu" aria-label={`${kindBadge(sessionKind(session))} ${session.label}`} data-active={session.id === activeSessionId} data-session-id={session.id} data-session-kind={sessionKind(session)} ref={(element) => { if (element && menuSessionId === session.id) menuTriggerRef.current = element }} type="button" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openSessionMenu(session.id, event.currentTarget) }} onKeyDown={(event) => {
                  const opensMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)
                  if (!opensMenu) return
                  event.preventDefault()
                  event.stopPropagation()
                  openSessionMenu(session.id, event.currentTarget)
                }} onClick={() => {
                  onSessionActivate?.(session.id)
                  onNavigate("terminal")
                }}>
                  <span className="session-type-badge" data-kind={sessionKind(session)}>{kindBadge(sessionKind(session))}</span>
                  <span className="session-name">{session.label}</span>
                </button>
                {menuSessionId === session.id && <div aria-label={t("sidebar.sessionActions").replace("{label}", session.label)} className="session-menu" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== "Escape") return; event.preventDefault(); closeSessionMenu() }} ref={menuRef} role="menu" tabIndex={-1}>
                  <SessionMenuItem commandId="session.reconnect" disabled={!isSessionCommandEnabled("session.reconnect", session, commandContext)} onClick={() => dispatchSessionCommand("session.reconnect", session, commandContext, onSessionCommand, closeSessionMenu)}><RotateCw aria-hidden="true" size={14} /><span>{t("commands.reconnect")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.rename" disabled={!isSessionCommandEnabled("session.rename", session, commandContext)} onClick={() => dispatchSessionCommand("session.rename", session, commandContext, onSessionCommand, closeSessionMenu)}><Pencil aria-hidden="true" size={14} /><span>{t("sidebar.rename")}</span></SessionMenuItem>
                  <div className="session-menu-submenu-item" onPointerEnter={() => openDuplicateMenu(session.id, session, commandContext)}>
                    <SessionMenuItem
                      aria-expanded={duplicateMenuSessionId === session.id}
                      aria-haspopup="menu"
                      commandId="session.duplicate"
                      disabled={!isSessionCommandEnabled("session.duplicate", session, commandContext)}
                      ref={duplicateMenuSessionId === session.id ? duplicateTriggerRef : undefined}
                      onClick={(event) => {
                        event.stopPropagation()
                        openDuplicateMenu(session.id, session, commandContext)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowRight" && event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        openDuplicateMenu(session.id, session, commandContext)
                      }}
                    >
                      <Copy aria-hidden="true" size={14} /><span>{t("sidebar.duplicate")}</span><ChevronRight aria-hidden="true" className="session-menu-chevron" size={14} />
                    </SessionMenuItem>
                    {duplicateMenuSessionId === session.id && <div aria-label={t("sidebar.duplicateActions")} className="session-submenu" onKeyDown={(event) => {
                      if (event.key !== "Escape") return
                      event.preventDefault()
                      event.stopPropagation()
                      setDuplicateMenuSessionId(undefined)
                      duplicateTriggerRef.current?.focus()
                    }} role="menu">
                      <SessionMenuItem commandId="session.duplicate" disabled={!isSessionCommandEnabled("session.duplicate", session, commandContext)} onClick={(event) => {
                        event.stopPropagation()
                        dispatchSessionCommand("session.duplicate", session, commandContext, onSessionCommand, closeSessionMenu)
                      }}><Copy aria-hidden="true" size={14} /><span>{t("sidebar.duplicateInWindow")}</span></SessionMenuItem>
                      <SessionMenuItem commandId="session.duplicate-window" disabled={!isSessionCommandEnabled("session.duplicate-window", session, commandContext)} onClick={(event) => {
                        event.stopPropagation()
                        dispatchSessionCommand("session.duplicate-window", session, commandContext, onSessionCommand, closeSessionMenu)
                      }}><ExternalLink aria-hidden="true" size={14} /><span>{t("sidebar.duplicateInNewWindow")}</span></SessionMenuItem>
                    </div>}
                  </div>
                  <SessionMenuItem commandId="session.split-horizontal" disabled={!isSessionCommandEnabled("session.split-horizontal", session, commandContext)} onClick={() => dispatchSessionCommand("session.split-horizontal", session, commandContext, onSessionCommand, closeSessionMenu)}><Columns2 aria-hidden="true" size={14} /><span>{t("sidebar.splitHorizontal")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.port-forwarding" disabled={!isSessionCommandEnabled("session.port-forwarding", session, commandContext)} onClick={() => dispatchSessionCommand("session.port-forwarding", session, commandContext, onSessionCommand, closeSessionMenu)}><Network aria-hidden="true" size={14} /><span>{t("commands.portForwarding")}</span></SessionMenuItem>
                  <SessionMenuItem className="session-menu-danger" commandId="session.close" disabled={!isSessionCommandEnabled("session.close", session, commandContext)} onClick={() => dispatchSessionCommand("session.close", session, commandContext, onSessionCommand, closeSessionMenu)}><X aria-hidden="true" size={14} /><span>{t("sidebar.close")}</span></SessionMenuItem>
                </div>}
              </div>
            ))}
          </div>
        )}
      </section>

    </aside>
  )
}

interface SessionMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  commandId: SessionCommandId
}

const SessionMenuItem = forwardRef<HTMLButtonElement, SessionMenuItemProps>(function SessionMenuItem({ commandId, children, ...props }, ref): ReactElement {
  return <button {...props} ref={ref} aria-disabled={props.disabled ? "true" : undefined} data-command-id={commandId} role="menuitem" type="button">{children}</button>
})

function dispatchSessionCommand(commandId: SessionCommandId, session: WorkspaceSession, commandContext: CommandContext | undefined, onSessionCommand: SidebarProps["onSessionCommand"], closeSessionMenu: () => void): void {
  if (!isSessionCommandEnabled(commandId, session, commandContext)) return
  onSessionCommand?.(commandId, session)
  closeSessionMenu()
}

function kindBadge(kind: SessionKind): string {
  if (kind === "sftp") return "SFTP"
  if (kind === "pf") return "PF"
  return "SSH"
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
        close: () => undefined,
        portForwarding: () => undefined
      },
      navigation: { navigate: () => undefined }
    }
  }
}
