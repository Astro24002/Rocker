import type { ReactNode } from "react"
import type { AppSettings } from "../../app/types"
import type { Locale } from "../../i18n"
import { useI18n } from "../../i18n"

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
      <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{t("settings.title")}</h1><p>{t("settings.subtitle")}</p></div></header>
      <div className="settings-list">
        <SettingRow title={t("settings.language")} description={t("settings.languageHint")}>
          <div className="segmented-control" aria-label={t("settings.language")}><button data-active={locale === "en"} type="button" onClick={() => onLocaleChange("en")}>{t("settings.english")}</button><button data-active={locale === "zh-CN"} type="button" onClick={() => onLocaleChange("zh-CN")}>{t("settings.chinese")}</button></div>
        </SettingRow>
        <SettingRow title={t("settings.terminalFont")} description={t("settings.terminalFontHint")}><select aria-label={t("settings.terminalFont")} value={settings.terminalFont} onChange={(event) => onUpdate({ terminalFont: event.target.value })}><option>JetBrains Mono</option><option>SFMono-Regular</option><option>Consolas</option></select></SettingRow>
        <SettingRow title={t("settings.fontSize")} description={t("settings.fontSizeHint")}><input aria-label={t("settings.fontSize")} className="number-setting" type="number" min={10} max={24} value={settings.terminalFontSize} onChange={(event) => onUpdate({ terminalFontSize: Number(event.target.value) })} /></SettingRow>
        <SettingRow title={t("settings.connectionTimeout")} description={t("settings.connectionTimeoutHint")}><select aria-label={t("settings.connectionTimeout")} value={settings.connectionTimeout} onChange={(event) => onUpdate({ connectionTimeout: Number(event.target.value) })}><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></SettingRow>
        <SettingRow title={t("settings.autoReconnect")} description={t("settings.autoReconnectHint")}><input aria-label={t("settings.autoReconnect")} className="toggle-input" type="checkbox" checked={settings.autoReconnect} onChange={(event) => onUpdate({ autoReconnect: event.target.checked })} /></SettingRow>
        <SettingRow title={t("settings.reconnectMode")} description={t("settings.reconnectModeHint")}><select aria-label={t("settings.reconnectMode")} value={settings.reconnectMode} onChange={(event) => onUpdate({ reconnectMode: event.target.value as AppSettings["reconnectMode"] })}><option value="limited">{t("settings.reconnectLimited")}</option><option value="continuous">{t("settings.reconnectContinuous")}</option></select></SettingRow>
        <SettingRow title={t("settings.restorePreviousWorkspace")} description={t("settings.restorePreviousWorkspaceHint")}><input aria-label={t("settings.restorePreviousWorkspace")} className="toggle-input" type="checkbox" checked={settings.restorePreviousWorkspace} onChange={(event) => onUpdate({ restorePreviousWorkspace: event.target.checked })} /></SettingRow>
        <SettingRow title={t("settings.confirmMultilinePaste")} description={t("settings.confirmMultilinePasteHint")}><input aria-label={t("settings.confirmMultilinePaste")} className="toggle-input" type="checkbox" checked={settings.confirmMultilinePaste} onChange={(event) => onUpdate({ confirmMultilinePaste: event.target.checked })} /></SettingRow>
        <SettingRow title={t("settings.defaultBindAddress")} description={t("settings.defaultBindAddressHint")}><select aria-label={t("settings.defaultBindAddress")} value={settings.bindAddress} onChange={(event) => onUpdate({ bindAddress: event.target.value as AppSettings["bindAddress"] })}><option>127.0.0.1</option><option>::1</option><option>0.0.0.0</option></select></SettingRow>
      </div>
    </section>
  )
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="settings-row"><div className="setting-copy"><strong>{title}</strong><span>{description}</span></div><div className="setting-control">{children}</div></div>
}
