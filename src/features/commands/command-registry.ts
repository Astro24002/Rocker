import type { TerminalSessionState } from "../../../electron/ssh/types"
import type { TranslationKey } from "../../i18n/en"
import type { WorkspaceSession } from "../terminal/session-state"

export type CommandId =
  | "terminal.search"
  | "terminal.copy"
  | "terminal.paste"
  | "terminal.selectAll"
  | "terminal.clear"
  | "terminal.focus"
  | "terminal.font.increase"
  | "terminal.font.decrease"
  | "terminal.font.reset"
  | "session.reconnect"
  | "session.rename"
  | "session.duplicate"
  | "session.duplicate-window"
  | "session.split-horizontal"
  | "session.close"
  | "navigation.hosts"
  | "navigation.history"
  | "navigation.ports"
  | "navigation.settings"
  | "navigation.sftp"
  | "navigation.snippets"
  | "navigation.local-terminal"
  | "palette.open"

export type CommandCategory = "terminal" | "session" | "navigation" | "palette"
export type NavigationCommand = "hosts" | "history" | "ports" | "settings" | "sftp" | "snippets" | "local-terminal" | "terminal"

export interface TerminalCommandSurface {
  hasSelection(): boolean
  copy(): void | Promise<void>
  paste(): void | Promise<void>
  selectAll(): void
  clear(): void
  focus(): void
}

export interface CommandSelection {
  hasSelection: boolean
}

export interface CommandClipboard {
  canPaste: boolean
}

export interface RecentSessionCommand {
  id: string
  label: string
  session: WorkspaceSession
  lastFocusedAt: number
}

export interface CommandActions {
  terminal: {
    search(): void | Promise<void>
    copy(): void | Promise<void>
    paste(): void | Promise<void>
    selectAll(): void | Promise<void>
    clear(): void | Promise<void>
    focus(): void | Promise<void>
    increaseFont(): void | Promise<void>
    decreaseFont(): void | Promise<void>
    resetFont(): void | Promise<void>
  }
  session: {
    activate(session: WorkspaceSession): void | Promise<void>
    reconnect(session: WorkspaceSession): void | Promise<void>
    rename(session: WorkspaceSession): void | Promise<void>
    duplicate(session: WorkspaceSession): void | Promise<void>
    duplicateWindow(session: WorkspaceSession): void | Promise<void>
    splitHorizontal(session: WorkspaceSession): void | Promise<void>
    close(session: WorkspaceSession): void | Promise<void>
  }
  navigation: {
    navigate(destination: NavigationCommand): void | Promise<void>
  }
  palette?: {
    open(): void | Promise<void>
  }
}

export interface CommandContext {
  activeSession?: WorkspaceSession
  connectionState?: TerminalSessionState
  terminalBufferAvailable?: boolean
  terminal?: TerminalCommandSurface
  selection?: CommandSelection
  clipboard?: CommandClipboard
  activeNavigation: NavigationCommand
  settingsAvailable: boolean
  settingsPersistenceAvailable?: boolean
  recentSessions: readonly RecentSessionCommand[]
  actions: CommandActions
}

export interface CommandDefinition {
  id: CommandId
  label: string
  labelKey: TranslationKey
  category: CommandCategory
  shortcut?: string
  keywords?: readonly string[]
  isEnabled(context: CommandContext): boolean
  execute(context: CommandContext): void | Promise<void>
}

export interface CommandGroup {
  category: CommandCategory
  commands: CommandDefinition[]
}

export type CommandExecutionResult =
  | { status: "executed" }
  | { status: "disabled" }
  | { status: "failed" }

const categoryOrder: readonly CommandCategory[] = ["terminal", "session", "navigation", "palette"]

export const commandRegistry: readonly CommandDefinition[] = [
  {
    id: "terminal.search",
    label: "Search terminal",
    labelKey: "terminal.search",
    category: "terminal",
    shortcut: "Ctrl/Cmd+Shift+F",
    keywords: ["find", "terminal output"],
    isEnabled: hasTerminalBuffer,
    execute: ({ actions }) => actions.terminal.search()
  },
  {
    id: "terminal.copy",
    label: "Copy",
    labelKey: "commands.copy",
    category: "terminal",
    keywords: ["clipboard", "selection"],
    isEnabled: (context) => hasTerminalBuffer(context) && hasSelection(context),
    execute: ({ actions }) => actions.terminal.copy()
  },
  {
    id: "terminal.paste",
    label: "Paste",
    labelKey: "commands.paste",
    category: "terminal",
    keywords: ["clipboard"],
    isEnabled: (context) => hasTerminalBuffer(context) && connectionState(context) === "connected" && canPaste(context),
    execute: ({ actions }) => actions.terminal.paste()
  },
  {
    id: "terminal.selectAll",
    label: "Select all",
    labelKey: "commands.selectAll",
    category: "terminal",
    keywords: ["selection"],
    isEnabled: hasTerminalBuffer,
    execute: ({ actions }) => actions.terminal.selectAll()
  },
  {
    id: "terminal.clear",
    label: "Clear terminal",
    labelKey: "commands.clear",
    category: "terminal",
    keywords: ["clean", "buffer"],
    isEnabled: hasTerminalBuffer,
    execute: ({ actions }) => actions.terminal.clear()
  },
  {
    id: "terminal.focus",
    label: "Focus terminal",
    labelKey: "commands.focus",
    category: "terminal",
    keywords: ["terminal input"],
    isEnabled: hasTerminalBuffer,
    execute: ({ actions }) => actions.terminal.focus()
  },
  {
    id: "terminal.font.increase",
    label: "Increase font size",
    labelKey: "commands.fontIncrease",
    category: "terminal",
    keywords: ["font", "zoom in", "font increase"],
    isEnabled: (context) => hasTerminalBuffer(context) && context.settingsAvailable,
    execute: ({ actions }) => actions.terminal.increaseFont()
  },
  {
    id: "terminal.font.decrease",
    label: "Decrease font size",
    labelKey: "commands.fontDecrease",
    category: "terminal",
    keywords: ["font", "zoom out", "font decrease"],
    isEnabled: (context) => hasTerminalBuffer(context) && context.settingsAvailable,
    execute: ({ actions }) => actions.terminal.decreaseFont()
  },
  {
    id: "terminal.font.reset",
    label: "Reset font size",
    labelKey: "commands.fontReset",
    category: "terminal",
    keywords: ["font", "zoom reset", "font reset"],
    isEnabled: (context) => hasTerminalBuffer(context) && context.settingsAvailable,
    execute: ({ actions }) => actions.terminal.resetFont()
  },
  {
    id: "session.reconnect",
    label: "Reconnect",
    labelKey: "commands.reconnect",
    category: "session",
    keywords: ["retry", "connection"],
    isEnabled: (context) => sessionState(context) === "disconnected" || sessionState(context) === "error",
    execute: executeForSession((context, session) => context.actions.session.reconnect(session))
  },
  {
    id: "session.rename",
    label: "Rename session",
    labelKey: "commands.rename",
    category: "session",
    keywords: ["label"],
    isEnabled: hasSession,
    execute: executeForSession((context, session) => context.actions.session.rename(session))
  },
  {
    id: "session.duplicate",
    label: "Duplicate",
    labelKey: "commands.duplicate",
    category: "session",
    keywords: ["copy", "session"],
    isEnabled: canDuplicateSession,
    execute: executeForSession((context, session) => context.actions.session.duplicate(session))
  },
  {
    id: "session.duplicate-window",
    label: "Duplicate in a new window",
    labelKey: "commands.duplicateWindow",
    category: "session",
    keywords: ["copy", "window", "new window"],
    isEnabled: canDuplicateWindow,
    execute: executeForSession((context, session) => context.actions.session.duplicateWindow(session))
  },
  {
    id: "session.split-horizontal",
    label: "Split horizontally",
    labelKey: "commands.splitHorizontal",
    category: "session",
    keywords: ["split", "layout"],
    isEnabled: canSplitSession,
    execute: executeForSession((context, session) => context.actions.session.splitHorizontal(session))
  },
  {
    id: "session.close",
    label: "Close session",
    labelKey: "commands.close",
    category: "session",
    keywords: ["disconnect", "remove"],
    isEnabled: hasSession,
    execute: executeForSession((context, session) => context.actions.session.close(session))
  },
  {
    id: "navigation.hosts",
    label: "Hosts",
    labelKey: "nav.hosts",
    category: "navigation",
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("hosts")
  },
  {
    id: "navigation.history",
    label: "History",
    labelKey: "nav.history",
    category: "navigation",
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("history")
  },
  {
    id: "navigation.ports",
    label: "Port Forwarding",
    labelKey: "nav.portForwarding",
    category: "navigation",
    keywords: ["ports", "forwarding"],
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("ports")
  },
  {
    id: "navigation.settings",
    label: "Settings",
    labelKey: "nav.settings",
    category: "navigation",
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("settings")
  },
  {
    id: "navigation.sftp",
    label: "SFTP",
    labelKey: "nav.sftp",
    category: "navigation",
    keywords: ["files", "transfer"],
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("sftp")
  },
  {
    id: "navigation.snippets",
    label: "Snippets",
    labelKey: "nav.snippets",
    category: "navigation",
    keywords: ["commands", "templates"],
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("snippets")
  },
  {
    id: "navigation.local-terminal",
    label: "Local Terminal",
    labelKey: "sidebar.localTerminal",
    category: "navigation",
    keywords: ["local shell"],
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.navigation.navigate("local-terminal")
  },
  {
    id: "palette.open",
    label: "Open command palette",
    labelKey: "commands.openPalette",
    category: "palette",
    shortcut: "Ctrl/Cmd+Shift+P",
    keywords: ["commands", "actions"],
    isEnabled: alwaysEnabled,
    execute: ({ actions }) => actions.palette?.open()
  }
]

export const commands = commandRegistry

export function getCommand(commandId: CommandId): CommandDefinition | undefined {
  return commandRegistry.find((command) => command.id === commandId)
}

export function isCommandEnabled(commandId: CommandId, context: CommandContext): boolean {
  const command = getCommand(commandId)
  if (!command) return false
  try {
    return command.isEnabled(context)
  } catch {
    return false
  }
}

export async function executeCommand(commandId: CommandId, context: CommandContext): Promise<CommandExecutionResult> {
  const command = getCommand(commandId)
  if (!command || !isCommandEnabled(commandId, context)) return { status: "disabled" }
  try {
    await command.execute(context)
    return { status: "executed" }
  } catch {
    return { status: "failed" }
  }
}

export function fuzzyScore(value: string, query: string): number | undefined {
  const candidate = normalizeForFuzzy(value)
  const needle = normalizeForFuzzy(query)
  if (needle.length === 0) return 0
  if (candidate.length === 0) return undefined

  let candidateIndex = 0
  let previousIndex = -1
  let score = 0
  for (const character of needle) {
    const matchIndex = candidate.indexOf(character, candidateIndex)
    if (matchIndex === -1) return undefined
    if (matchIndex === 0) score += 80
    if (matchIndex === previousIndex + 1) score += 45
    score -= Math.max(0, matchIndex - candidateIndex)
    previousIndex = matchIndex
    candidateIndex = matchIndex + 1
  }

  if (candidate.startsWith(needle)) score += 300
  if (candidate === needle) score += 1_000
  return score - candidate.length
}

export function filterCommands(
  commandsToFilter: readonly CommandDefinition[],
  query: string,
  localizedLabels?: ReadonlyMap<CommandId, string>
): CommandDefinition[] {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) return [...commandsToFilter]

  return commandsToFilter
    .map((command, index) => ({ command, index, score: commandScore(command, trimmedQuery, localizedLabels?.get(command.id)) }))
    .filter((entry): entry is { command: CommandDefinition; index: number; score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command }) => command)
}

export function groupCommands(commandsToGroup: readonly CommandDefinition[]): CommandGroup[] {
  return categoryOrder
    .map((category) => ({ category, commands: commandsToGroup.filter((command) => command.category === category) }))
    .filter((group) => group.commands.length > 0)
}

function commandScore(command: CommandDefinition, query: string, localizedLabel = command.label): number | undefined {
  const values = [localizedLabel, command.label, command.id, ...(command.keywords ?? [])]
  return values.reduce<number | undefined>((best, value) => {
    const score = fuzzyScore(value, query)
    return score === undefined ? best : best === undefined ? score : Math.max(best, score)
  }, undefined)
}

function normalizeForFuzzy(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "")
}

function connectionState(context: CommandContext): TerminalSessionState | undefined {
  return context.connectionState ?? context.activeSession?.state
}

function sessionState(context: CommandContext): TerminalSessionState | undefined {
  return context.activeSession ? connectionState(context) : undefined
}

function hasSession(context: CommandContext): boolean {
  const state = sessionState(context)
  return context.activeSession !== undefined && state !== "closing"
}

function canDuplicateSession(context: CommandContext): boolean {
  const state = sessionState(context)
  return state === "connected" || state === "disconnected" || state === "error"
}

function canDuplicateWindow(context: CommandContext): boolean {
  return sessionState(context) === "connected"
}

function canSplitSession(context: CommandContext): boolean {
  return sessionState(context) === "connected"
}

function hasTerminalBuffer(context: CommandContext): boolean {
  return hasSession(context) && context.terminalBufferAvailable !== false
}

function hasSelection(context: CommandContext): boolean {
  if (context.selection) return context.selection.hasSelection
  try {
    return context.terminal?.hasSelection() ?? false
  } catch {
    return false
  }
}

function canPaste(context: CommandContext): boolean {
  return context.clipboard?.canPaste ?? true
}

function executeForSession(callback: (context: CommandContext, session: WorkspaceSession) => void | Promise<void>): (context: CommandContext) => void | Promise<void> {
  return (context) => context.activeSession ? callback(context, context.activeSession) : undefined
}

function alwaysEnabled(): boolean {
  return true
}
