import { describe, expect, it, vi } from "vitest"
import {
  createTerminalSearchAdapter,
  TerminalSearchController,
  type TerminalSearchAdapter,
  type TerminalSearchOptions
} from "./terminal-search"

const searchAddonHarness = vi.hoisted(() => {
  type ResultListener = (event: { resultIndex: number; resultCount: number }) => void

  class FakeSearchAddon {
    public readonly findNext = vi.fn(() => true)
    public readonly findPrevious = vi.fn(() => true)
    public readonly clearDecorations = vi.fn()
    public readonly dispose = vi.fn()
    public readonly listeners = new Set<ResultListener>()

    public onDidChangeResults(listener: ResultListener) {
      this.listeners.add(listener)
      return { dispose: vi.fn(() => this.listeners.delete(listener)) }
    }

    public emit(event: { resultIndex: number; resultCount: number }): void {
      for (const listener of this.listeners) listener(event)
    }
  }

  const addons: FakeSearchAddon[] = []
  class SearchAddon extends FakeSearchAddon {
    public constructor() {
      super()
      addons.push(this)
    }
  }

  return { addons, SearchAddon }
})

vi.mock("@xterm/addon-search", () => ({ SearchAddon: searchAddonHarness.SearchAddon }))

describe("terminal search", () => {
  it("loads one SearchAddon per xterm and delegates next, previous, clear, results, and disposal", () => {
    const firstTerminal = { loadAddon: vi.fn() }
    const secondTerminal = { loadAddon: vi.fn() }
    const first = createTerminalSearchAdapter(firstTerminal)
    const second = createTerminalSearchAdapter(secondTerminal)
    const options: TerminalSearchOptions = { caseSensitive: true, wholeWord: true, regex: false }
    const listener = vi.fn()

    expect(searchAddonHarness.addons).toHaveLength(2)
    expect(firstTerminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(secondTerminal.loadAddon).toHaveBeenCalledTimes(1)

    first.findNext("needle", options)
    first.findPrevious("needle", options)
    first.clearDecorations()
    const resultSubscription = first.onDidChangeResults(listener)
    searchAddonHarness.addons[0].emit({ resultIndex: 1, resultCount: 3 })

    expect(searchAddonHarness.addons[0].findNext).toHaveBeenCalledWith("needle", expect.objectContaining(options))
    expect(searchAddonHarness.addons[0].findPrevious).toHaveBeenCalledWith("needle", expect.objectContaining(options))
    expect(searchAddonHarness.addons[0].clearDecorations).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ resultIndex: 1, resultCount: 3 })

    resultSubscription.dispose()
    first.dispose()
    first.dispose()
    second.dispose()
    second.dispose()
    expect(searchAddonHarness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(searchAddonHarness.addons[1].dispose).toHaveBeenCalledTimes(1)
  })

  it("keeps query, options, result position, and no-results state per Session", () => {
    const firstAdapter = createFakeAdapter({ resultIndex: 1, resultCount: 4 })
    const secondAdapter = createFakeAdapter({ resultIndex: 0, resultCount: 1 })
    const first = new TerminalSearchController("session-one", firstAdapter)
    const second = new TerminalSearchController("session-two", secondAdapter)

    first.setQuery("alpha")
    first.setOptions({ caseSensitive: true, wholeWord: true, regex: false })
    second.setQuery("beta")

    expect(first.getState()).toEqual({
      sessionId: "session-one",
      query: "alpha",
      options: { caseSensitive: true, wholeWord: true, regex: false },
      resultIndex: 1,
      resultCount: 4
    })
    expect(second.getState()).toEqual({
      sessionId: "session-two",
      query: "beta",
      options: { caseSensitive: false, wholeWord: false, regex: false },
      resultIndex: 0,
      resultCount: 1
    })

    first.dispose()
    second.dispose()
  })

  it("ignores a deferred result callback from an older search request", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)

    controller.setQuery("old query")
    controller.setQuery("new query")
    adapter.emit({ resultIndex: 0, resultCount: 9 })

    expect(controller.getState()).toMatchObject({ query: "new query", resultIndex: undefined, resultCount: undefined })
    controller.dispose()
  })

  it("searches a 10,000-line scrollback through the renderer adapter without bridge or React output state", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    const bridgeWrite = vi.fn()
    const rendererScrollback = Array.from({ length: 10_000 }, (_, index) => `line-${index + 1}`)

    controller.setQuery("line-10000")
    controller.findNext()

    expect(rendererScrollback).toHaveLength(10_000)
    expect(adapter.findNext).toHaveBeenCalledWith("line-10000", expect.any(Object))
    expect(bridgeWrite).not.toHaveBeenCalled()
    expect(controller).not.toHaveProperty("output")
    expect(controller).not.toHaveProperty("scrollback")

    controller.dispose()
  })

  it("clears results and ignores result callbacks after disposal", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    const stateChanges = vi.fn()
    const subscription = controller.onStateChange(stateChanges)

    controller.setQuery("alpha")
    controller.clear()
    expect(adapter.clearDecorations).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ query: "", resultIndex: undefined, resultCount: undefined })

    controller.dispose()
    adapter.emit({ resultIndex: 0, resultCount: 1 })
    expect(stateChanges).not.toHaveBeenCalledWith(expect.objectContaining({ resultCount: 1 }))
    subscription.dispose()
  })
})

function createFakeAdapter(result?: { resultIndex: number; resultCount: number }): TerminalSearchAdapter & { emit(event: { resultIndex: number; resultCount: number }): void } {
  const listeners = new Set<(event: { resultIndex: number; resultCount: number }) => void>()
  const emit = (event: { resultIndex: number; resultCount: number }): void => {
    for (const listener of listeners) listener(event)
  }
  const adapter = {
    findNext: vi.fn(() => {
      if (result) emit(result)
      return true
    }),
    findPrevious: vi.fn(() => {
      if (result) emit(result)
      return true
    }),
    clearDecorations: vi.fn(),
    onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number }) => void) {
      listeners.add(listener)
      return { dispose: vi.fn(() => listeners.delete(listener)) }
    },
    dispose: vi.fn(),
    emit
  }
  return adapter
}
