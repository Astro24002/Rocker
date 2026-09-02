import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { TerminalSearchController } from "./terminal-search"
import { TerminalSearchOverlay } from "./TerminalSearchOverlay"

describe("TerminalSearchOverlay", () => {
  it("focuses the query and updates the per-session query and option toggles", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)

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
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)
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
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })
    fireEvent.change(input, { target: { value: "needle" } })
    expect(screen.getByText("2 / 3")).toBeInTheDocument()

    adapter.setNextResult({ resultIndex: -1, resultCount: 0 }, false)
    act(() => controller.findNext())
    expect(screen.getByText("No results")).toBeInTheDocument()
    controller.dispose()
  })

  it("closes on Escape from the query input, returns focus to the terminal, and exposes accessible actions", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    const onClose = vi.fn()
    const terminal = document.createElement("button")
    terminal.type = "button"
    terminal.textContent = "Terminal"
    document.body.append(terminal)
    const onRestoreFocus = vi.fn(() => terminal.focus())
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={onClose} onRestoreFocus={onRestoreFocus} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })

    expect(screen.getByRole("button", { name: "Previous match" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next match" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: "Escape" })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRestoreFocus).toHaveBeenCalledTimes(1)
    expect(terminal).toHaveFocus()
    terminal.remove()
    controller.dispose()
  })

  it.each([
    ["checkbox", "Match case"],
    ["button", "Next match"]
  ])("closes on Escape from a descendant %s", (_controlType, controlName) => {
    const adapter = createAdapter({ resultIndex: 0, resultCount: 1 })
    const controller = new TerminalSearchController("session-one", adapter)
    controller.setQuery("needle")
    const onClose = vi.fn()
    const terminal = document.createElement("button")
    terminal.type = "button"
    document.body.append(terminal)
    const onRestoreFocus = vi.fn(() => terminal.focus())
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={onClose} onRestoreFocus={onRestoreFocus} /></I18nProvider>)

    const control = controlName === "Match case"
      ? screen.getByRole("checkbox", { name: controlName })
      : screen.getByRole("button", { name: controlName })
    fireEvent.keyDown(control, { key: "Escape" })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRestoreFocus).toHaveBeenCalledTimes(1)
    expect(terminal).toHaveFocus()
    terminal.remove()
    controller.dispose()
  })

  it("shows a bounded invalid-pattern state and recovers after a valid regex", () => {
    const adapter = createAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)
    const input = screen.getByRole("searchbox", { name: "Search terminal output" })
    fireEvent.click(screen.getByRole("checkbox", { name: "Use regular expression" }))
    adapter.throwNext(new SyntaxError("raw exception details"))

    fireEvent.change(input, { target: { value: "[" } })
    expect(screen.getByText("Invalid regular expression")).toBeInTheDocument()
    expect(screen.queryByText("raw exception details")).not.toBeInTheDocument()

    adapter.setNextResult({ resultIndex: 0, resultCount: 1 })
    fireEvent.change(input, { target: { value: "[a]" } })
    expect(screen.queryByText("Invalid regular expression")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 1")).toBeInTheDocument()
    controller.dispose()
  })

  it("shows an explicit capped-match state", () => {
    const adapter = createAdapter({ resultIndex: -1, resultCount: 1000 })
    const controller = new TerminalSearchController("session-one", adapter)
    render(<I18nProvider><TerminalSearchOverlay controller={controller} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)

    fireEvent.change(screen.getByRole("searchbox", { name: "Search terminal output" }), { target: { value: "common" } })

    expect(screen.getByText("More than 1,000 matches")).toBeInTheDocument()
    controller.dispose()
  })

  it("does not carry a query across Session controller changes", () => {
    const first = new TerminalSearchController("session-one", createAdapter())
    const second = new TerminalSearchController("session-two", createAdapter())
    first.setQuery("first session")
    const { rerender } = render(<I18nProvider><TerminalSearchOverlay controller={first} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveValue("first session")

    rerender(<I18nProvider><TerminalSearchOverlay controller={second} open onClose={vi.fn()} onRestoreFocus={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole("searchbox", { name: "Search terminal output" })).toHaveValue("")
    first.dispose()
    second.dispose()
  })
})

function createAdapter(initialResult?: { resultIndex: number; resultCount: number }) {
  const listeners = new Set<(event: { resultIndex: number; resultCount: number; requestToken: number }) => void>()
  let nextResult = initialResult
  let nextFound = true
  let nextError: Error | undefined
  let currentRequestToken = 0
  const emit = (event: { resultIndex: number; resultCount: number }, requestToken = currentRequestToken): void => {
    for (const listener of listeners) listener({ ...event, requestToken })
  }
  const adapter = {
    findNext: vi.fn((_query: string, _options: unknown, requestToken: number) => {
      currentRequestToken = requestToken
      if (nextError) {
        const error = nextError
        nextError = undefined
        throw error
      }
      if (nextResult) emit(nextResult)
      return nextFound
    }),
    findPrevious: vi.fn((_query: string, _options: unknown, requestToken: number) => {
      currentRequestToken = requestToken
      if (nextResult) emit(nextResult)
      return nextFound
    }),
    clearDecorations: vi.fn(),
    onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number; requestToken: number }) => void) {
      listeners.add(listener)
      return { dispose: vi.fn(() => listeners.delete(listener)) }
    },
    dispose: vi.fn(),
    emit,
    setNextResult(result: { resultIndex: number; resultCount: number } | undefined, found = true): void {
      nextResult = result
      nextFound = found
    },
    throwNext(error: Error): void {
      nextError = error
    }
  }
  return adapter
}
