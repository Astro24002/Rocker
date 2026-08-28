import { describe, expect, it } from "vitest"
import { activateSession, applyTerminalState, attachChannel, closeSession, createTerminalWorkspaceState, openSession } from "./session-state"

describe("terminal workspace state", () => {
  it("stores session metadata without terminal output", () => {
    const state = openSession(createTerminalWorkspaceState(), {
      id: "11111111-1111-4111-8111-111111111111",
      hostId: "host-a",
      label: "G11"
    })

    expect(state.sessions[0]).toMatchObject({ state: "idle", channelGeneration: 0 })
    expect(state.sessions[0]).not.toHaveProperty("output")
  })

  it("selects a neighboring session after the active session closes", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = openSession(state, { id: "two", hostId: "host-b", label: "B" })
    state = closeSession(state, "two")

    expect(state.activeSessionId).toBe("one")
  })

  it("copies only channel metadata when a channel attaches", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = attachChannel(state, {
      sessionId: "one",
      hostId: "host-a",
      channelGeneration: 2,
      state: "connected"
    })

    expect(state.sessions[0]).toEqual({
      id: "one",
      hostId: "host-a",
      label: "A",
      state: "connected",
      channelGeneration: 2
    })
  })

  it("applies a terminal state event to its matching session", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = applyTerminalState(state, {
      kind: "state",
      sessionId: "one",
      channelGeneration: 1,
      state: "reconnecting",
      reason: "network",
      attempt: 2,
      nextRetryAt: "2026-08-19T12:00:00.000Z"
    })

    expect(state.sessions[0]).toMatchObject({
      state: "reconnecting",
      channelGeneration: 1,
      reason: "network",
      attempt: 2,
      nextRetryAt: "2026-08-19T12:00:00.000Z"
    })
  })

  it("ignores a stale state event from an older channel generation", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = applyTerminalState(state, {
      kind: "state",
      sessionId: "one",
      channelGeneration: 2,
      state: "connected"
    })
    state = applyTerminalState(state, {
      kind: "state",
      sessionId: "one",
      channelGeneration: 1,
      state: "error",
      reason: "network"
    })

    expect(state.sessions[0]).toMatchObject({ state: "connected", channelGeneration: 2 })
  })

  it("clears retry metadata when a current generation reaches a terminal state", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = applyTerminalState(state, {
      kind: "state", sessionId: "one", channelGeneration: 1, state: "reconnecting", attempt: 3,
      nextRetryAt: "2026-08-19T12:00:00.000Z", reason: "network"
    })
    state = applyTerminalState(state, { kind: "state", sessionId: "one", channelGeneration: 1, state: "connected" })

    expect(state.sessions[0]).toMatchObject({ state: "connected", channelGeneration: 1 })
    expect(state.sessions[0]).not.toHaveProperty("attempt")
    expect(state.sessions[0]).not.toHaveProperty("nextRetryAt")
    expect(state.sessions[0]).not.toHaveProperty("reason")
  })

  it("activates an existing session without changing session metadata", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "one", hostId: "host-a", label: "A" })
    state = openSession(state, { id: "two", hostId: "host-b", label: "B" })
    state = activateSession(state, "one")

    expect(state.activeSessionId).toBe("one")
    expect(state.sessions).toHaveLength(2)
  })
})
