import { Bell, ChevronDown, Clock3, FileCode2, FolderClosed, Network, Search, Server, Settings } from "lucide-react"
import { useI18n } from "../i18n"
import { IconButton } from "./IconButton"
import { NavItem } from "./NavItem"

export type NavKey = "hosts" | "sftp" | "ports" | "snippets" | "history"

interface SidebarProps {
  width: number
  activeNav: NavKey | "settings"
  onWidthChange(width: number): void
  onNavigate(nav: NavKey | "settings"): void
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

export function Sidebar({ width, activeNav, onWidthChange, onNavigate }: SidebarProps) {
  const { t } = useI18n()

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
      <div className="sidebar-tools">
        <IconButton label={t("nav.settings")} data-active={activeNav === "settings"} onClick={() => onNavigate("settings")}>
          <Settings size={15} strokeWidth={1.8} />
        </IconButton>
        <div className="sidebar-tools-spacer" />
        <IconButton label={t("common.notifications")}><Bell size={15} strokeWidth={1.8} /></IconButton>
      </div>

      <button className="workspace-switcher" type="button">
        <span className="workspace-avatar">R</span>
        <span>{t("workspace.personal")}</span>
        <ChevronDown aria-hidden="true" size={15} />
      </button>

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
        <p className="sidebar-empty">{t("sidebar.noSessions")}</p>
      </section>

      <section className="host-monitor host-monitor-offline">
        <div className="monitor-status-dot" />
        <div>
          <strong>{t("monitor.title")}</strong>
          <span>{t("monitor.offline")}</span>
        </div>
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
