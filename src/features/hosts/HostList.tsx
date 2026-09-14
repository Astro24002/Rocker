import { Copy, Import, Pencil, PlugZap, Plus, Search, Server, Star, StarOff, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import ubuntuMark from "../../assets/platforms/ubuntu.svg"
import debianMark from "../../assets/platforms/debian.svg"
import type { ConnectionTestResult, HostEnvironment, HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import type { TranslationKey } from "../../i18n/en"
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
  onTestConnection?(host: HostProfile): Promise<ConnectionTestResult>
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
  onTestConnection,
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
  const [connectionTest, setConnectionTest] = useState<{ hostId: string; result: ConnectionTestResult }>()
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
  const selectedHost = selectedHostId ? hosts.find((host) => host.id === selectedHostId) : undefined
  const filtered = useMemo(() => {
    const filter = { group, query: /^ssh(?:\s|$)/i.test(query.trim()) ? "" : query, recentOnly, recentHostIds, environment, tag }
    return filterHosts(hosts, filter)
  }, [environment, group, hosts, query, recentHostIds, recentOnly, tag])

  const selectHost = (host: HostProfile): void => {
    if (!disabled) {
      setSelectedHostId(host.id)
      setConnectionTest(undefined)
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

  const testSelectedConnection = (): void => {
    if (!selectedHost || !onTestConnection) return
    void runHostAction(async () => {
      setConnectionTest(undefined)
      const result = await onTestConnection(selectedHost)
      setConnectionTest({ hostId: selectedHost.id, result })
    })
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
    if (!selectedHost) return
    const confirmationKey = selectedHost.environment === "production" ? "hosts.action.deleteProductionConfirm" : "hosts.action.deleteConfirm"
    if (!window.confirm(t(confirmationKey).replace("{name}", selectedHost.name))) return
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
            <div className="host-selection-actions" aria-label={t("hosts.action.namedActions").replace("{name}", selectedHost.name)}>
              <button className="host-context-action" type="button" aria-label={t("hosts.action.editNamed").replace("{name}", selectedHost.name)} title={t("hosts.action.edit")} disabled={disabled || actionBusy} onClick={() => onEdit(selectedHost)}><Pencil size={14} /></button>
              <button className="host-context-action" type="button" aria-label={t("hosts.action.duplicate")} title={t("hosts.action.duplicate")} disabled={disabled || actionBusy} onClick={duplicateSelected}><Copy size={14} /></button>
              {onTestConnection ? <button className="host-context-action" type="button" aria-label={t("hosts.action.testConnection")} title={t("hosts.action.testConnection")} disabled={disabled || actionBusy} onClick={testSelectedConnection}><PlugZap size={14} /></button> : null}
              <button className="host-context-action" type="button" aria-label={selectedHost.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} title={selectedHost.favorite ? t("hosts.action.unfavorite") : t("hosts.action.favorite")} disabled={disabled || actionBusy} onClick={toggleSelectedFavorite}>{selectedHost.favorite ? <StarOff size={14} /> : <Star size={14} />}</button>
              <button className="host-context-action host-context-danger" type="button" aria-label={t("hosts.action.delete")} title={t("hosts.action.delete")} disabled={disabled || actionBusy} onClick={removeSelected}><Trash2 size={14} /></button>
            </div>
          ) : null}
          <button className="secondary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onImport() }}><Import size={15} />{t("hosts.import")}</button>
          <button className="primary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onAdd() }}><Plus size={15} />{t("hosts.add")}</button>
        </div>
      </header>

      {actionError ? <p className="host-action-error" role="status" aria-live="polite">{t("hosts.action.failed")}</p> : null}
      {connectionTest ? <p className={`host-connection-test-result ${connectionTest.result.status === "reachable" ? "is-success" : "is-failure"}`} role="status" aria-live="polite">{formatConnectionTestResult(connectionTest.result, t)}</p> : null}

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
                  disabled={disabled}
                  onClick={() => selectHost(host)}
                  onKeyDown={(event) => {
                    if (disabled || event.repeat) return
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
                <button className="host-card-edit" type="button" aria-label={t("hosts.action.editNamed").replace("{name}", host.name)} disabled={disabled} onClick={() => { if (!disabled) onEdit(host) }}><Pencil size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
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

function formatConnectionTestResult(result: ConnectionTestResult, translate: (key: TranslationKey) => string): string {
  if (result.status === "reachable") return translate("hosts.action.connectionReachable").replace("{latency}", String(result.latencyMs))
  if (result.reason === "cancelled") return translate("hosts.action.connectionCancelled")
  return translate("hosts.action.connectionFailed")
}
