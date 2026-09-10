import { Copy, Import, Pencil, Plus, Search, Server, Star, StarOff, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import ubuntuMark from "../../assets/platforms/ubuntu.svg"
import debianMark from "../../assets/platforms/debian.svg"
import type { HostProfile } from "../../app/types"
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
  const [recentOnly, setRecentOnly] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState<string>()
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState(false)
  const groups = useMemo(() => [...new Set(hosts.map((host) => host.group).filter(Boolean))] as string[], [hosts])
  const commandReady = isCompleteSshCommand(query)
  const selectedHost = selectedHostId ? hosts.find((host) => host.id === selectedHostId) : undefined
  const filtered = useMemo(() => {
    const filter = { group, query: /^ssh(?:\s|$)/i.test(query.trim()) ? "" : query, recentOnly, recentHostIds }
    return filterHosts(hosts, filter)
  }, [group, hosts, query, recentHostIds, recentOnly])

  const selectHost = (host: HostProfile): void => {
    if (!disabled) setSelectedHostId(host.id)
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

  const duplicateSelected = (): void => {
    if (!selectedHost) return
    void runHostAction(async () => {
      const duplicate = await onDuplicate(selectedHost)
      setSelectedHostId(duplicate.id)
    })
  }

  const toggleSelectedFavorite = (): void => {
    if (!selectedHost) return
    void runHostAction(async () => { await onToggleFavorite(selectedHost) })
  }

  const removeSelected = (): void => {
    if (!selectedHost || !window.confirm(t("hosts.action.deleteConfirm").replace("{name}", selectedHost.name))) return
    void runHostAction(async () => {
      await onRemove(selectedHost)
      setSelectedHostId(undefined)
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
          {selectedHost ? (
            <div className="host-selection-actions" aria-label={`${selectedHost.name} actions`}>
              <button className="host-context-action" type="button" aria-label={`Edit ${selectedHost.name}`} title={t("hosts.action.edit")} disabled={disabled || actionBusy} onClick={() => onEdit(selectedHost)}><Pencil size={14} /></button>
              <button className="host-context-action" type="button" aria-label={t("hosts.action.duplicate")} title={t("hosts.action.duplicate")} disabled={disabled || actionBusy} onClick={duplicateSelected}><Copy size={14} /></button>
              <button className="host-context-action" type="button" aria-label={selectedHost.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} title={selectedHost.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} disabled={disabled || actionBusy} onClick={toggleSelectedFavorite}>{selectedHost.favorite ? <StarOff size={14} /> : <Star size={14} />}</button>
              <button className="host-context-action host-context-danger" type="button" aria-label={t("hosts.action.delete")} title={t("hosts.action.delete")} disabled={disabled || actionBusy} onClick={removeSelected}><Trash2 size={14} /></button>
            </div>
          ) : null}
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
            placeholder="Find a host or ssh user@hostname"
            aria-label="Find a host or ssh user@hostname"
          />
          <button className="host-connect-command" type="button" disabled={disabled || !commandReady} onClick={connectCommand}>Connect <kbd>↵</kbd></button>
        </div>

        <div className="host-filter-row" aria-label="Host groups">
          <button type="button" data-active={group === "all"} onClick={() => setGroup("all")}>All hosts <span>{hosts.length}</span></button>
          <button type="button" data-active={recentOnly} onClick={() => setRecentOnly((active) => !active)}>{t("hosts.recent")}</button>
          {groups.map((name) => (
            <button key={name} type="button" data-active={group === name} onClick={() => setGroup(name)}>{name}<span>{hosts.filter((host) => host.group === name).length}</span></button>
          ))}
          <span className="host-result-count">{commandReady ? "SSH command ready" : `${filtered.length} ${filtered.length === 1 ? "host" : "hosts"}`}</span>
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
                  aria-label={`${host.name}, SSH, ${host.username}`}
                  aria-pressed={selectedHostId === host.id}
                  disabled={disabled}
                  onClick={() => selectHost(host)}
                  onDoubleClick={() => { if (!disabled) onConnect(host) }}
                >
                  <HostPlatformMark host={host} />
                  <span className="host-card-copy"><strong>{host.name}</strong><small><b>SSH</b> · {host.username}</small></span>
                </button>
                <button className="host-card-edit" type="button" aria-label={`Edit ${host.name}`} disabled={disabled} onClick={() => { if (!disabled) onEdit(host) }}><Pencil size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function HostPlatformMark({ host }: { host: HostProfile }) {
  const platform = getHostPlatform(host)
  const image = platform === "ubuntu" ? ubuntuMark : platform === "debian" ? debianMark : undefined
  return (
    <span className={`host-platform-mark host-platform-${platform}`} aria-label={`${platform} platform`}>
      {image ? <img src={image} alt="" /> : platform === "rocker" ? "R" : "L"}
    </span>
  )
}
