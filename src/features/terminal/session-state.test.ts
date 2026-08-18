import { describe, expect, it } from "vitest"
import { appendOutput, attachSession, closeTab, createSessionState, duplicateSession, openTab, renameSession, setTabState, splitSession } from "./session-state"

describe("terminal tab state", () => {
  it("creates independent tabs and activates the newest one", () => {
    let state = createSessionState()
    state = openTab(state, { id: "local-a", hostId: "a", label: "G11" })
    state = openTab(state, { id: "local-b", hostId: "b", label: "Database" })

    expect(state.tabs.map((tab) => tab.id)).toEqual(["local-a", "local-b"])
    expect(state.activeId).toBe("local-b")
  })

  it("falls back to a neighboring tab after close", () => {
    let state = createSessionState()
    state = openTab(state, { id: "one", hostId: "a", label: "A" })
    state = openTab(state, { id: "two", hostId: "b", label: "B" })
    state = closeTab(state, "two")

    expect(state.activeId).toBe("one")
  })

  it("retains terminal output after disconnect", () => {
    let state = openTab(createSessionState(), { id: "one", hostId: "a", label: "A" })
    state = attachSession(state, "one", "6fa459ea-ee8a-3ca4-894e-db77e160355e")
    state = appendOutput(state, "6fa459ea-ee8a-3ca4-894e-db77e160355e", "hello\n")
    state = setTabState(state, "6fa459ea-ee8a-3ca4-894e-db77e160355e", "disconnected")

    expect(state.tabs[0]).toMatchObject({ output: "hello\n", state: "disconnected" })
  })

  it("duplicates and renames a session without copying its live channel", () => {
    let state = openTab(createSessionState(), { id: "one", hostId: "a", label: "A" })
    state = attachSession(state, "one", "session-one", "connection-one")
    state = duplicateSession(state, "one", { id: "two", label: "A copy" })
    state = renameSession(state, "two", "Production shell")

    expect(state.tabs[1]).toMatchObject({ id: "two", label: "Production shell", hostId: "a", state: "connecting", output: "" })
    expect(state.tabs[1].sessionId).toBeUndefined()
    expect(state.tabs[1].connectionId).toBeUndefined()
  })

  it("adds a horizontal split session and activates it", () => {
    let state = openTab(createSessionState(), { id: "one", hostId: "a", label: "A" })
    state = splitSession(state, "one", { id: "two", label: "A split" })

    expect(state.activeId).toBe("two")
    expect(state.tabs.map((tab) => tab.id)).toEqual(["one", "two"])
    expect(state.tabs[1].pane).toEqual({ orientation: "horizontal", parentId: "one" })
  })
})
