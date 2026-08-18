import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp, Cpu, Gauge, HardDrive, MemoryStick, type LucideIcon } from "lucide-react"
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
    return <section className="terminal-monitor terminal-monitor-hud terminal-monitor-offline" data-testid="terminal-monitor"><Gauge size={15} /><span>{t("monitor.offline")}</span></section>
  }
  return (
    <section className="terminal-monitor terminal-monitor-hud" data-expanded={state.expanded} data-testid="terminal-monitor">
      <div className="monitor-hud-header">
        <button className="monitor-summary-button" type="button" onClick={onToggle}>
          <Gauge size={15} />
          <span><small>LIVE MONITOR</small><strong>{hostName}</strong></span>
        </button>
        <span className="monitor-hud-status"><i />ONLINE</span>
        <button className="monitor-hud-toggle" aria-label={state.expanded ? "Collapse host monitor" : "Expand host monitor"} type="button" onClick={onToggle}>
          {state.expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      <div className="monitor-hud-grid">
        <Metric icon={Cpu} label={t("monitor.cpu")} value={metrics?.cpuPercent} suffix="%" />
        <Metric icon={MemoryStick} label={t("monitor.memory")} value={metrics?.memoryPercent} suffix="%" />
        <Metric icon={ArrowDownToLine} label="RX" value={metrics?.receiveBytesPerSecond} suffix=" B/s" />
        <Metric icon={ArrowUpFromLine} label="TX" value={metrics?.transmitBytesPerSecond} suffix=" B/s" />
        <Metric icon={Activity} label={t("monitor.load")} value={metrics?.loadAverage} load />
      </div>
      {state.expanded && <div className="monitor-hud-details"><Metric icon={HardDrive} label="Disk" value={metrics?.diskPercent} suffix="%" /><span className="monitor-sampled">{metrics ? new Date(metrics.sampledAt).toLocaleTimeString() : "Waiting for sample"}</span></div>}
    </section>
  )
}

function Metric({ icon: Icon, label, value, suffix = "", load = false }: { icon: LucideIcon; label: string; value: number | null | undefined; suffix?: string; load?: boolean }) {
  const percent = suffix === "%" && value !== null && value !== undefined ? Math.max(0, Math.min(100, value)) : 0
  const formatted = load ? (value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2)) : formatMetric(value, suffix)
  return <div className="monitor-metric"><div className="monitor-metric-heading"><Icon aria-hidden="true" size={12} /><span>{label}</span></div><strong>{formatted}</strong>{suffix === "%" && <i><b style={{ width: `${percent}%` }} /></i>}</div>
}
