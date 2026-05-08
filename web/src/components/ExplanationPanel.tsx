import type { Explanation, Finding } from "../types"

type Props = { findings: Finding[]; explanations: Explanation[] }

export function ExplanationPanel({ findings, explanations }: Props): JSX.Element {
  return (
    <section className="panel">
      <h2>Findings</h2>
      {findings.length === 0 ? <p className="empty">No active findings</p> : null}
      <ul className="finding-list">
        {findings.map((f) => {
          const explanation = explanations.find((e) => e.code === f.code)
          return (
            <li key={f.code} className="finding-item">
              <strong>{f.code}</strong>
              <p>{f.summary}</p>
              {explanation ? <p>{explanation.reason}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
