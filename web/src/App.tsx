import { useEffect, useMemo, useState } from "react"
import { fetchSnapshot, subscribeSnapshot } from "./api"
import { ExplanationPanel } from "./components/ExplanationPanel"
import { MetricsPanel } from "./components/MetricsPanel"
import { ServiceList } from "./components/ServiceList"
import { TopologyView } from "./components/TopologyView"
import type { AppGraphSnapshot } from "./types"

const initialSnapshot: AppGraphSnapshot = {
  meta: { projectName: "", composePath: "", version: 0, generatedAt: new Date(0).toISOString() },
  containers: [],
  findings: [],
  explanations: []
}

export default function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<AppGraphSnapshot>(initialSnapshot)

  useEffect(() => {
    let mounted = true
    void fetchSnapshot().then((data) => {
      if (mounted) {
        setSnapshot(data)
      }
    })

    const unsubscribe = subscribeSnapshot((message) => {
      if (message.snapshot) {
        setSnapshot(message.snapshot)
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  const title = useMemo(() => {
    if (snapshot.meta.projectName) {
      return `${snapshot.meta.projectName} Runtime`
    }
    return "Rocker Runtime"
  }, [snapshot.meta.projectName])

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>{title}</h1>
        <p>
          compose: <code>{snapshot.meta.composePath || "n/a"}</code> | version: {snapshot.meta.version}
        </p>
      </header>
      <div className="layout-grid">
        <ServiceList containers={snapshot.containers} />
        <TopologyView containers={snapshot.containers} />
        <MetricsPanel containers={snapshot.containers} />
        <ExplanationPanel findings={snapshot.findings} explanations={snapshot.explanations} />
      </div>
    </main>
  )
}
