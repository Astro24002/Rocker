import { Copy, Import, Pencil, Plus, Search, Server, Star, StarOff, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import ubuntuMark from "../../assets/platforms/ubuntu.svg"
import debianMark from "../../assets/platforms/debian.svg"
import type { HostEnvironment, HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import { filterHosts, getHostPlatform, isCompleteSshCommand } from "./host-state"

interface HostListProps {
  hosts: HostProfile[]
  disabled?: boolean
  onConnect(host: HostProfile): void
  onConnectCommand?(command: string): void
  onAdd(): void
  onEdit(host: HostProfile): void
  onImport(): void
  onDuplicate(host: HostProfile): Promise<HostProfile>
  onToggleFavorite(host: HostProfile): Promise<HostProfile>
  onRemove(host: HostProfile): Promise<void>
  recentHostIds?: ReadonlySet<string>
}

interface HostContextMenuState {
  hostId: string
  x: number
  y: number
}

const hostContextMenuWidth = 224
const hostContextMenuHeight = 156

export function HostList({
  hosts,
  disabled = false,
  onConnect,
  onConnectCommand,
  onAdd,
  onEdit,
  onImport,
  onDuplicate,
  onToggleFavorite,
  onRemove,
  recentHostIds,
}: HostListProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState("all")
  const [environment, setEnvironment] = useState<HostEnvironment | "all">("all")
  const [tag, setTag] = useState("all")
  const [recentOnly, setRecentOnly] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState<string>()
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [hostContextMenu, setHostContextMenu] = useState<HostContextMenuState>()
  const hostContextMenuRef = useRef<HTMLDivElement>(null)
  const hostContextMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const groups = useMemo(() => [...new Set(hosts.map((host) => host.group).filter(Boolean))] as string[], [hosts])
  const environments = useMemo(() => environmentOrder.filter((candidate) => hosts.some((host) => host.environment === candidate)), [hosts])
  const tags = useMemo(() => {
    const unique = new Map<string, string>()
    for (const candidate of hosts.flatMap((host) => host.tags ?? [])) {
      const tag = candidate.trim()
      if (tag && !unique.has(tag.toLowerCase())) unique.set(tag.toLowerCase(), tag)
    }
    return [...unique.values()].sort((left, right) => left.localeCompare(right))
  }, [hosts])
  const environmentLabels: Record<HostEnvironment, string> = {
    production: t("hosts.environment.production"),
    staging: t("hosts.environment.staging"),
    development: t("hosts.environment.development"),
    personal: t("hosts.environment.personal")
  }
  const commandReady = isCompleteSshCommand(query)
  const contextHost = hostContextMenu ? hosts.find((host) => host.id === hostContextMenu.hostId) : undefined
  const filtered = useMemo(() => {
    const filter = { group, query: /^ssh(?:\s|$)/i.test(query.trim()) ? "" : query, recentOnly, recentHostIds, environment, tag }
    return filterHosts(hosts, filter)
  }, [environment, group, hosts, query, recentHostIds, recentOnly, tag])

  const selectHost = (host: HostProfile): void => {
    if (!disabled) {
      setSelectedHostId(host.id)
    }
  }

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
    const confirmationKey = host.environment === "production" ? "hosts.action.deleteProductionConfirm" : "hosts.action.deleteConfirm"
    if (!window.confirm(t(confirmationKey).replace("{name}", host.name))) {
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

        <div className="host-filter-row" aria-label={t("hosts.hostGroups")}>
          <button aria-pressed={group === "all"} type="button" data-active={group === "all"} onClick={() => setGroup("all")}>{t("hosts.allHosts")} <span>{hosts.length}</span></button>
          <button aria-pressed={recentOnly} type="button" data-active={recentOnly} onClick={() => setRecentOnly((active) => !active)}>{t("hosts.recent")}</button>
          {groups.map((name) => (
            <button key={name} aria-pressed={group === name} type="button" data-active={group === name} onClick={() => setGroup(name)}>{name}<span>{hosts.filter((host) => host.group === name).length}</span></button>
          ))}
          <label className="host-filter-select">
            <span>{t("hosts.environmentFilter")}</span>
            <select aria-label={t("hosts.environmentFilter")} value={environment} onChange={(event) => setEnvironment(event.target.value as HostEnvironment | "all")}>
              <option value="all">{t("hosts.allEnvironments")}</option>
              {environments.map((candidate) => <option key={candidate} value={candidate}>{environmentLabels[candidate]}</option>)}
            </select>
          </label>
          <label className="host-filter-select">
            <span>{t("hosts.tagFilter")}</span>
            <select aria-label={t("hosts.tagFilter")} value={tag} onChange={(event) => setTag(event.target.value)}>
              <option value="all">{t("hosts.allTags")}</option>
              {tags.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
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
                  onClick={() => selectHost(host)}
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
                    if (event.key === " ") {
                      event.preventDefault()
                      selectHost(host)
                    } else if (event.key === "Enter") {
                      event.preventDefault()
                      onConnect(host)
                    }
                  }}
                  onDoubleClick={() => { if (!disabled) onConnect(host) }}
                >
                  <HostPlatformMark host={host} />
                  <span className="host-card-copy"><strong>{host.name}</strong><small><b>SSH</b> · {host.username}</small></span>
                </button>
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

const environmentOrder: HostEnvironment[] = ["production", "staging", "development", "personal"]

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
