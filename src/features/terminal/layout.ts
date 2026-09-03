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
  const result = insertHorizontalSplitAtTargets(layout, sessionId, newSessionId)
  if (result.found) return result.layout
  return horizontalSplit(
    layout,
    horizontalSplit(
      { kind: "leaf", sessionId },
      { kind: "leaf", sessionId: newSessionId }
    )
  )
}

function insertHorizontalSplitAtTargets(layout: TerminalLayout, sessionId: string, newSessionId: string): { layout: TerminalLayout; found: boolean } {
  if (layout.kind === "leaf") {
    return layout.sessionId === sessionId
      ? { layout: horizontalSplit(layout, { kind: "leaf", sessionId: newSessionId }), found: true }
      : { layout, found: false }
  }
  const first = insertHorizontalSplitAtTargets(layout.first, sessionId, newSessionId)
  const second = insertHorizontalSplitAtTargets(layout.second, sessionId, newSessionId)
  return {
    layout: { ...layout, first: first.layout, second: second.layout },
    found: first.found || second.found
  }
}

function horizontalSplit(first: TerminalLayout, second: TerminalLayout): TerminalLayout {
  return { kind: "split", direction: "horizontal", ratio: 0.5, first, second }
}

export function removeSessionFromLayout(layout: TerminalLayout, sessionId: string): TerminalLayout | undefined {
  if (layout.kind === "leaf") return layout.sessionId === sessionId ? undefined : layout

  const first = removeSessionFromLayout(layout.first, sessionId)
  const second = removeSessionFromLayout(layout.second, sessionId)
  if (!first) return second
  if (!second) return first
  return { ...layout, first, second }
}
