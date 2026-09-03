import type { CommandId } from "./command-registry"

type ShortcutPlatform = NodeJS.Platform | string

export function matchGlobalShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "defaultPrevented" | "key" | "metaKey" | "shiftKey">, platform: ShortcutPlatform): CommandId | undefined {
  if (event.defaultPrevented || event.altKey || !event.shiftKey) return undefined
  if (event.key.toLowerCase() !== "f" && event.key.toLowerCase() !== "p") return undefined

  const mac = platform === "darwin"
  if (mac ? (!event.metaKey || event.ctrlKey) : (!event.ctrlKey || event.metaKey)) return undefined
  return event.key.toLowerCase() === "f" ? "terminal.search" : "palette.open"
}

export function handleGlobalShortcut(
  event: KeyboardEvent,
  platform: ShortcutPlatform,
  onCommand: (commandId: CommandId) => void
): boolean {
  if (shouldIgnoreGlobalShortcutTarget(event.target)) return false
  const commandId = matchGlobalShortcut(event, platform)
  if (!commandId) return false
  event.preventDefault()
  onCommand(commandId)
  return true
}

export function shouldIgnoreGlobalShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest("[data-command-palette], .terminal-search-overlay")) return false
  if (target.isContentEditable || target.contentEditable === "true") return true
  if (target.tagName === "TEXTAREA") return true
  if (target.tagName !== "INPUT") return false

  const inputType = (target as HTMLInputElement).type.toLowerCase()
  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(inputType)
}

export const getShortcutCommand = matchGlobalShortcut
