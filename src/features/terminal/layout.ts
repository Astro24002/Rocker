export interface TerminalLeafLayout {
  kind: "leaf"
  sessionId: string
}

export interface TerminalSplitLayout {
  kind: "split"
  direction: "horizontal"
  ratio: number
  first: TerminalLayout
  second: TerminalLayout
}

export type TerminalLayout = TerminalLeafLayout | TerminalSplitLayout

export function visibleSessionIds(layout: TerminalLayout | undefined): string[] {
  if (!layout) return []
  if (layout.kind === "leaf") return [layout.sessionId]
  return [...visibleSessionIds(layout.first), ...visibleSessionIds(layout.second)]
}

export function insertHorizontalSplit(layout: TerminalLayout, sessionId: string, newSessionId: string): TerminalLayout {
  if (layout.kind === "leaf") {
    if (layout.sessionId !== sessionId) return layout
    return {
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: layout,
      second: { kind: "leaf", sessionId: newSessionId }
    }
  }
  return {
    ...layout,
    first: insertHorizontalSplit(layout.first, sessionId, newSessionId),
    second: insertHorizontalSplit(layout.second, sessionId, newSessionId)
  }
}

export function removeSessionFromLayout(layout: TerminalLayout, sessionId: string): TerminalLayout | undefined {
  if (layout.kind === "leaf") return layout.sessionId === sessionId ? undefined : layout

  const first = removeSessionFromLayout(layout.first, sessionId)
  const second = removeSessionFromLayout(layout.second, sessionId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}
