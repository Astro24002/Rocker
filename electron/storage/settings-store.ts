import { JsonStore } from "./json-store"
import type { AppSettings } from "./types"

export const defaultSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  connectionTimeout: 15,
  autoReconnect: true,
  portScanInterval: 15,
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

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    locale: settings.locale === "zh-CN" ? "zh-CN" : "en",
    sidebarWidth: clamp(settings.sidebarWidth, 180, 360, 220),
    terminalFont: typeof settings.terminalFont === "string" && settings.terminalFont.length <= 80 ? settings.terminalFont : defaultSettings.terminalFont,
    terminalFontSize: clamp(settings.terminalFontSize, 10, 24, 13),
    connectionTimeout: clamp(settings.connectionTimeout, 5, 120, 15),
    autoReconnect: Boolean(settings.autoReconnect),
    portScanInterval: [0, 15, 30, 60].includes(settings.portScanInterval) ? settings.portScanInterval : 15,
    bindAddress: ["127.0.0.1", "::1", "0.0.0.0"].includes(settings.bindAddress) ? settings.bindAddress : "127.0.0.1"
  }
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}
