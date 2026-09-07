import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import type { TerminalWorkspaceState } from "./session-state"
import { TerminalWorkspace } from "./TerminalWorkspace"

vi.mock("./TerminalView", () => ({
  TerminalView: ({ session, visible, onSearchController }: { session: { id: string }; visible: boolean; onSearchController: () => void }) => (
    <div data-testid={`terminal-surface-${session.id}`} data-search-handler={String(typeof onSearchController === "function")} data-visible={String(visible)} />
  )
}))

describe("TerminalWorkspace layout", () => {
  it("keeps the terminal stack as the first persistent workspace content", () => {
    const { container } = render(<I18nProvider><TerminalWorkspace
      workspace={workspace}
      preferences={preferences}
      confirmMultilinePaste
      onInput={vi.fn()}
      onResize={vi.fn()}
      onAck={vi.fn()}
      onController={vi.fn()}
      onSearchController={vi.fn()}
    /></I18nProvider>)

    const terminalWorkspace = container.querySelector(".terminal-workspace")!
    expect(terminalWorkspace.firstElementChild).toHaveClass("terminal-stack")
    expect(terminalWorkspace.querySelector("[data-testid='terminal-monitor']")).toBeNull()
    expect(terminalWorkspace.querySelector(".monitor-hud-header")).toBeNull()
    expect(terminalWorkspace.querySelector(".terminal-session-toolbar")).toBeNull()
  })

  it("renders every session surface but hides non-visible layout leaves", () => {
    render(<I18nProvider><TerminalWorkspace
      workspace={workspace}
      preferences={preferences}
      confirmMultilinePaste
      onInput={vi.fn()}
      onResize={vi.fn()}
      onAck={vi.fn()}
      onController={vi.fn()}
      onSearchController={vi.fn()}
    /></I18nProvider>)

    expect(screen.getAllByTestId(/terminal-surface-/)).toHaveLength(3)
    expect(screen.getByTestId("terminal-surface-a")).toHaveAttribute("data-visible", "true")
    expect(screen.getByTestId("terminal-surface-b")).toHaveAttribute("data-visible", "false")
    expect(screen.getByTestId("terminal-surface-c")).toHaveAttribute("data-visible", "false")
    expect(screen.getByTestId("terminal-surface-a")).toHaveAttribute("data-search-handler", "true")
  })

  it("renders visible surfaces in split-tree order before hidden sessions", () => {
    const splitWorkspace: TerminalWorkspaceState = {
      activeSessionId: "new-b",
      layout: {
        kind: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          kind: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { kind: "leaf", sessionId: "a" },
          second: { kind: "leaf", sessionId: "new-a" }
        },
        second: {
          kind: "split",
          direction: "horizontal",
          ratio: 0.5,
          first: { kind: "leaf", sessionId: "b" },
          second: { kind: "leaf", sessionId: "new-b" }
        }
      },
      sessions: [
        { id: "a", hostId: "host-a", label: "A", state: "connected", channelGeneration: 1 },
        { id: "b", hostId: "host-b", label: "B", state: "connected", channelGeneration: 2 },
        { id: "new-b", hostId: "host-b", label: "New B", state: "connected", channelGeneration: 3 },
        { id: "new-a", hostId: "host-a", label: "New A", state: "connected", channelGeneration: 4 },
        { id: "hidden", hostId: "host-c", label: "Hidden", state: "idle", channelGeneration: 0 }
      ]
    }

    const { container } = render(<I18nProvider><TerminalWorkspace
      workspace={splitWorkspace}
      preferences={preferences}
      confirmMultilinePaste
      onInput={vi.fn()}
      onResize={vi.fn()}
      onAck={vi.fn()}
      onController={vi.fn()}
      onSearchController={vi.fn()}
    /></I18nProvider>)

    const stack = container.querySelector(".terminal-stack")
    expect(stack).not.toBeNull()
    expect(Array.from(stack!.children).map((child) => child.getAttribute("data-testid"))).toEqual([
      "terminal-surface-a",
      "terminal-surface-new-a",
      "terminal-surface-b",
      "terminal-surface-new-b",
      "terminal-surface-hidden"
    ])
    expect(screen.getByTestId("terminal-surface-hidden")).toHaveAttribute("data-visible", "false")
  })
})

const workspace: TerminalWorkspaceState = {
  activeSessionId: "a",
  layout: { kind: "leaf", sessionId: "a" },
  sessions: [
    { id: "a", hostId: "host-a", label: "G11", state: "connected", channelGeneration: 1 },
    { id: "b", hostId: "host-b", label: "Build", state: "disconnected", channelGeneration: 2 },
    { id: "c", hostId: "host-c", label: "Logs", state: "idle", channelGeneration: 0 }
  ]
}

const preferences = {
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  scrollback: 10000 as const,
  cursorStyle: "bar" as const,
  cursorBlink: true,
  terminalBell: true
}
