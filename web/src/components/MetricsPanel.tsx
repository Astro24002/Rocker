import type { Container } from "../types"

type Props = { containers: Container[] }

export function MetricsPanel({ containers }: Props): JSX.Element {
  const running = containers.filter((c) => c.state === "running").length
  const totalRestarts = containers.reduce((sum, c) => sum + (c.restartCount || 0), 0)

  return (
    <section className="panel metrics">
      <h2>Metrics</h2>
      <div className="metric-grid">
        <article className="metric-card">
          <div className="label">Running</div>
          <div className="value">{running}</div>
        </article>
        <article className="metric-card">
          <div className="label">Containers</div>
          <div className="value">{containers.length}</div>
        </article>
        <article className="metric-card">
          <div className="label">Restarts</div>
          <div className="value">{totalRestarts}</div>
        </article>
      </div>
    </section>
  )
}
