import { describe, expect, it } from "vitest"
import { activateSession, applyTerminalState, attachChannel, closeSession, createTerminalWorkspaceState, openSession, patchSession, sessionKind, synchronizePortForwardingSessions } from "./session-state"

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
      channelGeneration: 2,
      kind: "ssh"
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

  it("defaults missing kind to SSH and stores mixed session kinds independently", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "ssh", hostId: "host-a", label: "A" })
    state = openSession(state, { id: "sftp", hostId: "host-a", label: "A files", kind: "sftp", path: "/var" })
    state = openSession(state, { id: "pf", hostId: "host-a", label: "A forward", kind: "pf", profileId: "profile-1" })

    expect(sessionKind(state.sessions[0])).toBe("ssh")
    expect(sessionKind(undefined)).toBe("ssh")
    expect(state.sessions.map((session) => sessionKind(session))).toEqual(["ssh", "sftp", "pf"])
    expect(state.activeSessionId).toBe("pf")
  })

  it("supports a Host-level PF workspace before a forwarding rule exists", () => {
    const state = openSession(createTerminalWorkspaceState(), { id: "pf-host", hostId: "host-a", label: "G11", kind: "pf" })

    expect(state.sessions[0]).toMatchObject({ id: "pf-host", kind: "pf", hostId: "host-a", forwardingStatus: "stopped", state: "disconnected" })
    expect(state.sessions[0]).not.toHaveProperty("profileId")
  })

  it("patches only the requested session fields", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "sftp", hostId: "host-a", label: "A", kind: "sftp", path: "/" })
    state = patchSession(state, "sftp", { kind: "sftp", browser: { path: "/etc" }, state: "connected" })

    expect(state.sessions[0]).toMatchObject({ id: "sftp", kind: "sftp", browser: { path: "/etc", entries: [], loading: false }, state: "connected" })
  })

  it("tracks transient SSH activity and active SFTP transfers without affecting neighboring sessions", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "ssh", hostId: "host-a", label: "A" })
    state = openSession(state, { id: "sftp", hostId: "host-a", label: "A files", kind: "sftp" })
    state = patchSession(state, "ssh", { kind: "ssh", hasUnreadActivity: true })
    state = patchSession(state, "sftp", { kind: "sftp", activeTransferCount: 2 })

    expect(state.sessions[0]).toMatchObject({ id: "ssh", hasUnreadActivity: true })
    expect(state.sessions[1]).toMatchObject({ id: "sftp", activeTransferCount: 2 })

    state = patchSession(state, "ssh", { kind: "ssh", hasUnreadActivity: false })
    state = patchSession(state, "sftp", { kind: "sftp", activeTransferCount: 0 })
    expect(state.sessions[0]).not.toHaveProperty("hasUnreadActivity")
    expect(state.sessions[1]).not.toHaveProperty("activeTransferCount")
  })

  it("keeps neighboring mixed sessions after the active session closes", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "ssh", hostId: "host-a", label: "A", kind: "ssh" })
    state = openSession(state, { id: "sftp", hostId: "host-a", label: "A files", kind: "sftp" })
    state = openSession(state, { id: "pf", hostId: "host-b", label: "B forward", kind: "pf", profileId: "profile-1" })
    state = closeSession(state, "pf")

    expect(state.sessions.map((session) => session.id)).toEqual(["ssh", "sftp"])
    expect(state.activeSessionId).toBe("sftp")
  })

  it("ignores SSH channel events for SFTP and PF sessions", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "sftp", hostId: "host-a", label: "A", kind: "sftp" })
    state = applyTerminalState(state, { kind: "state", sessionId: "sftp", channelGeneration: 1, state: "connected" })
    state = attachChannel(state, { sessionId: "sftp", hostId: "host-a", channelGeneration: 2, state: "connected" })

    expect(state.sessions[0]).toMatchObject({ state: "idle", kind: "sftp", browser: { path: ".", entries: [], loading: false } })
    expect(state.sessions[0]).not.toHaveProperty("channelGeneration")
  })

  it("does not create PF pages from a runtime until the user opens one", () => {
    let state = openSession(createTerminalWorkspaceState(), { id: "ssh", hostId: "host-a", label: "A" })
    state = synchronizePortForwardingSessions(state, [{
      profile: {
        id: "profile-1",
        hostId: "host-a",
        name: "Web",
        localAddress: "127.0.0.1",
        localPort: 8080,
        remoteAddress: "127.0.0.1",
        remotePort: 80,
        autoStart: false,
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z"
      },
      runtime: {
        id: "forward-1",
        hostId: "host-a",
        profileId: "profile-1",
        localAddress: "127.0.0.1",
        localPort: 8080,
        remoteAddress: "127.0.0.1",
        remotePort: 80,
        status: "forwarding"
      }
    }])

    expect(state.activeSessionId).toBe("ssh")
    expect(state.sessions).toHaveLength(1)

    state = openSession(state, { id: "pf", hostId: "host-a", label: "Host A", kind: "pf", profileId: "profile-1" })
    state = synchronizePortForwardingSessions(state, [{
      profile: {
        id: "profile-1",
        hostId: "host-a",
        name: "Web renamed",
        localAddress: "127.0.0.1",
        localPort: 8080,
        remoteAddress: "127.0.0.1",
        remotePort: 80,
        autoStart: false,
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z"
      }
    }])

    expect(state.sessions).toHaveLength(2)
    expect(state.sessions[1]).toMatchObject({ label: "Host A", forwardingStatus: "stopped", state: "disconnected" })
  })
})
