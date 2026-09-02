import { useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Download } from "lucide-react"
import type { AppSettings } from "../../app/types"
import type { Locale } from "../../i18n"
import { useI18n } from "../../i18n"

interface SettingsViewProps {
  locale: Locale
  disabled?: boolean
  onLocaleChange(locale: Locale): void
  settings: AppSettings
  onUpdate(update: Partial<AppSettings>): void
  onExportDiagnostics(): Promise<{ canceled: boolean; path?: string }>
}

type ExportStatus =
  | { kind: "idle" }
  | { kind: "success"; path: string }
  | { kind: "cancelled" }
  | { kind: "error" }

export function SettingsView({ locale, disabled = false, onLocaleChange, settings, onUpdate, onExportDiagnostics }: SettingsViewProps) {
  const { t } = useI18n()
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ kind: "idle" })

  const exportDiagnostics = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    setExportStatus({ kind: "idle" })
    try {
      const result = await onExportDiagnostics()
      setExportStatus(result.canceled || !result.path ? { kind: "cancelled" } : { kind: "success", path: result.path })
    } catch {
      setExportStatus({ kind: "error" })
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="settings-view">
      <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{t("settings.title")}</h1><p>{t("settings.subtitle")}</p></div></header>
      <div className="settings-list">
        <SettingRow title={t("settings.language")} description={t("settings.languageHint")}>
          <div className="segmented-control" aria-label={t("settings.language")}><button disabled={disabled} data-active={locale === "en"} type="button" onClick={() => { if (!disabled) onLocaleChange("en") }}>{t("settings.english")}</button><button disabled={disabled} data-active={locale === "zh-CN"} type="button" onClick={() => { if (!disabled) onLocaleChange("zh-CN") }}>{t("settings.chinese")}</button></div>
        </SettingRow>
        <SettingRow title={t("settings.terminalFont")} description={t("settings.terminalFontHint")}><select disabled={disabled} aria-label={t("settings.terminalFont")} value={settings.terminalFont} onChange={(event) => { if (!disabled) onUpdate({ terminalFont: event.target.value }) }}><option>JetBrains Mono</option><option>SFMono-Regular</option><option>Consolas</option></select></SettingRow>
        <SettingRow title={t("settings.fontSize")} description={t("settings.fontSizeHint")}><input disabled={disabled} aria-label={t("settings.fontSize")} className="number-setting" type="number" min={10} max={24} value={settings.terminalFontSize} onChange={(event) => { if (!disabled) onUpdate({ terminalFontSize: Number(event.target.value) }) }} /></SettingRow>
        <SettingRow title={t("settings.connectionTimeout")} description={t("settings.connectionTimeoutHint")}><select disabled={disabled} aria-label={t("settings.connectionTimeout")} value={settings.connectionTimeout} onChange={(event) => { if (!disabled) onUpdate({ connectionTimeout: Number(event.target.value) }) }}><option value="10">10 seconds</option><option value="15">15 seconds</option><option value="30">30 seconds</option></select></SettingRow>
        <SettingRow title={t("settings.autoReconnect")} description={t("settings.autoReconnectHint")}><input disabled={disabled} aria-label={t("settings.autoReconnect")} className="toggle-input" type="checkbox" checked={settings.autoReconnect} onChange={(event) => { if (!disabled) onUpdate({ autoReconnect: event.target.checked }) }} /></SettingRow>
        <SettingRow title={t("settings.reconnectMode")} description={t("settings.reconnectModeHint")}><select disabled={disabled} aria-label={t("settings.reconnectMode")} value={settings.reconnectMode} onChange={(event) => { if (!disabled) onUpdate({ reconnectMode: event.target.value as AppSettings["reconnectMode"] }) }}><option value="limited">{t("settings.reconnectLimited")}</option><option value="continuous">{t("settings.reconnectContinuous")}</option></select></SettingRow>
        <SettingRow title={t("settings.restorePreviousWorkspace")} description={t("settings.restorePreviousWorkspaceHint")}><input disabled={disabled} aria-label={t("settings.restorePreviousWorkspace")} className="toggle-input" type="checkbox" checked={settings.restorePreviousWorkspace} onChange={(event) => { if (!disabled) onUpdate({ restorePreviousWorkspace: event.target.checked }) }} /></SettingRow>
        <SettingRow title={t("settings.confirmMultilinePaste")} description={t("settings.confirmMultilinePasteHint")}><input disabled={disabled} aria-label={t("settings.confirmMultilinePaste")} className="toggle-input" type="checkbox" checked={settings.confirmMultilinePaste} onChange={(event) => { if (!disabled) onUpdate({ confirmMultilinePaste: event.target.checked }) }} /></SettingRow>
        <SettingRow title={t("settings.defaultBindAddress")} description={t("settings.defaultBindAddressHint")}><select disabled={disabled} aria-label={t("settings.defaultBindAddress")} value={settings.bindAddress} onChange={(event) => { if (!disabled) onUpdate({ bindAddress: event.target.value as AppSettings["bindAddress"] }) }}><option>127.0.0.1</option><option>::1</option><option>0.0.0.0</option></select></SettingRow>
        <SettingRow title={t("settings.diagnostics")} description={t("settings.diagnosticsHint")}>
          <div className="settings-action-group">
            <button className="settings-action" type="button" disabled={exporting} onClick={() => void exportDiagnostics()}>
              <Download size={15} aria-hidden="true" />
              {t("settings.exportDiagnostics")}
            </button>
            {exportStatus.kind === "success" && <span className="settings-action-status" role="status"><CheckCircle2 size={14} aria-hidden="true" />{t("settings.diagnosticsExported")} {exportStatus.path}</span>}
            {exportStatus.kind === "cancelled" && <span className="settings-action-status" role="status">{t("settings.diagnosticsExportCancelled")}</span>}
            {exportStatus.kind === "error" && <span className="settings-action-status settings-action-status-error" role="status"><AlertTriangle size={14} aria-hidden="true" />{t("settings.diagnosticsExportError")}</span>}
          </div>
        </SettingRow>
      </div>
    </section>
  )
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="settings-row"><div className="setting-copy"><strong>{title}</strong><span>{description}</span></div><div className="setting-control">{children}</div></div>
}
