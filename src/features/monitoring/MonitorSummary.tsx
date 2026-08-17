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
    return <section className="host-monitor host-monitor-offline"><div className="monitor-status-dot" /><div><strong>{t("monitor.title")}</strong><span>{t("monitor.offline")}</span></div></section>
  }
  return (
    <section className="host-monitor-panel" data-expanded={state.expanded}>
      <button className="monitor-summary-button" type="button" onClick={onToggle}>
        <Gauge size={15} />
        <span><strong>{hostName}</strong><small>{formatMetric(metrics?.latencyMs, "ms")} · CPU {formatMetric(metrics?.cpuPercent, "%")}</small></span>
        {state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {state.expanded && <div className="monitor-details">
        <Metric label={t("monitor.cpu")} value={metrics?.cpuPercent} suffix="%" />
        <Metric label={t("monitor.memory")} value={metrics?.memoryPercent} suffix="%" />
        <Metric label="Disk" value={metrics?.diskPercent} suffix="%" />
        <Metric label="RX" value={metrics?.receiveBytesPerSecond} suffix=" B/s" />
        <Metric label="TX" value={metrics?.transmitBytesPerSecond} suffix=" B/s" />
        <span className="monitor-sampled">{metrics ? new Date(metrics.sampledAt).toLocaleTimeString() : "Waiting for sample"}</span>
      </div>}
    </section>
  )
}

function Metric({ label, value, suffix }: { label: string; value: number | null | undefined; suffix: string }) {
  const percent = suffix === "%" && value !== null && value !== undefined ? Math.max(0, Math.min(100, value)) : 0
  return <div className="monitor-metric"><span>{label}</span><strong>{formatMetric(value, suffix)}</strong>{suffix === "%" && <i><b style={{ width: `${percent}%` }} /></i>}</div>
}
