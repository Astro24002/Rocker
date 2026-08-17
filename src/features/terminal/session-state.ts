export type TerminalTabState = "connecting" | "connected" | "disconnected" | "error" | "reconnecting"

export interface TerminalTab {
  id: string
  sessionId?: string
  hostId: string
  label: string
  state: TerminalTabState
  output: string
  error?: string
}

export interface TerminalSessionState {
  tabs: TerminalTab[]
  activeId?: string
}

export function createSessionState(): TerminalSessionState {
  return { tabs: [] }
}

export function openTab(
  state: TerminalSessionState,
  input: Pick<TerminalTab, "id" | "hostId" | "label">
): TerminalSessionState {
  return {
    tabs: [...state.tabs, { ...input, state: "connecting", output: "" }],
    activeId: input.id
  }
}

export function attachSession(state: TerminalSessionState, localId: string, sessionId: string): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === localId ? { ...tab, sessionId, state: "connected" } : tab)
  }
}

export function closeTab(state: TerminalSessionState, localId: string): TerminalSessionState {
  const index = state.tabs.findIndex((tab) => tab.id === localId)
  const tabs = state.tabs.filter((tab) => tab.id !== localId)
  const activeId = state.activeId === localId
    ? tabs[Math.max(0, Math.min(index - 1, tabs.length - 1))]?.id
    : state.activeId
  return { tabs, activeId }
}

export function activateTab(state: TerminalSessionState, localId: string): TerminalSessionState {
  return state.tabs.some((tab) => tab.id === localId) ? { ...state, activeId: localId } : state
}

export function appendOutput(state: TerminalSessionState, sessionId: string, output: string): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, output: `${tab.output}${output}` } : tab)
  }
}

export function setTabState(
  state: TerminalSessionState,
  sessionId: string,
  tabState: TerminalTabState,
  error?: string
): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.sessionId === sessionId ? { ...tab, state: tabState, error } : tab)
  }
}

export function setLocalTabState(
  state: TerminalSessionState,
  localId: string,
  tabState: TerminalTabState,
  error?: string
): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === localId ? { ...tab, state: tabState, error } : tab)
  }
}

export function clearTabOutput(state: TerminalSessionState, localId: string): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === localId ? { ...tab, output: "" } : tab)
  }
}
