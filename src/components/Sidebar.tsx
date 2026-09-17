import { Copy, ExternalLink, FileCode2, FolderClosed, Network, Pencil, Server, Settings, ShieldCheck, TerminalSquare, X, type LucideIcon } from "lucide-react"
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement } from "react"
import { createPortal } from "react-dom"
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
  themeForHost?(hostId: string): string
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

const sessionIcons: Record<SessionKind, LucideIcon> = { ssh: TerminalSquare, sftp: FolderClosed, pf: Network }

export const clampSidebarWidth = normalizeSidebarWidth

export function Sidebar({ width, activeNav, sessions = [], activeSessionId, themeForHost, commandPaletteOpen = false, contextMenuOwner, onNavigate, onSessionActivate, onSessionCommand, onContextMenuOwnerChange, onRestoreFocus, commandContext }: SidebarProps) {
  const { t } = useI18n()
  const [menuSessionId, setMenuSessionId] = useState<string>()
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number }>()
  const sidebarRef = useRef<HTMLElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingRestoreSessionId = useRef<string | undefined>(undefined)
  const previousActiveNav = useRef<WorkspaceNavKey>(activeNav)

  const positionSessionMenu = useCallback((): void => {
    const trigger = menuTriggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const anchor = trigger.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.right + 8, window.innerWidth - menu.offsetWidth - 8))
    const top = Math.max(8, Math.min(anchor.top + 4, window.innerHeight - menu.offsetHeight - 8))
    setMenuPosition((current) => current?.left === left && current.top === top ? current : { left, top })
  }, [])

  useLayoutEffect(() => {
    if (!menuSessionId) return
    positionSessionMenu()
    const list = sessionListRef.current
    list?.addEventListener("scroll", positionSessionMenu)
    window.addEventListener("resize", positionSessionMenu)
    return () => {
      list?.removeEventListener("scroll", positionSessionMenu)
      window.removeEventListener("resize", positionSessionMenu)
    }
  }, [menuSessionId, positionSessionMenu, width])

  const closeSessionMenu = useCallback((restoreFocus = true): void => {
    if (!menuSessionId) return
    if (restoreFocus) pendingRestoreSessionId.current = menuSessionId
    else pendingRestoreSessionId.current = undefined
    setMenuSessionId(undefined)
    if (contextMenuOwner !== "terminal") onContextMenuOwnerChange?.(undefined)
  }, [contextMenuOwner, menuSessionId, onContextMenuOwnerChange])

  useEffect(() => {
    if (!menuSessionId) return
    if (contextMenuOwner === "terminal") {
      pendingRestoreSessionId.current = undefined
      setMenuSessionId(undefined)
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

  const openSessionMenu = useCallback((sessionId: string, trigger: HTMLButtonElement): void => {
    if (commandPaletteOpen) return
    pendingRestoreSessionId.current = undefined
    menuTriggerRef.current = trigger
    if (menuSessionId !== sessionId) setMenuPosition(undefined)
    onContextMenuOwnerChange?.("sidebar")
    setMenuSessionId(sessionId)
  }, [commandPaletteOpen, menuSessionId, onContextMenuOwnerChange])

  return (
    <aside className="sidebar" data-compact={isCompactSidebar(width)} ref={sidebarRef} style={{ width: normalizeSidebarWidth(width) }}>
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
            active={activeNav === key || (key === "connections" && (activeNav === "history" || activeNav === "trust"))}
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
          <div className="sidebar-session-list" ref={sessionListRef}>
            {sessions.map((session) => (
              <div key={session.id} className="sidebar-session-row">
                <button aria-current={activeNav === "terminal" && session.id === activeSessionId ? "page" : undefined} aria-expanded={menuSessionId === session.id} aria-haspopup="menu" aria-label={`${kindBadge(sessionKind(session))} ${session.label}`} className="session-activate-button" data-active={session.id === activeSessionId} data-session-id={session.id} data-session-kind={sessionKind(session)} data-theme={activeNav === "terminal" && session.id === activeSessionId ? themeForHost?.(session.hostId) : undefined} ref={(element) => { if (element && menuSessionId === session.id) menuTriggerRef.current = element }} type="button" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openSessionMenu(session.id, event.currentTarget) }} onKeyDown={(event) => {
                  const opensMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)
                  if (!opensMenu) return
                  event.preventDefault()
                  event.stopPropagation()
                  openSessionMenu(session.id, event.currentTarget)
                }} onClick={() => {
                  onSessionActivate?.(session.id)
                  onNavigate("terminal")
                }}>
                  <SessionKindIcon kind={sessionKind(session)} />
                  <span className="session-name">{session.label}</span>
                </button>
                <button
                  aria-label={`${t("sidebar.close")} ${session.label}`}
                  className="session-close-button"
                  disabled={!isSessionCommandEnabled("session.close", session, commandContext)}
                  title={t("sidebar.close")}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    dispatchSessionCommand("session.close", session, commandContext, onSessionCommand, closeSessionMenu)
                  }}
                >
                  <X aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
                {menuSessionId === session.id && createPortal(<div aria-label={t("sidebar.sessionActions").replace("{label}", session.label)} className="session-menu" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key !== "Escape") return; event.preventDefault(); closeSessionMenu() }} ref={menuRef} role="menu" style={{ left: menuPosition?.left, top: menuPosition?.top, visibility: menuPosition ? "visible" : "hidden" }} tabIndex={-1}>
                  <SessionMenuItem commandId="session.duplicate" disabled={!isSessionCommandEnabled("session.duplicate", session, commandContext)} onClick={() => dispatchSessionCommand("session.duplicate", session, commandContext, onSessionCommand, closeSessionMenu)}><Copy aria-hidden="true" size={14} /><span>{t("sidebar.duplicate")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.duplicate-window" disabled={!isSessionCommandEnabled("session.duplicate-window", session, commandContext)} onClick={() => dispatchSessionCommand("session.duplicate-window", session, commandContext, onSessionCommand, closeSessionMenu)}><ExternalLink aria-hidden="true" size={14} /><span>{t("sidebar.duplicateWindow")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.rename" disabled={!isSessionCommandEnabled("session.rename", session, commandContext)} onClick={() => dispatchSessionCommand("session.rename", session, commandContext, onSessionCommand, closeSessionMenu)}><Pencil aria-hidden="true" size={14} /><span>{t("sidebar.rename")}</span></SessionMenuItem>
                  <SessionMenuItem commandId="session.port-forwarding" disabled={!isSessionCommandEnabled("session.port-forwarding", session, commandContext)} onClick={() => dispatchSessionCommand("session.port-forwarding", session, commandContext, onSessionCommand, closeSessionMenu)}><Network aria-hidden="true" size={14} /><span>{t("commands.portForwarding")}</span></SessionMenuItem>
                  <SessionMenuItem className="session-menu-danger" commandId="session.close" disabled={!isSessionCommandEnabled("session.close", session, commandContext)} onClick={() => dispatchSessionCommand("session.close", session, commandContext, onSessionCommand, closeSessionMenu)}><X aria-hidden="true" size={14} /><span>{t("sidebar.close")}</span></SessionMenuItem>
                </div>, sidebarRef.current?.parentElement ?? document.body)}
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

function SessionKindIcon({ kind }: { kind: SessionKind }): ReactElement {
  const Icon = sessionIcons[kind]
  return <span className="session-type-icon" title={kindBadge(kind)}><Icon aria-hidden="true" size={18} strokeWidth={1.8} /></span>
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
