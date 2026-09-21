import { Copy, FolderClosed, Import, Network, Pencil, Plus, Search, Server, Star, StarOff, TerminalSquare, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import ubuntuMark from "../../assets/platforms/ubuntu.svg"
import debianMark from "../../assets/platforms/debian.svg"
import type { ConnectionHistoryItem, HostProfile, HostSort } from "../../app/types"
import { useI18n } from "../../i18n"
import { filterHosts, getHostPlatform, isCompleteSshCommand, sortHosts } from "./host-state"

interface HostListProps {
  hosts: HostProfile[]
  disabled?: boolean
  onConnect(host: HostProfile): void
  onOpenSftp?(host: HostProfile): void
  onOpenForwarding?(host: HostProfile): void
  onConnectCommand?(command: string): void
  onAdd(): void
  onEdit(host: HostProfile): void
  onImport(): void
  onDuplicate(host: HostProfile): Promise<HostProfile>
  onToggleFavorite(host: HostProfile): Promise<HostProfile>
  onRemove(host: HostProfile): Promise<void>
  history?: readonly ConnectionHistoryItem[]
  /** Compatibility-only input from the retired Recent filter. */
  recentHostIds?: ReadonlySet<string>
  sort?: HostSort
  favoritesOnly?: boolean
  onPreferencesChange?(preferences: { sort?: HostSort; favoritesOnly?: boolean }): void
}

interface HostContextMenuState {
  hostId: string
  x: number
  y: number
}

const hostContextMenuWidth = 224
const hostContextMenuHeight = 328

export function HostList({
  hosts,
  disabled = false,
  onConnect,
  onOpenSftp,
  onOpenForwarding,
  onConnectCommand,
  onAdd,
  onEdit,
  onImport,
  onDuplicate,
  onToggleFavorite,
  onRemove,
  history = [],
  sort = "name-asc",
  favoritesOnly = false,
  onPreferencesChange = () => undefined,
}: HostListProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>()
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [hostContextMenu, setHostContextMenu] = useState<HostContextMenuState>()
  const hostContextMenuRef = useRef<HTMLDivElement>(null)
  const hostContextMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const commandReady = isCompleteSshCommand(query)
  const contextHost = hostContextMenu ? hosts.find((host) => host.id === hostContextMenu.hostId) : undefined
  const filtered = useMemo(() => sortHosts(
    filterHosts(hosts, { query: /^ssh(?:\s|$)/i.test(query.trim()) ? "" : query, favoritesOnly }),
    sort,
    history
  ), [favoritesOnly, history, hosts, query, sort])

  const connectCommand = (): void => {
    if (disabled || !commandReady) return
    onConnectCommand?.(query.trim())
  }

  const runHostAction = async (action: () => Promise<void>): Promise<void> => {
    if (disabled || actionBusy) return
    setActionBusy(true)
    setActionError(false)
    try {
      await action()
    } catch {
      setActionError(true)
    } finally {
      setActionBusy(false)
    }
  }

  const closeHostContextMenu = (restoreFocus = true): void => {
    setHostContextMenu(undefined)
    if (restoreFocus) hostContextMenuTriggerRef.current?.focus()
  }

  const openHostContextMenu = (host: HostProfile, trigger: HTMLButtonElement, point?: { x: number; y: number }): void => {
    if (disabled) return
    const bounds = trigger.getBoundingClientRect()
    const requestedX = point?.x ?? bounds.left + Math.min(bounds.width, 16)
    const requestedY = point?.y ?? bounds.bottom
    const maxX = Math.max(8, window.innerWidth - hostContextMenuWidth - 8)
    const maxY = Math.max(8, window.innerHeight - hostContextMenuHeight - 8)
    hostContextMenuTriggerRef.current = trigger
    setSelectedHostId(host.id)
    setHostContextMenu({
      hostId: host.id,
      x: Math.max(8, Math.min(requestedX, maxX)),
      y: Math.max(8, Math.min(requestedY, maxY))
    })
  }

  useEffect(() => {
    if (!hostContextMenu) return
    if (disabled || !contextHost) {
      setHostContextMenu(undefined)
      return
    }
    hostContextMenuRef.current?.focus()
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && hostContextMenuRef.current?.contains(event.target)) return
      closeHostContextMenu()
    }
    window.addEventListener("click", closeOnOutsideClick)
    return () => window.removeEventListener("click", closeOnOutsideClick)
  }, [contextHost, disabled, hostContextMenu])

  const openSshContextHost = (): void => {
    if (!contextHost || disabled) return
    const host = contextHost
    closeHostContextMenu(false)
    onConnect(host)
  }

  const openSftpContextHost = (): void => {
    if (!contextHost || disabled || !onOpenSftp) return
    const host = contextHost
    closeHostContextMenu(false)
    onOpenSftp(host)
  }

  const openForwardingContextHost = (): void => {
    if (!contextHost || disabled || !onOpenForwarding) return
    const host = contextHost
    closeHostContextMenu(false)
    onOpenForwarding(host)
  }

  const editContextHost = (): void => {
    if (!contextHost || disabled || actionBusy) return
    const host = contextHost
    closeHostContextMenu(false)
    onEdit(host)
  }

  const duplicateContextHost = (): void => {
    if (!contextHost) return
    const host = contextHost
    closeHostContextMenu(false)
    void runHostAction(async () => {
      const duplicate = await onDuplicate(host)
      setSelectedHostId(duplicate.id)
    })
  }

  const toggleContextHostFavorite = (): void => {
    if (!contextHost) return
    const host = contextHost
    closeHostContextMenu(false)
    void runHostAction(async () => { await onToggleFavorite(host) })
  }

  const removeContextHost = (): void => {
    if (!contextHost) return
    const host = contextHost
    if (!window.confirm(t("hosts.action.deleteConfirm").replace("{name}", host.name))) {
      closeHostContextMenu()
      return
    }
    closeHostContextMenu(false)
    void runHostAction(async () => {
      await onRemove(host)
      if (selectedHostId === host.id) setSelectedHostId(undefined)
    })
  }

  return (
    <section className="hosts-view">
      <header className="view-header host-list-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("workspace.personal")}</span>
          <h1>{t("hosts.title")}</h1>
          <p>{t("hosts.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onImport() }}><Import size={15} />{t("hosts.import")}</button>
          <button className="primary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onAdd() }}><Plus size={15} />{t("hosts.add")}</button>
        </div>
      </header>

      {actionError ? <p className="host-action-error" role="status" aria-live="polite">{t("hosts.action.failed")}</p> : null}

      <div className="host-content host-card-content">
        <div className="host-search-row">
          <Search aria-hidden="true" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && commandReady) connectCommand() }}
            placeholder={t("hosts.searchPlaceholder")}
            aria-label={t("hosts.searchPlaceholder")}
          />
          <button className="host-connect-command" type="button" aria-label={t("hosts.connect")} disabled={disabled || !commandReady} onClick={connectCommand}>{t("hosts.connect")} <kbd>↵</kbd></button>
        </div>

        <div className="host-filter-row" aria-label={t("hosts.filters")}>
          <button aria-pressed={!favoritesOnly} type="button" data-active={!favoritesOnly} onClick={() => onPreferencesChange({ favoritesOnly: false })}>{t("hosts.allHosts")} <span>{hosts.length}</span></button>
          <button aria-pressed={favoritesOnly} type="button" data-active={favoritesOnly} onClick={() => onPreferencesChange({ favoritesOnly: true })}>{t("hosts.favorites")}</button>
          <label className="host-filter-select">
            <span>{t("hosts.sort")}</span>
            <select aria-label={t("hosts.sort")} value={sort} onChange={(event) => onPreferencesChange({ sort: event.target.value as HostSort })}>
              <option value="name-asc">{t("hosts.sortNameAsc")}</option>
              <option value="name-desc">{t("hosts.sortNameDesc")}</option>
              <option value="recent">{t("hosts.sortRecent")}</option>
              <option value="favorites">{t("hosts.sortFavorites")}</option>
            </select>
          </label>
          <span className="host-result-count">{commandReady ? t("hosts.sshCommandReady") : t(filtered.length === 1 ? "hosts.hostCount" : "hosts.hostCounts").replace("{count}", String(filtered.length))}</span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-workspace compact-empty">
            <div className="empty-symbol"><Server size={24} strokeWidth={1.5} /></div>
            <h2>{t("hosts.emptyTitle")}</h2>
            <p>{t("hosts.emptyBody")}</p>
            <button className="primary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onAdd() }}><Plus size={15} />{t("hosts.add")}</button>
          </div>
        ) : (
          <div className="host-card-grid" role="list">
            {filtered.map((host) => (
              <div key={host.id} className="host-card-shell" role="listitem">
                <button
                  className="host-card"
                  type="button"
                  data-selected={selectedHostId === host.id}
                  aria-label={t("hosts.cardLabel").replace("{name}", host.name).replace("{username}", host.username)}
                  aria-pressed={selectedHostId === host.id}
                  aria-expanded={hostContextMenu?.hostId === host.id}
                  aria-haspopup="menu"
                  disabled={disabled}
                  onClick={() => setSelectedHostId(host.id)}
                  onDoubleClick={() => onConnect(host)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openHostContextMenu(host, event.currentTarget, { x: event.clientX, y: event.clientY })
                  }}
                  onKeyDown={(event) => {
                    if (disabled || event.repeat) return
                    const opensMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)
                    if (opensMenu) {
                      event.preventDefault()
                      event.stopPropagation()
                      openHostContextMenu(host, event.currentTarget)
                      return
                    }
                    if (event.key === "Enter") {
                      event.preventDefault()
                      onConnect(host)
                    }
                  }}
                >
                  <HostPlatformMark host={host} />
                  <span className="host-card-copy"><strong>{host.name}</strong><small><b>SSH</b>, {host.username}</small></span>
                </button>
                <div className="host-card-inline-actions">
                  <button aria-label={host.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} aria-pressed={host.favorite} className="icon-button" title={host.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} type="button" disabled={disabled || actionBusy} onClick={(event) => { event.stopPropagation(); void runHostAction(async () => { await onToggleFavorite(host) }) }}>
                    <Star aria-hidden="true" size={14} fill={host.favorite ? "currentColor" : "none"} />
                  </button>
                  <button aria-label={t("hosts.action.edit")} className="icon-button" title={t("hosts.action.edit")} type="button" disabled={disabled} onClick={(event) => { event.stopPropagation(); onEdit(host) }}><Pencil aria-hidden="true" size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {hostContextMenu && contextHost ? (
        <div
          ref={hostContextMenuRef}
          aria-label={t("hosts.action.namedActions").replace("{name}", contextHost.name)}
          className="terminal-context-menu host-context-menu"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            closeHostContextMenu()
          }}
          role="menu"
          style={{ left: hostContextMenu.x, top: hostContextMenu.y }}
          tabIndex={-1}
        >
          <button type="button" role="menuitem" disabled={disabled} onClick={openSshContextHost}><TerminalSquare aria-hidden="true" size={14} /><span>{t("hosts.action.openSsh")}</span></button>
          <button type="button" role="menuitem" disabled={disabled || !onOpenSftp} onClick={openSftpContextHost}><FolderClosed aria-hidden="true" size={14} /><span>{t("hosts.action.openSftp")}</span></button>
          <button type="button" role="menuitem" disabled={disabled || !onOpenForwarding} onClick={openForwardingContextHost}><Network aria-hidden="true" size={14} /><span>{t("hosts.action.openForwarding")}</span></button>
          <div className="session-menu-separator" />
          <button type="button" role="menuitem" disabled={disabled || actionBusy} onClick={editContextHost}><Pencil aria-hidden="true" size={14} /><span>{t("hosts.action.edit")}</span></button>
          <button type="button" role="menuitem" disabled={disabled || actionBusy} onClick={duplicateContextHost}><Copy aria-hidden="true" size={14} /><span>{t("hosts.action.duplicate")}</span></button>
          <button type="button" role="menuitem" disabled={disabled || actionBusy} onClick={toggleContextHostFavorite}>{contextHost.favorite ? <StarOff aria-hidden="true" size={14} /> : <Star aria-hidden="true" size={14} />}<span>{contextHost.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")}</span></button>
          <div className="session-menu-separator" />
          <button className="host-context-danger" type="button" role="menuitem" disabled={disabled || actionBusy} onClick={removeContextHost}><Trash2 aria-hidden="true" size={14} /><span>{t("hosts.action.delete")}</span></button>
        </div>
      ) : null}
    </section>
  )
}

function HostPlatformMark({ host }: { host: HostProfile }) {
  const { t } = useI18n()
  const platform = getHostPlatform(host)
  const image = platform === "ubuntu" ? ubuntuMark : platform === "debian" ? debianMark : undefined
  return (
    <span className={`host-platform-mark host-platform-${platform}`} aria-label={t("hosts.platform").replace("{platform}", platform)}>
      {image ? <img src={image} alt="" /> : platform === "rocker" ? "R" : "L"}
    </span>
  )
}
