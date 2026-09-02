import { Clock3, RotateCcw, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import type { ConnectionHistoryItem, HostProfile } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"

interface HistoryViewProps {
  items: ConnectionHistoryItem[]
  hosts: HostProfile[]
  disabled?: boolean
  reconnectDisabled?: boolean
  onReconnect(host: HostProfile): void
  onClear(): void
}

export function HistoryView({ items, hosts, disabled = false, reconnectDisabled = false, onReconnect, onClear }: HistoryViewProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const rows = useMemo(() => items.map((item) => ({ item, host: hosts.find((host) => host.id === item.hostId) }))
    .filter(({ host }) => !query || `${host?.name ?? ""} ${host?.host ?? ""}`.toLowerCase().includes(query.toLowerCase())), [items, hosts, query])

  return (
    <section className="history-view">
      <header className="view-header">
        <div><span className="view-eyebrow">Rocker / {t("workspace.personal")}</span><h1>{t("history.title")}</h1><p>Recent connections are stored on this device.</p></div>
        <IconButton label="Clear history" disabled={disabled} onClick={() => { if (!disabled) onClear() }}><Trash2 size={16} /></IconButton>
      </header>
      <div className="history-content">
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("common.search")} /></label>
        <div className="history-table">
          <div className="history-heading"><span>Host</span><span>Connected</span><span>Duration</span><span>Outcome</span><span /></div>
          {rows.map(({ item, host }) => (
            <div key={item.id} className="history-row">
              <span className="history-host"><Clock3 size={14} /><strong>{host?.name ?? "Removed host"}</strong><small>{host?.host ?? item.hostId}</small></span>
              <span>{new Date(item.connectedAt).toLocaleString()}</span>
              <span>{formatDuration(item.durationMs)}</span>
              <span className="history-outcome" data-outcome={item.outcome}>{item.outcome}</span>
              <IconButton label="Reconnect" disabled={!host || reconnectDisabled} onClick={() => { if (host && !reconnectDisabled) onReconnect(host) }}><RotateCcw size={14} /></IconButton>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
