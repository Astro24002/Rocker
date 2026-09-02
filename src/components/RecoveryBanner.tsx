import { AlertTriangle, CheckCircle2, Download, RotateCw, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { BootstrapResourceName } from "../../electron/ipc/bridge-contract"
import { deriveBootstrapCapabilities, retryableBootstrapResources, type BootstrapState } from "../app/bootstrap-state"
import { useI18n } from "../i18n"

export interface RecoveryBannerProps {
  state: BootstrapState
  onRetry(resources: BootstrapResourceName[]): void | Promise<void>
  onExportDiagnostics(): Promise<{ canceled: boolean; path?: string }>
}

const resourceLabels: Record<BootstrapResourceName, "bootstrap.settings" | "bootstrap.history" | "bootstrap.workspace" | "bootstrap.hosts" | "bootstrap.credentials" | "bootstrap.hostKeys"> = {
  settings: "bootstrap.settings",
  history: "bootstrap.history",
  workspace: "bootstrap.workspace",
  hosts: "bootstrap.hosts",
  credentials: "bootstrap.credentials",
  hostKeys: "bootstrap.hostKeys"
}

export function RecoveryBanner({ state, onRetry, onExportDiagnostics }: RecoveryBannerProps) {
  const { t } = useI18n()
  const capabilities = deriveBootstrapCapabilities(state)
  const retryable = retryableBootstrapResources(state)
  const [dismissed, setDismissed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)
  const isError = state.phase === "error" || state.error === true
  const affected = useMemo(() => isError
    ? [...retryableBootstrapResources(state)]
    : [...new Set([...capabilities.blocked, ...capabilities.notices])], [capabilities.blocked, capabilities.notices, isError, state])
  const issueKey = `${state.phase}:${affected.join(",")}`

  useEffect(() => {
    setDismissed(false)
    setExported(false)
  }, [issueKey])

  if (affected.length === 0 || (capabilities.blocked.length === 0 && dismissed)) return null

  const blocked = capabilities.blocked.length > 0 || isError
  const labels = affected.map((resource) => t(resourceLabels[resource])).join(", ")

  const exportDiagnostics = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    setExported(false)
    try {
      await onExportDiagnostics()
      setExported(true)
    } catch {
      setExported(false)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`recovery-banner ${blocked ? "recovery-banner-blocked" : "recovery-banner-recoverable"}`} role={blocked ? "alert" : "status"}>
      <div className="recovery-banner-copy">
        {blocked ? <AlertTriangle aria-hidden="true" size={16} /> : <CheckCircle2 aria-hidden="true" size={16} />}
        <span><strong>{blocked ? t("bootstrap.blocked") : t("bootstrap.recovered")}</strong><span>{labels}</span></span>
        {blocked && <small>{t("bootstrap.dataNotReset")}</small>}
        {exported && <small>{t("bootstrap.diagnosticsExported")}</small>}
      </div>
      <div className="recovery-banner-actions">
        {retryable.length > 0 && <button type="button" className="recovery-banner-command" disabled={state.retrying.length > 0} onClick={() => void onRetry(retryable)}><RotateCw aria-hidden="true" size={14} />{t("bootstrap.retry")}</button>}
        <button type="button" className="recovery-banner-command" disabled={exporting} onClick={() => void exportDiagnostics()}><Download aria-hidden="true" size={14} />{t("bootstrap.exportDiagnostics")}</button>
        {!blocked && <button type="button" className="recovery-banner-dismiss" aria-label={t("bootstrap.dismiss")} title={t("bootstrap.dismiss")} onClick={() => setDismissed(true)}><X aria-hidden="true" size={15} /></button>}
      </div>
    </div>
  )
}
