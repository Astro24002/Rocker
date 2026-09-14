import { CheckCircle2, History, Search, ShieldCheck, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import type { HostKeyAuditRecord, HostKeyInventoryEntry } from "../../../electron/ipc/bridge-contract"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"

interface TrustViewProps {
  entries: HostKeyInventoryEntry[]
  history: HostKeyAuditRecord[]
  hosts: HostProfile[]
  disabled?: boolean
  loading?: boolean
  error?: boolean
  onRemove(entry: HostKeyInventoryEntry): Promise<void>
}

export function TrustView({ entries, history, hosts, disabled = false, loading = false, error = false, onRemove }: TrustViewProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [busyEndpoint, setBusyEndpoint] = useState<string>()
  const [actionError, setActionError] = useState(false)
  const [actionSuccess, setActionSuccess] = useState(false)

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return entries
      .map((entry) => ({ entry, label: hostLabel(entry, hosts), endpoint: formatEndpoint(entry.host, entry.port) }))
      .filter(({ entry, label, endpoint }) => !normalizedQuery || `${label} ${endpoint} ${entry.fingerprint}`.toLowerCase().includes(normalizedQuery))
      .sort((left, right) => left.label.localeCompare(right.label) || left.endpoint.localeCompare(right.endpoint))
  }, [entries, hosts, query])

  const activity = useMemo(() => [...history].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 100), [history])

  const remove = async (entry: HostKeyInventoryEntry, label: string): Promise<void> => {
    if (disabled || loading || busyEndpoint) return
    const endpoint = formatEndpoint(entry.host, entry.port)
    if (!window.confirm(t("trust.removeConfirm").replace("{name}", label).replace("{endpoint}", endpoint))) return
    setBusyEndpoint(endpoint)
    setActionError(false)
    setActionSuccess(false)
    try {
      await onRemove(entry)
      setActionSuccess(true)
    } catch {
      setActionError(true)
    } finally {
      setBusyEndpoint(undefined)
    }
  }

  return (
    <section className="trust-view">
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("workspace.personal")}</span>
          <h1>{t("trust.title")}</h1>
          <p>{t("trust.subtitle")}</p>
        </div>
        <div className="trust-header-status"><ShieldCheck size={16} aria-hidden="true" /><span>{entries.length}</span></div>
      </header>
      {error && <p className="trust-status trust-status-error" role="status">{t("trust.unavailable")}</p>}
      {actionError && <p className="trust-status trust-status-error" role="status">{t("trust.removeError")}</p>}
      {actionSuccess && <p className="trust-status" role="status"><CheckCircle2 size={14} aria-hidden="true" />{t("trust.removeSuccess")}</p>}
      <div className="trust-content">
        <label className="search-field trust-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("trust.search")} aria-label={t("trust.search")} /></label>

        <section className="trust-panel" aria-labelledby="trusted-endpoints-heading">
          <header className="trust-panel-heading"><div><ShieldCheck size={15} aria-hidden="true" /><h2 id="trusted-endpoints-heading">{t("trust.trustedEndpoints")}</h2></div><span>{rows.length}</span></header>
          {loading ? <p className="trust-empty">{t("trust.loading")}</p> : rows.length === 0 ? <div className="trust-empty"><ShieldCheck size={22} aria-hidden="true" /><strong>{t("trust.emptyTitle")}</strong><span>{t("trust.emptyBody")}</span></div> : (
            <div className="trust-list" role="list">
              {rows.map(({ entry, label, endpoint }) => (
                <div key={endpoint} className="trust-row" role="listitem">
                  <div className="trust-row-mark"><ShieldCheck size={16} aria-hidden="true" /></div>
                  <div className="trust-row-copy"><strong>{label}</strong><span>{endpoint}</span></div>
                  <code>{formatFingerprint(entry.fingerprint)}</code>
                  <button className="trust-remove" type="button" disabled={disabled || loading || busyEndpoint !== undefined} aria-label={t("trust.removeAction").replace("{name}", label)} title={t("trust.removeAction").replace("{name}", label)} onClick={() => void remove(entry, label)}><Trash2 size={14} aria-hidden="true" />{t("trust.remove")}</button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="trust-panel" aria-labelledby="trust-activity-heading">
          <header className="trust-panel-heading"><div><History size={15} aria-hidden="true" /><h2 id="trust-activity-heading">{t("trust.activity")}</h2></div><span>{activity.length}</span></header>
          {activity.length === 0 ? <p className="trust-empty trust-empty-inline">{t("trust.noActivity")}</p> : (
            <div className="trust-list trust-activity-list" role="list">
              {activity.map((record, index) => <div key={`${record.at}-${record.host}-${record.port}-${record.action}-${index}`} className="trust-activity-row" role="listitem"><span className="trust-activity-action" data-action={record.action}>{t(`trust.action.${record.action}`)}</span><span>{formatEndpoint(record.host, record.port)}</span><code>{formatFingerprint(record.fingerprint)}</code><time dateTime={record.at}>{formatDate(record.at)}</time></div>)}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function hostLabel(entry: HostKeyInventoryEntry, hosts: HostProfile[]): string {
  return hosts.find((host) => host.host === entry.host && host.port === entry.port)?.name ?? formatEndpoint(entry.host, entry.port)
}

function formatEndpoint(host: string, port: number): string {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host
  return `${displayHost}:${port}`
}

function formatFingerprint(fingerprint: string): string {
  return `SHA256:${fingerprint.replace(/^SHA256:/i, "")}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
