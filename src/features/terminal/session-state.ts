export type TerminalTabState = "connecting" | "connected" | "disconnected" | "error" | "reconnecting"

export interface SessionPane {
  orientation: "horizontal"
  parentId: string
}

export interface WorkspaceSession {
  id: string
  sessionId?: string
  connectionId?: string
  hostId: string
  label: string
  state: TerminalTabState
  output: string
  error?: string
  pane?: SessionPane
}

export type TerminalTab = WorkspaceSession

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

export function attachSession(state: TerminalSessionState, localId: string, sessionId: string, connectionId?: string): TerminalSessionState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === localId ? { ...tab, sessionId, connectionId, state: "connected" } : tab)
  }
}

export function duplicateSession(
  state: TerminalSessionState,
  sourceId: string,
  input: Pick<WorkspaceSession, "id" | "label"> & Partial<Pick<WorkspaceSession, "hostId">>
): TerminalSessionState {
  const source = state.tabs.find((tab) => tab.id === sourceId)
  if (!source) return state
  const clone: WorkspaceSession = {
    id: input.id,
    hostId: input.hostId ?? source.hostId,
    label: input.label,
    state: "connecting",
    output: ""
  }
  return { ...state, tabs: [...state.tabs, clone], activeId: clone.id }
}

export function renameSession(state: TerminalSessionState, localId: string, label: string): TerminalSessionState {
  const nextLabel = label.trim()
  return nextLabel ? { ...state, tabs: state.tabs.map((tab) => tab.id === localId ? { ...tab, label: nextLabel } : tab) } : state
}

export function splitSession(
  state: TerminalSessionState,
  sourceId: string,
  input: Pick<WorkspaceSession, "id" | "label"> & Partial<Pick<WorkspaceSession, "hostId">>
): TerminalSessionState {
  const source = state.tabs.find((tab) => tab.id === sourceId)
  if (!source) return state
  const clone: WorkspaceSession = {
    id: input.id,
    hostId: input.hostId ?? source.hostId,
    label: input.label,
    state: "connecting",
    output: "",
    pane: { orientation: "horizontal", parentId: sourceId }
  }
  return { ...state, tabs: [...state.tabs, clone], activeId: clone.id }
}

export const closeSession = closeTab

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
