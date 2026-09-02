import { SearchAddon, type ISearchOptions } from "@xterm/addon-search"
import type { Terminal } from "@xterm/xterm"

export interface TerminalSearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export interface TerminalSearchResult {
  resultIndex: number
  resultCount: number
}

export interface TerminalSearchState {
  sessionId: string
  query: string
  options: TerminalSearchOptions
  resultIndex?: number
  resultCount?: number
}

export interface TerminalSearchAdapter {
  findNext(query: string, options: TerminalSearchOptions): boolean
  findPrevious(query: string, options: TerminalSearchOptions): boolean
  clearDecorations(): void
  onDidChangeResults(listener: (event: TerminalSearchResult) => void): { dispose(): void }
  dispose(): void
}

export class XtermSearchAdapter implements TerminalSearchAdapter {
  private disposed = false
  private readonly addon: SearchAddon

  public constructor(terminal: Pick<Terminal, "loadAddon">) {
    this.addon = new SearchAddon()
    terminal.loadAddon(this.addon)
  }

  public findNext(query: string, options: TerminalSearchOptions): boolean {
    return this.disposed ? false : this.addon.findNext(query, toXtermSearchOptions(options))
  }

  public findPrevious(query: string, options: TerminalSearchOptions): boolean {
    return this.disposed ? false : this.addon.findPrevious(query, toXtermSearchOptions(options))
  }

  public clearDecorations(): void {
    if (!this.disposed) this.addon.clearDecorations()
  }

  public onDidChangeResults(listener: (event: TerminalSearchResult) => void): { dispose(): void } {
    if (this.disposed) return { dispose: () => undefined }
    return this.addon.onDidChangeResults(listener)
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.addon.dispose()
  }
}

export function createTerminalSearchAdapter(terminal: Pick<Terminal, "loadAddon">): TerminalSearchAdapter {
  return new XtermSearchAdapter(terminal)
}

export class TerminalSearchController {
  private readonly stateListeners = new Set<(state: TerminalSearchState) => void>()
  private readonly resultSubscription: { dispose(): void }
  private state: TerminalSearchState
  private requestToken = 0
  private activeRequestToken: number | undefined
  private disposed = false

  public constructor(sessionId: string, private readonly adapter: TerminalSearchAdapter) {
    this.state = {
      sessionId,
      query: "",
      options: defaultSearchOptions()
    }
    // SearchAddon emits this event synchronously from findNext/findPrevious.
    // The active token rejects delayed callbacks from a request that has ended.
    this.resultSubscription = adapter.onDidChangeResults((event) => {
      if (this.disposed || this.activeRequestToken !== this.requestToken || this.state.query.length === 0) return
      this.updateState({ resultIndex: event.resultIndex, resultCount: event.resultCount })
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
    this.updateState({ query, resultIndex: undefined, resultCount: undefined })
    this.search("next")
  }

  public setOptions(options: Partial<TerminalSearchOptions>): void {
    if (this.disposed) return
    const nextOptions = { ...this.state.options, ...options }
    if (sameOptions(this.state.options, nextOptions)) return
    this.updateState({ options: nextOptions, resultIndex: undefined, resultCount: undefined })
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
    this.activeRequestToken = undefined
    this.adapter.clearDecorations()
    this.updateState({ query: "", resultIndex: undefined, resultCount: undefined })
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
    this.activeRequestToken = undefined
    this.resultSubscription.dispose()
    this.adapter.dispose()
    this.stateListeners.clear()
  }

  private search(direction: "next" | "previous"): void {
    const query = this.state.query
    const token = ++this.requestToken
    if (query.length === 0) {
      this.activeRequestToken = undefined
      this.adapter.clearDecorations()
      return
    }

    this.activeRequestToken = token
    let found: boolean
    try {
      found = direction === "next"
        ? this.adapter.findNext(query, this.state.options)
        : this.adapter.findPrevious(query, this.state.options)
    } finally {
      if (this.activeRequestToken === token) this.activeRequestToken = undefined
    }
    if (!found && !this.disposed && token === this.requestToken) {
      this.updateState({ resultIndex: -1, resultCount: 0 })
    }
  }

  private updateState(update: Partial<TerminalSearchState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...update, options: update.options ? { ...update.options } : this.state.options }
    const snapshot = this.getState()
    for (const listener of this.stateListeners) listener(snapshot)
  }
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
