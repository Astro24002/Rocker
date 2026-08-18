import type { Locale } from "../../i18n"
import { useI18n } from "../../i18n"
import type { AppSettings } from "../../app/types"

interface SettingsViewProps {
  locale: Locale
  onLocaleChange(locale: Locale): void
  settings: AppSettings
  onUpdate(update: Partial<AppSettings>): void
}

export function SettingsView({ locale, onLocaleChange, settings, onUpdate }: SettingsViewProps) {
  const { t } = useI18n()
  return (
    <section className="settings-view">
      <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{t("settings.title")}</h1><p>Desktop preferences are stored on this device.</p></div></header>
      <div className="settings-list">
        <SettingRow title={t("settings.language")} description={t("settings.languageHint")}>
          <div className="segmented-control" aria-label={t("settings.language")}><button data-active={locale === "en"} type="button" onClick={() => onLocaleChange("en")}>{t("settings.english")}</button><button data-active={locale === "zh-CN"} type="button" onClick={() => onLocaleChange("zh-CN")}>{t("settings.chinese")}</button></div>
        </SettingRow>
        <SettingRow title="Terminal font" description="Used by all new terminal sessions."><select value={settings.terminalFont} onChange={(event) => onUpdate({ terminalFont: event.target.value })}><option>JetBrains Mono</option><option>SFMono-Regular</option><option>Consolas</option></select></SettingRow>
        <SettingRow title="Font size" description="Terminal text size in pixels."><input className="number-setting" type="number" min={10} max={24} value={settings.terminalFontSize} onChange={(event) => onUpdate({ terminalFontSize: Number(event.target.value) })} /></SettingRow>
        <SettingRow title="Connection timeout" description="Stop connection attempts after this duration."><select value={settings.connectionTimeout} onChange={(event) => onUpdate({ connectionTimeout: Number(event.target.value) })}><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></SettingRow>
        <SettingRow title="Automatic reconnect" description="Reconnect once after an unexpected disconnect."><input className="toggle-input" type="checkbox" checked={settings.autoReconnect} onChange={(event) => onUpdate({ autoReconnect: event.target.checked })} /></SettingRow>
        <SettingRow title="Port recommendations" description="Remote port checks are always user-triggered."><select value={settings.portScanInterval} onChange={(event) => onUpdate({ portScanInterval: Number(event.target.value) })}><option value="0">Manual only</option><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option></select></SettingRow>
        <SettingRow title="Default bind address" description="Local address used for new forwarding rules."><select value={settings.bindAddress} onChange={(event) => onUpdate({ bindAddress: event.target.value as AppSettings["bindAddress"] })}><option>127.0.0.1</option><option>::1</option><option>0.0.0.0</option></select></SettingRow>
      </div>
    </section>
  )
}

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="settings-row"><div className="setting-copy"><strong>{title}</strong><span>{description}</span></div><div className="setting-control">{children}</div></div>
}
