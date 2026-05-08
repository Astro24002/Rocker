export type SnapshotMeta = {
  projectName: string
  composePath: string
  version: number
  generatedAt: string
}

export type Container = {
  id: string
  name: string
  state: string
  status: string
  cpuThrottleRatio: number
  restartCount: number
}

export type Finding = {
  code: string
  summary: string
  severity?: string
}

export type Explanation = {
  code: string
  reason: string
  impact: string
  actions: string[]
  evidenceRefs: string[]
}

export type AppGraphSnapshot = {
  meta: SnapshotMeta
  containers: Container[]
  findings: Finding[]
  explanations: Explanation[]
}

export type WSMessage = {
  kind: "snapshot.init" | "snapshot.patch" | "finding.updated"
  snapshot?: AppGraphSnapshot
}
