import { describe, expect, it, vi } from "vitest"
import {
  createTerminalSearchAdapter,
  TerminalSearchController,
  type TerminalSearchAdapter,
  type TerminalSearchOptions
} from "./terminal-search"

type RefreshSource = {
  onWriteParsed(listener: (event: void) => void): { dispose(): void }
  onResize(listener: (event: { cols: number; rows: number }) => void): { dispose(): void }
}

const searchAddonHarness = vi.hoisted(() => {
  type ResultListener = (event: { resultIndex: number; resultCount: number }) => void
  type SearchOptions = { decorations?: unknown; [key: string]: unknown }

  class FakeSearchAddon {
    private cachedSearchTerm: string | undefined
    private lastSearchOptions: SearchOptions | undefined
    private refreshTimer: ReturnType<typeof setTimeout> | undefined
    public delayedRefreshResult: { resultIndex: number; resultCount: number } | undefined
    public readonly findNext = vi.fn((query: string, options: SearchOptions) => {
      this.cachedSearchTerm = query
      this.lastSearchOptions = options
      return true
    })
    public readonly findPrevious = vi.fn((query: string, options: SearchOptions) => {
      this.cachedSearchTerm = query
      this.lastSearchOptions = options
      return true
    })
    public readonly clearDecorations = vi.fn()
    public readonly dispose = vi.fn(() => {
      if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    })
    public readonly listeners = new Set<ResultListener>()

    public activate(terminal: RefreshSource): void {
      terminal.onWriteParsed(() => this.scheduleRefresh())
      terminal.onResize(() => this.scheduleRefresh())
    }

    public onDidChangeResults(listener: ResultListener) {
      this.listeners.add(listener)
      return { dispose: vi.fn(() => this.listeners.delete(listener)) }
    }

    public emit(event: { resultIndex: number; resultCount: number }): void {
      for (const listener of this.listeners) listener(event)
    }

    private scheduleRefresh(): void {
      if (!this.cachedSearchTerm || !this.lastSearchOptions?.decorations) return
      if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
      this.refreshTimer = setTimeout(() => {
        const query = this.cachedSearchTerm
        const options = this.lastSearchOptions
        this.cachedSearchTerm = undefined
        this.lastSearchOptions = undefined
        this.refreshTimer = undefined
        if (!query || !options) return
        this.findPrevious(query, { ...options, incremental: true })
        if (this.delayedRefreshResult) this.emit(this.delayedRefreshResult)
      }, 200)
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
    const firstTerminal = createTerminalSurface()
    const secondTerminal = createTerminalSurface()
    const first = createTerminalSearchAdapter(firstTerminal)
    const second = createTerminalSearchAdapter(secondTerminal)
    const options: TerminalSearchOptions = { caseSensitive: true, wholeWord: true, regex: false }
    const listener = vi.fn()

    expect(searchAddonHarness.addons).toHaveLength(2)
    expect(firstTerminal.loadAddon).toHaveBeenCalledTimes(1)
    expect(secondTerminal.loadAddon).toHaveBeenCalledTimes(1)

    const resultSubscription = first.onDidChangeResults(listener)
    first.findNext("needle", options, 1)
    first.findPrevious("needle", options, 2)
    first.clearDecorations()
    searchAddonHarness.addons[0].emit({ resultIndex: 1, resultCount: 3 })

    expect(searchAddonHarness.addons[0].findNext).toHaveBeenCalledWith("needle", expect.objectContaining(options))
    expect(searchAddonHarness.addons[0].findPrevious).toHaveBeenCalledWith("needle", expect.objectContaining(options))
    expect(searchAddonHarness.addons[0].clearDecorations).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()

    resultSubscription.dispose()
    first.dispose()
    first.dispose()
    second.dispose()
    second.dispose()
    expect(searchAddonHarness.addons[0].dispose).toHaveBeenCalledTimes(1)
    expect(searchAddonHarness.addons[1].dispose).toHaveBeenCalledTimes(1)
  })

  it("accepts a current output refresh and rejects a pending refresh after a new search or clear", () => {
    const terminal = createTerminalSurface()
    const adapter = createTerminalSearchAdapter(terminal)
    const listener = vi.fn()
    const subscription = adapter.onDidChangeResults(listener)
    const options: TerminalSearchOptions = { caseSensitive: false, wholeWord: false, regex: false }

    adapter.findNext("alpha", options, 1)
    terminal.emitWriteParsed()
    searchAddonHarness.addons[searchAddonHarness.addons.length - 1].emit({ resultIndex: 0, resultCount: 2 })

    expect(listener).toHaveBeenLastCalledWith({ resultIndex: 0, resultCount: 2, requestToken: 1 })

    listener.mockClear()
    terminal.emitResize()
    adapter.findNext("beta", options, 2)
    searchAddonHarness.addons[searchAddonHarness.addons.length - 1].emit({ resultIndex: 1, resultCount: 3 })
    expect(listener).not.toHaveBeenCalled()

    terminal.emitWriteParsed()
    adapter.clearDecorations()
    searchAddonHarness.addons[searchAddonHarness.addons.length - 1].emit({ resultIndex: 0, resultCount: 1 })
    expect(listener).not.toHaveBeenCalled()

    subscription.dispose()
    adapter.dispose()
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
      resultCount: 4,
      resultStatus: "matches",
      error: undefined
    })
    expect(second.getState()).toEqual({
      sessionId: "session-two",
      query: "beta",
      options: { caseSensitive: false, wholeWord: false, regex: false },
      resultIndex: 0,
      resultCount: 1,
      resultStatus: "matches",
      error: undefined
    })

    first.dispose()
    second.dispose()
  })

  it("ignores a deferred result callback from an older search request", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)

    controller.setQuery("old query")
    const oldRequestToken = adapter.findNext.mock.calls[0][2] as number
    controller.setQuery("new query")
    const newRequestToken = adapter.findNext.mock.calls[1][2] as number
    adapter.emit({ resultIndex: 0, resultCount: 9 }, oldRequestToken)
    adapter.emit({ resultIndex: 1, resultCount: 2 }, newRequestToken)

    expect(controller.getState()).toMatchObject({ query: "new query", resultIndex: 1, resultCount: 2 })
    controller.dispose()
  })

  it("accepts a delayed refresh for the active non-empty query", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)

    controller.setQuery("needle")
    const requestToken = adapter.findNext.mock.calls[0][2] as number
    adapter.emit({ resultIndex: 2, resultCount: 4 }, requestToken)

    expect(controller.getState()).toMatchObject({ query: "needle", resultIndex: 2, resultCount: 4 })
    controller.dispose()
  })

  it.each(["output", "resize"] as const)("preserves a delayed %s refresh after same-query navigation", (refreshSource) => {
    vi.useFakeTimers()
    const terminal = createFaithfulTerminalSurface()
    const adapter = createTerminalSearchAdapter(terminal)
    const addon = searchAddonHarness.addons[searchAddonHarness.addons.length - 1]
    addon.delayedRefreshResult = { resultIndex: 1, resultCount: 2 }
    const controller = new TerminalSearchController("session-one", adapter)

    try {
      controller.setQuery("needle")
      if (refreshSource === "output") terminal.emitWriteParsed()
      else terminal.emitResize()
      controller.findNext()

      vi.advanceTimersByTime(199)
      expect(controller.getState()).not.toMatchObject({ resultIndex: 1, resultCount: 2 })
      vi.advanceTimersByTime(1)

      expect(addon.findPrevious).toHaveBeenCalledWith("needle", expect.objectContaining({ incremental: true }))
      expect(controller.getState()).toMatchObject({
        query: "needle",
        resultIndex: 1,
        resultCount: 2,
        resultStatus: "matches"
      })
    } finally {
      controller.dispose()
      vi.useRealTimers()
    }
  })

  it.each([
    ["clear", (controller: TerminalSearchController) => controller.clear()],
    ["query replacement", (controller: TerminalSearchController) => controller.setQuery("new query")],
    ["options replacement", (controller: TerminalSearchController) => controller.setOptions({ caseSensitive: true })]
  ] as const)("invalidates a pending refresh after %s", (_description, invalidate) => {
    const terminal = createTerminalSurface()
    const adapter = createTerminalSearchAdapter(terminal)
    const listener = vi.fn()
    const subscription = adapter.onDidChangeResults(listener)
    const controller = new TerminalSearchController("session-one", adapter)

    try {
      controller.setQuery("old query")
      terminal.emitWriteParsed()
      invalidate(controller)
      searchAddonHarness.addons[searchAddonHarness.addons.length - 1].emit({ resultIndex: 0, resultCount: 1 })

      expect(listener).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
      subscription.dispose()
      adapter.dispose()
    }
  })

  it("contains invalid regex errors and recovers when the pattern becomes valid", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    controller.setOptions({ regex: true })
    adapter.findNext.mockImplementationOnce(() => { throw new SyntaxError("raw regex details") })

    expect(() => controller.setQuery("[")).not.toThrow()
    expect(controller.getState()).toMatchObject({
      query: "[",
      error: "invalid-pattern",
      resultIndex: -1,
      resultCount: 0
    })

    adapter.findNext.mockImplementationOnce((_query, _options, requestToken) => {
      adapter.emit({ resultIndex: 0, resultCount: 1 }, requestToken)
      return true
    })
    controller.setQuery("[a]")

    expect(controller.getState()).toMatchObject({
      query: "[a]",
      error: undefined,
      resultIndex: 0,
      resultCount: 1
    })
    controller.dispose()
  })

  it("contains non-regex adapter errors as a bounded local failure", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    adapter.findNext.mockImplementationOnce(() => { throw new Error("private adapter details") })

    expect(() => controller.setQuery("needle")).not.toThrow()
    expect(controller.getState()).toMatchObject({
      query: "needle",
      error: "search-unavailable",
      resultIndex: -1,
      resultCount: 0
    })
    expect(controller.getState()).not.toHaveProperty("rawError")
    controller.dispose()
  })

  it("represents a positive result set at the highlight limit explicitly", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    controller.setQuery("common")
    const requestToken = adapter.findNext.mock.calls[0][2] as number
    adapter.emit({ resultIndex: -1, resultCount: 1000 }, requestToken)

    expect(controller.getState()).toMatchObject({ resultStatus: "limit-reached", resultCount: 1000 })
    controller.dispose()
  })

  it("does not present a capped positive result set as an exact total", () => {
    const adapter = createFakeAdapter()
    const controller = new TerminalSearchController("session-one", adapter)
    controller.setQuery("common")
    const requestToken = adapter.findNext.mock.calls[0][2] as number
    adapter.emit({ resultIndex: 0, resultCount: 1000 }, requestToken)

    expect(controller.getState()).toMatchObject({ resultStatus: "limit-reached", resultIndex: 0, resultCount: 1000 })
    controller.dispose()
  })

  it("searches a 10,000-line scrollback through the renderer adapter without bridge or React output state", () => {
    const adapter = new RendererSearchSurface()
    const controller = new TerminalSearchController("session-one", adapter)
    const bridgeWrite = vi.fn()
    for (let index = 0; index < 10_000; index += 1) adapter.write(`line-${index + 1}`)

    controller.setQuery("line-10000")
    controller.findNext()

    expect(adapter.lineCount).toBe(10_000)
    expect(adapter.searches).toEqual(["line-10000", "line-10000"])
    expect(controller.getState()).toMatchObject({ resultIndex: 0, resultCount: 1 })
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
    const requestToken = adapter.findNext.mock.calls[0][2] as number
    controller.clear()
    expect(adapter.clearDecorations).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toMatchObject({ query: "", resultIndex: undefined, resultCount: undefined })
    adapter.emit({ resultIndex: 0, resultCount: 1 }, requestToken)
    expect(controller.getState()).toMatchObject({ query: "", resultIndex: undefined, resultCount: undefined })

    controller.dispose()
    adapter.emit({ resultIndex: 0, resultCount: 1 }, requestToken)
    expect(stateChanges).not.toHaveBeenCalledWith(expect.objectContaining({ resultCount: 1 }))
    subscription.dispose()
  })
})

function createTerminalSurface() {
  const listeners = {
    writeParsed: new Set<(event: void) => void>(),
    resize: new Set<(event: { cols: number; rows: number }) => void>()
  }
  return {
    loadAddon: vi.fn(),
    onWriteParsed(listener: (event: void) => void) {
      listeners.writeParsed.add(listener)
      return { dispose: vi.fn(() => listeners.writeParsed.delete(listener)) }
    },
    onResize(listener: (event: { cols: number; rows: number }) => void) {
      listeners.resize.add(listener)
      return { dispose: vi.fn(() => listeners.resize.delete(listener)) }
    },
    emitWriteParsed(): void {
      for (const listener of listeners.writeParsed) listener(undefined)
    },
    emitResize(): void {
      for (const listener of listeners.resize) listener({ cols: 120, rows: 40 })
    }
  }
}

function createFaithfulTerminalSurface() {
  const terminal = createTerminalSurface()
  terminal.loadAddon.mockImplementation((addon: { activate?: (terminal: RefreshSource) => void }) => {
    addon.activate?.(terminal)
  })
  return terminal
}

class RendererSearchSurface implements TerminalSearchAdapter {
  public readonly searches: string[] = []
  private readonly lines: string[] = []
  private listener?: (event: { resultIndex: number; resultCount: number; requestToken: number }) => void

  public get lineCount(): number {
    return this.lines.length
  }

  public write(line: string): void {
    this.lines.push(line)
  }

  public findNext(query: string, _options: TerminalSearchOptions, requestToken: number): boolean {
    this.searches.push(query)
    const resultCount = this.lines.filter((line) => line.includes(query)).length
    this.listener?.({ resultIndex: resultCount > 0 ? 0 : -1, resultCount, requestToken })
    return resultCount > 0
  }

  public findPrevious(query: string, options: TerminalSearchOptions, requestToken: number): boolean {
    return this.findNext(query, options, requestToken)
  }

  public clearDecorations(): void {}

  public onDidChangeResults(listener: (event: { resultIndex: number; resultCount: number; requestToken: number }) => void): { dispose(): void } {
    this.listener = listener
    return { dispose: () => { if (this.listener === listener) this.listener = undefined } }
  }

  public dispose(): void {
    this.listener = undefined
  }
}

function createFakeAdapter(result?: { resultIndex: number; resultCount: number }) {
  type ResultEvent = { resultIndex: number; resultCount: number; requestToken: number }
  const listeners = new Set<(event: ResultEvent) => void>()
  const emit = (event: { resultIndex: number; resultCount: number }, requestToken: number): void => {
    for (const listener of listeners) listener({ ...event, requestToken })
  }
  const adapter = {
    findNext: vi.fn((_query: string, _options: TerminalSearchOptions, requestToken: number) => {
      if (result) emit(result, requestToken)
      return true
    }),
    findPrevious: vi.fn((_query: string, _options: TerminalSearchOptions, requestToken: number) => {
      if (result) emit(result, requestToken)
      return true
    }),
    clearDecorations: vi.fn(),
    onDidChangeResults(listener: (event: ResultEvent) => void) {
      listeners.add(listener)
      return { dispose: vi.fn(() => listeners.delete(listener)) }
    },
    dispose: vi.fn(),
    emit
  }
  return adapter
}
