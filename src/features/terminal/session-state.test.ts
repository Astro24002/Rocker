import { describe, expect, it } from "vitest"
import { appendOutput, attachSession, closeTab, createSessionState, openTab, setTabState } from "./session-state"

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
})
