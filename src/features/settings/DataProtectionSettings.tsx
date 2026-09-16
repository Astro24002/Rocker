import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Download, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UnlockKeyhole, Upload } from "lucide-react"
import type {
  ConfigurationImportChooseResult,
  ConfigurationImportRequest,
  RockerBridge
} from "../../../electron/ipc/bridge-contract"
import type { CredentialProtectionStatus } from "../../../electron/storage/credentials"
import type { ForwardingConflictResolution, HostConflictResolution, HostKeyConflictResolution, ImportPreview } from "../../../electron/storage/config-bundle"
import { useI18n } from "../../i18n"

type DataProtectionBridge = Pick<RockerBridge, "configuration" | "credentials">

interface DataProtectionSettingsProps {
  bridge: DataProtectionBridge
  onImported?(): void
}

type OperationStatus =
  | { kind: "idle" }
  | { kind: "pending"; message: string }
  | { kind: "success"; message: string }
  | { kind: "cancelled"; message: string }
  | { kind: "error"; message: string }

const emptyProtectionStatus: CredentialProtectionStatus = {
  mode: "keychain",
  keychainAvailable: true,
  vaultState: "not-configured"
}

export function DataProtectionSettings({ bridge, onImported }: DataProtectionSettingsProps) {
  const { t } = useI18n()
  const [protection, setProtection] = useState<CredentialProtectionStatus>(emptyProtectionStatus)
  const [vaultPassword, setVaultPassword] = useState("")
  const [vaultConfirmation, setVaultConfirmation] = useState("")
  const [migrationPassword, setMigrationPassword] = useState("")
  const [migrationConfirmation, setMigrationConfirmation] = useState("")
  const [importPassword, setImportPassword] = useState("")
  const [importSelection, setImportSelection] = useState<ConfigurationImportChooseResult>()
  const [importPreview, setImportPreview] = useState<ImportPreview>()
  const [hostActions, setHostActions] = useState<Record<string, HostConflictResolution>>({})
  const [hostKeyActions, setHostKeyActions] = useState<Record<string, HostKeyConflictResolution>>({})
  const [forwardingActions, setForwardingActions] = useState<Record<string, ForwardingConflictResolution>>({})
  const [importHostKeys, setImportHostKeys] = useState(false)
  const [applySettings, setApplySettings] = useState(false)
  const [importCredentials, setImportCredentials] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<OperationStatus>({ kind: "idle" })

  useEffect(() => {
    let active = true
    void bridge.credentials.protectionStatus().then((next) => {
      if (active) setProtection(next)
    }).catch(() => {
      if (active) setStatus({ kind: "error", message: t("settings.vaultOperationError") })
    })
    return () => { active = false }
  }, [bridge, t])

  const refreshProtection = async (operation: () => Promise<CredentialProtectionStatus>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      const next = await operation()
      setProtection(next)
      setVaultPassword("")
      setVaultConfirmation("")
      setStatus({
        kind: "success",
        message: next.mode === "keychain"
          ? t("settings.systemKeychain")
          : next.vaultState === "locked"
            ? t("settings.vaultLocked")
            : t("settings.vaultUnlocked")
      })
    } catch {
      setStatus({ kind: "error", message: t("settings.vaultOperationError") })
    } finally {
      setBusy(false)
    }
  }

  const enableOrUnlockVault = (): void => {
    if (protection.mode === "vault") {
      if (!vaultPassword) return
      void refreshProtection(() => bridge.credentials.unlockVault(vaultPassword))
      return
    }
    if (!vaultPassword || vaultPassword !== vaultConfirmation) {
      setStatus({ kind: "error", message: t("settings.vaultPasswordsMismatch") })
      return
    }
    void refreshProtection(() => bridge.credentials.enableVault(vaultPassword))
  }

  const exportTemplate = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      const result = await bridge.configuration.exportTemplate()
      setStatus(result.canceled || !result.path
        ? { kind: "cancelled", message: t("settings.configurationExportCancelled") }
        : { kind: "success", message: `${t("settings.exportedTo")} ${result.path}` })
    } catch {
      setStatus({ kind: "error", message: t("settings.configurationExportError") })
    } finally {
      setBusy(false)
    }
  }

  const exportMigration = async (): Promise<void> => {
    if (busy) return
    if (!migrationPassword || migrationPassword !== migrationConfirmation) {
      setStatus({ kind: "error", message: t("settings.migrationPasswordsMismatch") })
      return
    }
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      const result = await bridge.configuration.exportBundle(migrationPassword)
      setMigrationPassword("")
      setMigrationConfirmation("")
      setStatus(result.canceled || !result.path
        ? { kind: "cancelled", message: t("settings.configurationExportCancelled") }
        : { kind: "success", message: `${t("settings.exportedTo")} ${result.path}` })
    } catch {
      setStatus({ kind: "error", message: t("settings.configurationExportError") })
    } finally {
      setBusy(false)
    }
  }

  const chooseImport = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      const selected = await bridge.configuration.chooseImport()
      if (selected.canceled || !selected.importId || !selected.preview) {
        setImportSelection(undefined)
        setImportPreview(undefined)
        setStatus({ kind: "cancelled", message: t("settings.configurationImportCancelled") })
        return
      }
      setImportSelection(selected)
      setImportPreview(selected.preview)
      setHostActions({})
      setHostKeyActions({})
      setForwardingActions({})
      setImportHostKeys(false)
      setApplySettings(false)
      setImportCredentials(false)
      setImportPassword("")
    } catch {
      setStatus({ kind: "error", message: t("settings.importError") })
    } finally {
      setBusy(false)
    }
  }

  const previewEncryptedImport = async (): Promise<void> => {
    if (!importSelection?.importId || !importPassword || busy) return
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      const preview = await bridge.configuration.previewImport(importSelection.importId, importPassword)
      setImportPreview(preview)
    } catch {
      setStatus({ kind: "error", message: t("settings.importError") })
    } finally {
      setBusy(false)
    }
  }

  const importReady = useMemo(() => {
    if (!importSelection?.importId || !importPreview || importPreview.requiresPassword) return false
    if (importPreview.hostConflicts.some((conflict) => hostActions[conflict.id] === undefined)) return false
    if (importHostKeys && importPreview.hostKeyConflicts.some((conflict) => hostKeyActions[conflict.id] === undefined)) return false
    if ((importPreview.forwardingConflicts ?? []).some((conflict) => forwardingActions[conflict.id] === undefined)) return false
    return true
  }, [forwardingActions, hostActions, hostKeyActions, importHostKeys, importPreview, importSelection])

  const applyImport = async (): Promise<void> => {
    if (!importReady || !importSelection?.importId || !importPreview || busy) return
    const request: ConfigurationImportRequest = {
      importId: importSelection.importId,
      password: importPassword || undefined,
      resolution: {
        hosts: hostActions,
        hostKeys: hostKeyActions,
        ...((importPreview.forwardingConflicts ?? []).length > 0 ? { forwardings: forwardingActions } : {}),
        importHostKeys,
        applySettings,
        importCredentials
      }
    }
    setBusy(true)
    setStatus({ kind: "pending", message: t("settings.operationPending") })
    try {
      await bridge.configuration.applyImport(request)
      setImportSelection(undefined)
      setImportPreview(undefined)
      setStatus({ kind: "success", message: t("settings.importSuccess") })
      onImported?.()
    } catch {
      setStatus({ kind: "error", message: t("settings.importError") })
    } finally {
      setBusy(false)
    }
  }

  const vaultLabel = protection.mode === "vault"
    ? protection.vaultState === "unlocked" ? t("settings.vaultUnlocked") : t("settings.vaultLocked")
    : protection.keychainAvailable ? t("settings.systemKeychain") : t("settings.keychainUnavailable")

  return (
    <section className="data-protection-settings" aria-labelledby="data-protection-title">
      <div className="settings-section-heading">
        <div>
          <span className="view-eyebrow">{t("settings.dataProtection")}</span>
          <h2 id="data-protection-title">{t("settings.credentialStorage")}</h2>
          <p>{t("settings.dataProtectionHint")}</p>
        </div>
        <div className="data-protection-status" data-mode={protection.mode}>
          {protection.mode === "vault" ? <LockKeyhole size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
          <span>{vaultLabel}</span>
        </div>
      </div>

      <div className="data-protection-panel">
        <div className="data-protection-panel-icon"><KeyRound size={17} aria-hidden="true" /></div>
        <div className="data-protection-panel-copy">
          <strong>{vaultLabel}</strong>
          <span id="vault-password-hint">{t("settings.vaultHint")}</span>
        </div>
        <div className="data-protection-panel-actions">
          {protection.mode === "vault" && protection.vaultState === "unlocked" ? (
            <>
              <button type="button" className="settings-action" disabled={busy} onClick={() => void refreshProtection(() => bridge.credentials.lockVault())}>
                <LockKeyhole size={15} aria-hidden="true" />{t("settings.lockVault")}
              </button>
              <button type="button" className="settings-action" disabled={busy || !protection.keychainAvailable} onClick={() => void refreshProtection(() => bridge.credentials.disableVault())}>
                <ShieldCheck size={15} aria-hidden="true" />{t("settings.disableVault")}
              </button>
            </>
          ) : (
            <>
              <label className="data-protection-field" htmlFor="vault-password">
                <span>{t("settings.vaultPassword")}</span>
                <input id="vault-password" type="password" aria-describedby="vault-password-hint" autoComplete={protection.mode === "vault" ? "current-password" : "new-password"} value={vaultPassword} onChange={(event) => setVaultPassword(event.target.value)} placeholder={t("settings.vaultPassword")} />
              </label>
              {protection.mode !== "vault" && <label className="data-protection-field" htmlFor="vault-password-confirmation">
                <span>{t("settings.confirmVaultPassword")}</span>
                <input id="vault-password-confirmation" type="password" aria-describedby="vault-password-hint" autoComplete="new-password" value={vaultConfirmation} onChange={(event) => setVaultConfirmation(event.target.value)} placeholder={t("settings.confirmVaultPassword")} />
              </label>}
              <button type="button" className="settings-action settings-action-primary" disabled={busy || !vaultPassword || (protection.mode !== "vault" && !vaultConfirmation)} onClick={enableOrUnlockVault}>
                {protection.mode === "vault" ? <UnlockKeyhole size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
                {protection.mode === "vault" ? t("settings.unlockVault") : t("settings.enableVault")}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="settings-section-heading data-protection-subheading">
        <div>
          <span className="view-eyebrow">{t("settings.configurationMigration")}</span>
          <h2>{t("settings.configurationMigration")}</h2>
          <p id="migration-password-hint">{t("settings.configurationMigrationHint")}</p>
        </div>
      </div>
      <div className="data-protection-migration-actions">
        <div className="data-protection-action-block">
          <div className="data-protection-action-heading"><Download size={16} aria-hidden="true" /><strong>{t("settings.exportTemplate")}</strong></div>
          <button type="button" className="settings-action" disabled={busy} onClick={() => void exportTemplate()}><Download size={15} aria-hidden="true" />{t("settings.exportTemplate")}</button>
        </div>
        <div className="data-protection-action-block">
          <div className="data-protection-action-heading"><LockKeyhole size={16} aria-hidden="true" /><strong>{t("settings.exportMigration")}</strong></div>
          <div className="data-protection-inline-fields">
            <label className="data-protection-field" htmlFor="migration-password">
              <span>{t("settings.migrationPassword")}</span>
              <input id="migration-password" type="password" aria-describedby="migration-password-hint" autoComplete="new-password" value={migrationPassword} onChange={(event) => setMigrationPassword(event.target.value)} placeholder={t("settings.migrationPassword")} />
            </label>
            <label className="data-protection-field" htmlFor="migration-password-confirmation">
              <span>{t("settings.confirmMigrationPassword")}</span>
              <input id="migration-password-confirmation" type="password" aria-describedby="migration-password-hint" autoComplete="new-password" value={migrationConfirmation} onChange={(event) => setMigrationConfirmation(event.target.value)} placeholder={t("settings.confirmMigrationPassword")} />
            </label>
          </div>
          <button type="button" className="settings-action" disabled={busy || !migrationPassword || !migrationConfirmation} onClick={() => void exportMigration()}><LockKeyhole size={15} aria-hidden="true" />{t("settings.exportMigration")}</button>
        </div>
      </div>
      <div className="data-protection-import-block">
        <div className="data-protection-action-heading"><Upload size={16} aria-hidden="true" /><strong>{t("settings.importConfiguration")}</strong></div>
        <p>{t("settings.importHint")}</p>
        <button type="button" className="settings-action" disabled={busy} onClick={() => void chooseImport()}><Upload size={15} aria-hidden="true" />{t("settings.importConfiguration")}</button>
        {importSelection && importPreview && <ImportPreviewPanel
          preview={importPreview}
          importPassword={importPassword}
          busy={busy}
          hostActions={hostActions}
          hostKeyActions={hostKeyActions}
          forwardingActions={forwardingActions}
          importHostKeys={importHostKeys}
          applySettings={applySettings}
          importCredentials={importCredentials}
          onImportPasswordChange={setImportPassword}
          onPreviewPassword={previewEncryptedImport}
          onHostAction={(id, action) => setHostActions((current) => ({ ...current, [id]: action }))}
          onHostKeyAction={(id, action) => setHostKeyActions((current) => ({ ...current, [id]: action }))}
          onForwardingAction={(id, action) => setForwardingActions((current) => ({ ...current, [id]: action }))}
          onImportHostKeysChange={setImportHostKeys}
          onApplySettingsChange={setApplySettings}
          onImportCredentialsChange={setImportCredentials}
          onApply={() => void applyImport()}
        />}
      </div>
      {status.kind !== "idle" && <div className={`data-protection-operation-status data-protection-operation-status-${status.kind}`} role="status" aria-live="polite" aria-busy={status.kind === "pending"}>
        {status.kind === "success" ? <CheckCircle2 size={15} aria-hidden="true" /> : status.kind === "pending" ? <LoaderCircle size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
        <span>{status.message}</span>
      </div>}
    </section>
  )
}

function ImportPreviewPanel({
  preview,
  importPassword,
  busy,
  hostActions,
  hostKeyActions,
  forwardingActions,
  importHostKeys,
  applySettings,
  importCredentials,
  onImportPasswordChange,
  onPreviewPassword,
  onHostAction,
  onHostKeyAction,
  onForwardingAction,
  onImportHostKeysChange,
  onApplySettingsChange,
  onImportCredentialsChange,
  onApply
}: {
  preview: ImportPreview
  importPassword: string
  busy: boolean
  hostActions: Record<string, HostConflictResolution>
  hostKeyActions: Record<string, HostKeyConflictResolution>
  forwardingActions: Record<string, ForwardingConflictResolution>
  importHostKeys: boolean
  applySettings: boolean
  importCredentials: boolean
  onImportPasswordChange(value: string): void
  onPreviewPassword(): void
  onHostAction(id: string, action: HostConflictResolution): void
  onHostKeyAction(id: string, action: HostKeyConflictResolution): void
  onForwardingAction(id: string, action: ForwardingConflictResolution): void
  onImportHostKeysChange(value: boolean): void
  onApplySettingsChange(value: boolean): void
  onImportCredentialsChange(value: boolean): void
  onApply(): void
}) {
  const { t } = useI18n()
  if (preview.requiresPassword) {
    return <div className="import-preview-panel">
      <p id="import-password-hint">{t("settings.importRequiresPassword")}</p>
      <div className="data-protection-inline-fields">
        <label className="data-protection-field" htmlFor="import-password">
          <span>{t("settings.importPassword")}</span>
          <input id="import-password" type="password" aria-describedby="import-password-hint" autoComplete="current-password" value={importPassword} onChange={(event) => onImportPasswordChange(event.target.value)} placeholder={t("settings.importPassword")} />
        </label>
        <button type="button" className="settings-action" disabled={busy || !importPassword} onClick={onPreviewPassword}><UnlockKeyhole size={15} aria-hidden="true" />{t("settings.previewImport")}</button>
      </div>
    </div>
  }
  return <div className="import-preview-panel">
    <div className="import-preview-counts">
      <span>{t("settings.importHosts")} <strong>{preview.hosts.total}</strong></span>
      <span>{t("settings.importHostKeys")} <strong>{preview.hostKeys.total}</strong></span>
      {preview.forwardings && <span>{t("settings.importForwardings")} <strong>{preview.forwardings.total}</strong></span>}
      <span>{t("settings.importCredentials")} <strong>{preview.credentials.total}</strong></span>
    </div>
    {preview.hostConflicts.length > 0 && <div className="import-conflict-group">
      <strong>{t("settings.importHostConflicts")}</strong>
      {preview.hostConflicts.map((conflict) => <label className="import-conflict-row" key={conflict.id}><span>{conflict.name} <small>{conflict.username}@{conflict.host}:{conflict.port}</small></span><select aria-label={`${conflict.name} conflict action`} value={hostActions[conflict.id] ?? ""} onChange={(event) => onHostAction(conflict.id, event.target.value as HostConflictResolution)}><option value="">{t("settings.importSelectAction")}</option><option value="keep-local">{t("settings.keepLocal")}</option><option value="use-imported">{t("settings.useImported")}</option><option value="create-copy">{t("settings.createCopy")}</option><option value="skip">{t("settings.skip")}</option></select></label>)}
    </div>}
    {preview.hostKeyConflicts.length > 0 && <div className="import-conflict-group import-host-key-group">
      <strong>{t("settings.importHostKeyConflicts")}</strong>
      <p>{t("settings.importHostKeyWarning")}</p>
      {preview.hostKeyConflicts.map((conflict) => <label className="import-conflict-row" key={conflict.id}><span>{conflict.id}<small>{t("settings.local")}: SHA256:{conflict.localFingerprint}<br />{t("settings.imported")}: SHA256:{conflict.importedFingerprint}</small></span><select aria-label={`${conflict.id} Host Key action`} value={hostKeyActions[conflict.id] ?? ""} onChange={(event) => onHostKeyAction(conflict.id, event.target.value as HostKeyConflictResolution)}><option value="">{t("settings.importSelectAction")}</option><option value="keep-local">{t("settings.keepLocal")}</option><option value="replace-host-key">{t("settings.replaceHostKey")}</option><option value="skip">{t("settings.skip")}</option></select></label>)}
    </div>}
    {(preview.forwardingConflicts ?? []).length > 0 && <div className="import-conflict-group">
      <strong>{t("settings.importForwardingConflicts")}</strong>
      {(preview.forwardingConflicts ?? []).map((conflict) => <label className="import-conflict-row" key={conflict.id}><span>{conflict.name}<small>{conflict.hostId} / {conflict.localAddress}:{conflict.localPort} -&gt; {conflict.remoteAddress}:{conflict.remotePort}</small></span><select aria-label={`${conflict.name} forwarding action`} value={forwardingActions[conflict.id] ?? ""} onChange={(event) => onForwardingAction(conflict.id, event.target.value as ForwardingConflictResolution)}><option value="">{t("settings.importSelectAction")}</option><option value="keep-local">{t("settings.keepLocal")}</option><option value="use-imported">{t("settings.useImported")}</option><option value="create-copy">{t("settings.createCopy")}</option><option value="skip">{t("settings.skip")}</option></select></label>)}
    </div>}
    {preview.hostKeys.total > 0 && <label className="import-checkbox-row"><input type="checkbox" checked={importHostKeys} onChange={(event) => onImportHostKeysChange(event.target.checked)} />{t("settings.importHostKeys")}</label>}
    {preview.hasSettings && <label className="import-checkbox-row"><input type="checkbox" checked={applySettings} onChange={(event) => onApplySettingsChange(event.target.checked)} />{t("settings.importSettings")}</label>}
    {preview.credentials.total > 0 && <label className="import-checkbox-row"><input type="checkbox" checked={importCredentials} onChange={(event) => onImportCredentialsChange(event.target.checked)} />{t("settings.importStoredCredentials")}</label>}
    <button type="button" className="settings-action settings-action-primary" disabled={busy || !importReadyForPanel(preview, hostActions, hostKeyActions, forwardingActions, importHostKeys)} onClick={onApply}><CheckCircle2 size={15} aria-hidden="true" />{t("settings.applyImport")}</button>
  </div>
}

function importReadyForPanel(preview: ImportPreview, hostActions: Record<string, HostConflictResolution>, hostKeyActions: Record<string, HostKeyConflictResolution>, forwardingActions: Record<string, ForwardingConflictResolution>, importHostKeys: boolean): boolean {
  if (preview.requiresPassword) return false
  if (preview.hostConflicts.some((conflict) => hostActions[conflict.id] === undefined)) return false
  if (importHostKeys && preview.hostKeyConflicts.some((conflict) => hostKeyActions[conflict.id] === undefined)) return false
  if ((preview.forwardingConflicts ?? []).some((conflict) => forwardingActions[conflict.id] === undefined)) return false
  return true
}
