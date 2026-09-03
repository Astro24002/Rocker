import { describe, expect, it } from "vitest"
import { recentSessionIds, recordSessionFocus, removeRecentSession, type RecentSessionState } from "./recent-sessions"

describe("recent sessions", () => {
  it("records focus timestamps without mutating the previous state", () => {
    const previous: RecentSessionState = { "session-a": 100 }

    const next = recordSessionFocus(previous, "session-b", 200)

    expect(previous).toEqual({ "session-a": 100 })
    expect(next).toEqual({ "session-a": 100, "session-b": 200 })
  })

  it("orders live sessions by descending focus time with a stable id tie break", () => {
    const state = recordSessionFocus(
      recordSessionFocus(
        recordSessionFocus({}, "session-z", 200),
        "session-a",
        200
      ),
      "session-b",
      300
    )

    expect(recentSessionIds(state, ["session-a", "session-b", "session-z"])).toEqual([
      "session-b",
      "session-a",
      "session-z"
    ])
  })

  it("removes closed sessions and keeps the previous state unchanged", () => {
    const previous: RecentSessionState = { "session-a": 100, "session-b": 200 }

    const next = removeRecentSession(previous, "session-b")

    expect(previous).toEqual({ "session-a": 100, "session-b": 200 })
    expect(next).toEqual({ "session-a": 100 })
    expect(recentSessionIds(next, ["session-a"])).toEqual(["session-a"])
    expect(recentSessionIds(previous, ["session-a"])).toEqual(["session-a"])
  })
})
