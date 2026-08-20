import { describe, expect, it } from "vitest"
import { insertHorizontalSplit, removeSessionFromLayout, visibleSessionIds, type TerminalLayout } from "./layout"

describe("terminal layout", () => {
  it("returns leaf session IDs in render order", () => {
    const layout: TerminalLayout = {
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { kind: "leaf", sessionId: "a" },
      second: {
        kind: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: { kind: "leaf", sessionId: "b" },
        second: { kind: "leaf", sessionId: "c" }
      }
    }

    expect(visibleSessionIds(layout)).toEqual(["a", "b", "c"])
  })

  it("replaces the selected leaf with a horizontal split", () => {
    const layout: TerminalLayout = { kind: "leaf", sessionId: "a" }

    expect(insertHorizontalSplit(layout, "a", "b")).toEqual({
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { kind: "leaf", sessionId: "a" },
      second: { kind: "leaf", sessionId: "b" }
    })
  })

  it("collapses a horizontal split when one leaf closes", () => {
    const layout: TerminalLayout = {
      kind: "split",
      direction: "horizontal",
      ratio: 0.5,
      first: { kind: "leaf", sessionId: "a" },
      second: { kind: "leaf", sessionId: "b" }
    }

    expect(removeSessionFromLayout(layout, "b")).toEqual({ kind: "leaf", sessionId: "a" })
  })
})
