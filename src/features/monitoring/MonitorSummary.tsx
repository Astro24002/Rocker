import { ChevronDown, ChevronUp, Gauge } from "lucide-react"
import { useI18n } from "../../i18n"
import { formatMetric, type MonitorState } from "./monitor-state"

interface MonitorSummaryProps {
  state: MonitorState
  hostName?: string
  onToggle(): void
}

export function MonitorSummary({ state, hostName, onToggle }: MonitorSummaryProps) {
  const { t } = useI18n()
  const metrics = state.metrics
  if (!hostName) {
    return <section className="terminal-monitor terminal-monitor-offline" data-testid="terminal-monitor"><Gauge size={15} /><span>{t("monitor.offline")}</span></section>
  }
  return (
    <section className="terminal-monitor" data-expanded={state.expanded} data-testid="terminal-monitor">
      <div className="terminal-monitor-summary">
        <button className="monitor-summary-button" type="button" onClick={onToggle}>
          <Gauge size={15} />
          <strong>{hostName}</strong>
          {state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <div className="terminal-monitor-metrics">
          <Metric label={t("monitor.cpu")} value={metrics?.cpuPercent} suffix="%" />
          <Metric label={t("monitor.memory")} value={metrics?.memoryPercent} suffix="%" />
          <Metric label="RX" value={metrics?.receiveBytesPerSecond} suffix=" B/s" />
          <Metric label="TX" value={metrics?.transmitBytesPerSecond} suffix=" B/s" />
          <Metric label={t("monitor.load")} value={metrics?.loadAverage} load />
        </div>
      </div>
      {state.expanded && <div className="monitor-details">
        <Metric label="Disk" value={metrics?.diskPercent} suffix="%" />
        <span className="monitor-sampled">{metrics ? new Date(metrics.sampledAt).toLocaleTimeString() : "Waiting for sample"}</span>
      </div>}
    </section>
  )
}

function Metric({ label, value, suffix = "", load = false }: { label: string; value: number | null | undefined; suffix?: string; load?: boolean }) {
  const percent = suffix === "%" && value !== null && value !== undefined ? Math.max(0, Math.min(100, value)) : 0
  const formatted = load ? (value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2)) : formatMetric(value, suffix)
  return <div className="monitor-metric"><span>{label}</span><strong>{formatted}</strong>{suffix === "%" && <i><b style={{ width: `${percent}%` }} /></i>}</div>
}
