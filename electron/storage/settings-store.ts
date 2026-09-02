import { JsonStore } from "./json-store"
import { StorageBlockedError, type LoadResult } from "./storage-result"
import type { AppSettings } from "./types"

export const defaultSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  scrollback: 10000,
  cursorStyle: "bar",
  cursorBlink: true,
  terminalBell: true,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

export class SettingsStore {
  private readonly store: JsonStore<AppSettings>

  public constructor(filePath: string) {
    this.store = new JsonStore({
      filePath,
      store: "settings",
      defaultValue: defaultSettings,
      recovery: "default",
      normalize: normalizeSettings
    })
  }

  public async loadWithStatus(options: { consumeHealth?: boolean } = {}): Promise<LoadResult<AppSettings>> {
    return this.store.load(options)
  }

  public async get(): Promise<AppSettings> {
    const result = await this.loadWithStatus()
    if (result.status === "blocked") throw new StorageBlockedError(result.issue)
    return result.value
  }

  public async update(update: Partial<AppSettings>): Promise<AppSettings> {
    return this.store.update((current) => normalizeSettings({ ...current, ...update }) ?? defaultSettings)
  }
}

export function normalizeSettings(value: unknown): AppSettings | undefined {
  if (!isRecord(value) || !hasSettingsShape(value)) return undefined
  const settings = value as Partial<AppSettings>
  return {
    locale: settings.locale === "zh-CN" ? "zh-CN" : "en",
    sidebarWidth: clamp(settings.sidebarWidth ?? defaultSettings.sidebarWidth, 180, 360, 220),
    terminalFont: typeof settings.terminalFont === "string" && settings.terminalFont.length <= 80 ? settings.terminalFont : defaultSettings.terminalFont,
    terminalFontSize: clamp(settings.terminalFontSize ?? defaultSettings.terminalFontSize, 10, 24, 13),
    scrollback: isScrollback(settings.scrollback) ? settings.scrollback : defaultSettings.scrollback,
    cursorStyle: isCursorStyle(settings.cursorStyle) ? settings.cursorStyle : defaultSettings.cursorStyle,
    cursorBlink: settings.cursorBlink === false ? false : true,
    terminalBell: settings.terminalBell === false ? false : true,
    connectionTimeout: clamp(settings.connectionTimeout ?? defaultSettings.connectionTimeout, 5, 120, 15),
    autoReconnect: settings.autoReconnect !== false,
    reconnectMode: settings.reconnectMode === "continuous" ? "continuous" : "limited",
    restorePreviousWorkspace: settings.restorePreviousWorkspace !== false,
    confirmMultilinePaste: settings.confirmMultilinePaste !== false,
    bindAddress: settings.bindAddress === "::1" || settings.bindAddress === "0.0.0.0" ? settings.bindAddress : "127.0.0.1"
  }
}

const requiredSettingsKeys = [
  "locale",
  "sidebarWidth",
  "terminalFont",
  "terminalFontSize",
  "connectionTimeout",
  "autoReconnect",
  "bindAddress"
] as const

function hasSettingsShape(value: Record<string, unknown>): boolean {
  return requiredSettingsKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}

function isScrollback(value: unknown): value is AppSettings["scrollback"] {
  return value === 1000 || value === 5000 || value === 10000 || value === 25000 || value === 50000
}

function isCursorStyle(value: unknown): value is AppSettings["cursorStyle"] {
  return value === "block" || value === "underline" || value === "bar"
}
