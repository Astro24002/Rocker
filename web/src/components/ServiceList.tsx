import type { Container } from "../types"

type Props = { containers: Container[] }

export function ServiceList({ containers }: Props): JSX.Element {
  return (
    <section className="panel">
      <h2>Services</h2>
      <ul className="service-list">
        {containers.map((c) => (
          <li key={c.id} className={`service-item state-${c.state || "unknown"}`}>
            <div className="service-name">{c.name || c.id}</div>
            <div className="service-meta">state: {c.state || "unknown"}</div>
          </li>
        ))}
        {containers.length === 0 ? <li className="empty">No containers detected</li> : null}
      </ul>
    </section>
  )
}
