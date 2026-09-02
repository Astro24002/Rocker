import { SearchAddon, type ISearchOptions } from "@xterm/addon-search"
import type { Terminal } from "@xterm/xterm"

export interface TerminalSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export const TERMINAL_SEARCH_HIGHLIGHT_LIMIT = 1000

export type TerminalSearchResultStatus = "matches" | "no-results" | "limit-reached"
export type TerminalSearchError = "invalid-pattern" | "search-unavailable"

export interface TerminalSearchResult {
  resultIndex: number
  resultCount: number
  requestToken: number
}

export interface TerminalSearchState {
  sessionId: string
  query: string
  options: TerminalSearchOptions
  resultIndex?: number
  resultCount?: number
  resultStatus?: TerminalSearchResultStatus
  error?: TerminalSearchError
}

export interface TerminalSearchAdapter {
  findNext(query: string, options: TerminalSearchOptions, requestToken: number): boolean
  findPrevious(query: string, options: TerminalSearchOptions, requestToken: number): boolean
  clearDecorations(): void
  onDidChangeResults(listener: (event: TerminalSearchResult) => void): { dispose(): void }
  dispose(): void
}

export class XtermSearchAdapter implements TerminalSearchAdapter {
  private disposed = false
  private readonly addon: SearchAddon
  private readonly refreshSubscriptions: Array<{ dispose(): void }> = []
  private currentRequestToken: number | undefined
  private pendingRefreshToken: number | undefined
  private inFlightRequestToken: number | undefined

  public constructor(terminal: Pick<Terminal, "loadAddon" | "onWriteParsed" | "onResize">) {
    this.addon = new SearchAddon({ highlightLimit: TERMINAL_SEARCH_HIGHLIGHT_LIMIT })
    terminal.loadAddon(this.addon)
    this.refreshSubscriptions.push(
      terminal.onWriteParsed(() => this.markRefreshPending()),
      terminal.onResize(() => this.markRefreshPending())
    )
  }

  public findNext(query: string, options: TerminalSearchOptions, requestToken: number): boolean {
    return this.runSearch(requestToken, () => this.addon.findNext(query, toXtermSearchOptions(options)))
  }

  public findPrevious(query: string, options: TerminalSearchOptions, requestToken: number): boolean {
    return this.runSearch(requestToken, () => this.addon.findPrevious(query, toXtermSearchOptions(options)))
  }

  public clearDecorations(): void {
    this.currentRequestToken = undefined
    this.pendingRefreshToken = undefined
    if (!this.disposed) this.addon.clearDecorations()
  }

  public onDidChangeResults(listener: (event: TerminalSearchResult) => void): { dispose(): void } {
    if (this.disposed) return { dispose: () => undefined }
    return this.addon.onDidChangeResults((event) => {
      const requestToken = this.inFlightRequestToken ?? this.pendingRefreshToken
      if (requestToken === undefined) return
      if (this.inFlightRequestToken === undefined) this.pendingRefreshToken = undefined
      listener({ ...event, requestToken })
    })
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const subscription of this.refreshSubscriptions) subscription.dispose()
    this.refreshSubscriptions.length = 0
    this.currentRequestToken = undefined
    this.pendingRefreshToken = undefined
    this.inFlightRequestToken = undefined
    this.addon.dispose()
  }

  private runSearch(requestToken: number, search: () => boolean): boolean {
    if (this.disposed) return false
    this.currentRequestToken = requestToken
    this.pendingRefreshToken = undefined
    this.inFlightRequestToken = requestToken
    try {
      return search()
    } finally {
      if (this.inFlightRequestToken === requestToken) this.inFlightRequestToken = undefined
    }
  }

  private markRefreshPending(): void {
    if (!this.disposed && this.currentRequestToken !== undefined) this.pendingRefreshToken = this.currentRequestToken
  }
}

export function createTerminalSearchAdapter(terminal: Pick<Terminal, "loadAddon" | "onWriteParsed" | "onResize">): TerminalSearchAdapter {
  return new XtermSearchAdapter(terminal)
}

export class TerminalSearchController {
  private readonly stateListeners = new Set<(state: TerminalSearchState) => void>()
  private readonly resultSubscription: { dispose(): void }
  private state: TerminalSearchState
  private requestToken = 0
  private disposed = false

  public constructor(sessionId: string, private readonly adapter: TerminalSearchAdapter) {
    this.state = {
      sessionId,
      query: "",
      options: defaultSearchOptions()
    }
    this.resultSubscription = adapter.onDidChangeResults((event) => {
      if (this.disposed || this.state.query.length === 0 || event.requestToken !== this.requestToken) return
      this.updateState({
        resultIndex: event.resultIndex,
        resultCount: event.resultCount,
        resultStatus: resultStatusFor(event),
        error: undefined
      })
    })
  }

  public getState(): TerminalSearchState {
    return {
      ...this.state,
      options: { ...this.state.options }
    }
  }

  public setQuery(query: string): void {
    if (this.disposed || this.state.query === query) return
    this.updateState({ query, resultIndex: undefined, resultCount: undefined, resultStatus: undefined, error: undefined })
    this.search("next")
  }

  public setOptions(options: Partial<TerminalSearchOptions>): void {
    if (this.disposed) return
    const nextOptions = { ...this.state.options, ...options }
    if (sameOptions(this.state.options, nextOptions)) return
    this.updateState({ options: nextOptions, resultIndex: undefined, resultCount: undefined, resultStatus: undefined, error: undefined })
    this.search("next")
  }

  public findNext(): void {
    if (!this.disposed) this.search("next")
  }

  public findPrevious(): void {
    if (!this.disposed) this.search("previous")
  }

  public clear(): void {
    if (this.disposed) return
    this.requestToken += 1
    this.clearAdapterDecorations()
    this.updateState({ query: "", resultIndex: undefined, resultCount: undefined, resultStatus: undefined, error: undefined })
  }

  public onStateChange(listener: (state: TerminalSearchState) => void): { dispose(): void } {
    if (this.disposed) return { dispose: () => undefined }
    this.stateListeners.add(listener)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.stateListeners.delete(listener)
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.requestToken += 1
    this.resultSubscription.dispose()
    this.adapter.dispose()
    this.stateListeners.clear()
  }

  private search(direction: "next" | "previous"): void {
    const query = this.state.query
    const token = ++this.requestToken
    if (query.length === 0) {
      this.clearAdapterDecorations()
      return
    }

    if (this.state.error !== undefined) this.updateState({ error: undefined })
    let found: boolean
    try {
      found = direction === "next"
        ? this.adapter.findNext(query, this.state.options, token)
        : this.adapter.findPrevious(query, this.state.options, token)
    } catch (error) {
      if (!this.disposed && token === this.requestToken) {
        this.clearAdapterDecorations()
        this.updateState({
          resultIndex: -1,
          resultCount: 0,
          resultStatus: "no-results",
          error: searchErrorFor(error, this.state.options)
        })
      }
      return
    }
    if (!found && !this.disposed && token === this.requestToken) {
      this.updateState({ resultIndex: -1, resultCount: 0, resultStatus: "no-results", error: undefined })
    }
  }

  private updateState(update: Partial<TerminalSearchState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...update, options: update.options ? { ...update.options } : this.state.options }
    const snapshot = this.getState()
    for (const listener of this.stateListeners) listener(snapshot)
  }

  private clearAdapterDecorations(): void {
    try {
      this.adapter.clearDecorations()
    } catch {
      // Search cleanup is local; adapter cleanup failures must not escape the renderer.
    }
  }
}

function resultStatusFor(result: TerminalSearchResult): TerminalSearchResultStatus {
  if (result.resultCount === 0) return "no-results"
  if (result.resultIndex < 0 && result.resultCount >= TERMINAL_SEARCH_HIGHLIGHT_LIMIT) return "limit-reached"
  return "matches"
}

function searchErrorFor(error: unknown, options: TerminalSearchOptions): TerminalSearchError {
  return options.regex && isSyntaxError(error) ? "invalid-pattern" : "search-unavailable"
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError || (typeof error === "object" && error !== null && "name" in error && error.name === "SyntaxError")
}

function defaultSearchOptions(): TerminalSearchOptions {
  return { caseSensitive: false, wholeWord: false, regex: false }
}

function sameOptions(left: TerminalSearchOptions, right: TerminalSearchOptions): boolean {
  return left.caseSensitive === right.caseSensitive && left.wholeWord === right.wholeWord && left.regex === right.regex
}

function toXtermSearchOptions(options: TerminalSearchOptions): ISearchOptions {
  return {
    ...options,
    decorations: {
      matchBackground: "#38533a",
      matchBorder: "#5f9950",
      matchOverviewRuler: "#5f9950",
      activeMatchBackground: "#86de67",
      activeMatchBorder: "#d8ddcf",
      activeMatchColorOverviewRuler: "#d8ddcf"
    }
  }
}
