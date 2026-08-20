import { JsonStore } from "./json-store"
import type { AppSettings } from "./types"

export const defaultSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
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
    this.store = new JsonStore(filePath, defaultSettings)
  }

  public async get(): Promise<AppSettings> {
    return normalizeSettings(await this.store.read())
  }

  public async update(update: Partial<AppSettings>): Promise<AppSettings> {
    const next = normalizeSettings({ ...await this.get(), ...update })
    await this.store.write(next)
    return next
  }
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    locale: settings.locale === "zh-CN" ? "zh-CN" : "en",
    sidebarWidth: clamp(settings.sidebarWidth ?? defaultSettings.sidebarWidth, 180, 360, 220),
    terminalFont: typeof settings.terminalFont === "string" && settings.terminalFont.length <= 80 ? settings.terminalFont : defaultSettings.terminalFont,
    terminalFontSize: clamp(settings.terminalFontSize ?? defaultSettings.terminalFontSize, 10, 24, 13),
    connectionTimeout: clamp(settings.connectionTimeout ?? defaultSettings.connectionTimeout, 5, 120, 15),
    autoReconnect: settings.autoReconnect !== false,
    reconnectMode: settings.reconnectMode === "continuous" ? "continuous" : "limited",
    restorePreviousWorkspace: settings.restorePreviousWorkspace !== false,
    confirmMultilinePaste: settings.confirmMultilinePaste !== false,
    bindAddress: settings.bindAddress === "::1" || settings.bindAddress === "0.0.0.0" ? settings.bindAddress : "127.0.0.1"
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}
