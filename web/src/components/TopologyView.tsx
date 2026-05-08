import type { Container } from "../types"

type Props = { containers: Container[] }

export function TopologyView({ containers }: Props): JSX.Element {
  return (
    <section className="panel">
      <h2>Topology</h2>
      <div className="topology-grid">
        {containers.map((c) => (
          <div key={c.id} className="topology-node">
            <span>{c.name || c.id}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
