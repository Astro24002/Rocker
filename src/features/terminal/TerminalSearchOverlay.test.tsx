import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { TerminalSearchController } from "./terminal-search"
import { TerminalSearchOverlay } from "./TerminalSearchOverlay"

describe("TerminalSearchOverlay", () => {
  it("focuses the query and updates the per-session query and option toggles", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} /></I18nProvider>)

    const input = screen.getByRole("searchbox", { name: "Search terminal output" })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: "deploy" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Match whole word" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Use regular expression" }))

    expect(controller.getState()).toMatchObject({
      query: "deploy",
      options: { caseSensitive: true, wholeWord: true, regex: true }
    })
    controller.dispose()
  })

  it("moves next and previous with Enter and Shift+Enter", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })
    fireEvent.change(input, { target: { value: "needle" } })
    adapter.findNext.mockClear()
    adapter.findPrevious.mockClear()

    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })

    expect(adapter.findNext).toHaveBeenCalledTimes(1)
    expect(adapter.findPrevious).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it("shows result counts and an explicit no-results state", () => {
    const adapter = createAdapter({ resultIndex: 1, resultCount: 3 })
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })
    fireEvent.change(input, { target: { value: "needle" } })
    expect(screen.getByText("2 / 3")).toBeInTheDocument()

    adapter.setNextResult({ resultIndex: -1, resultCount: 0 }, false)
    act(() => controller.findNext())
    expect(screen.getByText("No results")).toBeInTheDocument()
    controller.dispose()
  })

  it("closes on Escape, returns control to the caller, and exposes accessible actions", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    const onClose = vi.fn()
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={onClose} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })

    expect(screen.getByRole("button", { name: "Previous match" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next match" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Escape" })

    expect(onClose).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it("does not carry a query across Session controller changes", () => {
    const first = new TerminalSearchController("session-one", createAdapter())
    const second = new TerminalSearchController("session-two", createAdapter())
    first.setQuery("first session")
    const { rerender } = render(<I18nProvider><TerminalSearchOverlay controller={first} open onClose={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveValue("first session")

    rerender(<I18nProvider><TerminalSearchOverlay controller={second} open onClose={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveValue("")
    first.dispose()
    second.dispose()
  })
})

function createAdapter(initialResult?: { resultIndex: number; resultCount: number }) {
  const listeners = new Set<(event: { resultIndex: number; resultCount: number }) => void>()
  let nextResult = initialResult
  let nextFound = true
  const emit = (event: { resultIndex: number; resultCount: number }): void => {
    for (const listener of listeners) listener(event)
  }
  const adapter = {
    findNext: vi.fn(() => {
      if (nextResult) emit(nextResult)
      return nextFound
    }),
    findPrevious: vi.fn(() => {
      if (nextResult) emit(nextResult)
      return nextFound
    }),
    clearDecorations: vi.fn(),
    onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number }) => void) {
      listeners.add(listener)
      return { dispose: vi.fn(() => listeners.delete(listener)) }
    },
    dispose: vi.fn(),
    emit,
    setNextResult(result: { resultIndex: number; resultCount: number } | undefined, found = true): void {
      nextResult = result
      nextFound = found
    }
  }
  return adapter
}
