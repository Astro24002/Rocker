import { KeyRound, Palette, Server, ShieldCheck, X } from "lucide-react"
import { useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from "react"
import type { BootstrapHostProfile, HostSaveProfile } from "../../../electron/ipc/bridge-contract"
import type { HostProfile } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"

type HostEditorProfile = HostProfile | BootstrapHostProfile

interface HostEditorProps {
  open: boolean
  profile?: HostEditorProfile
  onClose(): void
  onSave(profile: HostSaveProfile, credentials: { password?: string; passphrase?: string }): void | Promise<void>
}

export function HostEditor({ open, profile, onClose, onSave }: HostEditorProps): ReactElement | null {
  const { t } = useI18n()
  const [draft, setDraft] = useState<HostProfile>(() => draftFromProfile(profile))
  const [password, setPassword] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [keyPath, setKeyPath] = useState("")
  const [publicKeyEnabled, setPublicKeyEnabled] = useState(() => isPublicKeyEnabled(profile))
  const [nonKeyAuthMethod, setNonKeyAuthMethod] = useState<"password" | "agent">(() => profile?.authMethod === "agent" ? "agent" : "password")
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    setDraft(draftFromProfile(profile))
    setPassword("")
    setPassphrase("")
    setKeyPath("")
    setPublicKeyEnabled(isPublicKeyEnabled(profile))
    setNonKeyAuthMethod(profile?.authMethod === "agent" ? "agent" : "password")
    setIsSaving(false)
    setSaveError(false)
  }, [profile, open])

  if (!open) return null

  const update = <Key extends keyof HostProfile>(key: Key, value: HostProfile[Key]): void => {
    setSaveError(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const togglePublicKey = (enabled: boolean): void => {
    setSaveError(false)
    setPublicKeyEnabled(enabled)
    if (enabled) setPassword("")
    else setPassphrase("")
    setDraft((current) => ({
      ...current,
      publicKeyEnabled: enabled,
      authMethod: enabled ? "privateKey" : nonKeyAuthMethod,
      ...(enabled ? {} : { identityFile: undefined })
    }))
    if (!enabled) setKeyPath("")
  }

  const updateAuthMethod = (value: "password" | "agent"): void => {
    setSaveError(false)
    setNonKeyAuthMethod(value)
    setPassword("")
    setPassphrase("")
    setDraft((current) => ({ ...current, authMethod: value, publicKeyEnabled: false, identityFile: undefined }))
    setPublicKeyEnabled(false)
    setKeyPath("")
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (isSaving) return
    setSaveError(false)
    setIsSaving(true)
    const saved = buildSaveProfile(draft, {
      keyPath,
      publicKeyEnabled,
      hasExistingKey: hasExistingKey(profile),
      snippetsEnabled: draft.snippetsEnabled === true
    })
    const credentials = {
      ...(!publicKeyEnabled && nonKeyAuthMethod === "password" && password ? { password } : {}),
      ...(publicKeyEnabled && passphrase ? { passphrase } : {})
    }
    setPassword("")
    setPassphrase("")
    setKeyPath("")
    try {
      await onSave(saved, credentials)
    } catch {
      setSaveError(true)
    } finally {
      setIsSaving(false)
    }
  }

  const title = profile ? t("hosts.editor.editTitle") : t("hosts.editor.addTitle")
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <aside className="host-editor" aria-label={title}>
        <header className="drawer-header host-editor-header">
          <div>
            <span className="view-eyebrow">{t("hosts.editor.eyebrow")}</span>
            <h2>{title}</h2>
            <p>{profile ? t("hosts.editor.editHint") : t("hosts.editor.addHint")}</p>
          </div>
          <IconButton label={t("hosts.editor.close")} onClick={onClose}><X size={17} /></IconButton>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid host-editor-grid">
            <EditorSection icon={<Server size={15} />} title={t("hosts.editor.identity")}>
              <Field label={t("hosts.editor.label")} wide>
                <input required maxLength={256} value={draft.name} onChange={(event) => update("name", event.target.value)} autoFocus />
              </Field>
              <Field label={t("hosts.editor.address")} wide>
                <input required maxLength={512} value={draft.host} onChange={(event) => update("host", event.target.value)} placeholder="server.example.com" />
              </Field>
              <Field label={t("hosts.editor.platform")}>
                <select value={draft.platform ?? ""} onChange={(event) => update("platform", event.target.value ? event.target.value as NonNullable<HostProfile["platform"]> : undefined)}>
                  <option value="">{t("hosts.editor.platformDefault")}</option>
                  <option value="ubuntu">Ubuntu</option>
                  <option value="debian">Debian</option>
                  <option value="linux">Linux</option>
                </select>
              </Field>
            </EditorSection>

            <EditorSection icon={<ShieldCheck size={15} />} title={t("hosts.editor.sshConnection")}>
              <Field label={t("hosts.editor.port")}>
                <input required min={1} max={65535} type="number" value={draft.port} onChange={(event) => update("port", Number(event.target.value))} />
              </Field>
              <Field label={t("hosts.editor.username")}>
                <input required maxLength={256} value={draft.username} onChange={(event) => update("username", event.target.value)} />
              </Field>
              <Field label={t("hosts.editor.authentication")} wide>
                <select value={publicKeyEnabled ? "privateKey" : nonKeyAuthMethod} onChange={(event) => {
                  const value = event.target.value
                  if (value === "privateKey") togglePublicKey(true)
                  else updateAuthMethod(value as "password" | "agent")
                }}>
                  <option value="password">{t("hosts.editor.passwordAuth")}</option>
                  <option value="agent">{t("hosts.editor.sshAgent")}</option>
                  <option value="privateKey">{t("hosts.editor.publicKeyAuth")}</option>
                </select>
              </Field>
              {!publicKeyEnabled && nonKeyAuthMethod === "password" && <Field label={t("hosts.editor.password")} wide hint={t("hosts.editor.passwordHint")}>
                <div className="input-with-icon input-with-leading-icon"><KeyRound size={14} /><input aria-label={t("hosts.editor.password")} type="password" value={password} onChange={(event) => { setPassword(event.target.value); setSaveError(false) }} autoComplete="new-password" /></div>
              </Field>}
              <ToggleField
                label={t("hosts.editor.publicKeyLogin")}
                description={publicKeyEnabled ? t("hosts.editor.publicKeyEnabled") : t("hosts.editor.publicKeyOptional")}
                checked={publicKeyEnabled}
                onChange={togglePublicKey}
                wide
              />
              {publicKeyEnabled && <>
                <Field label={t("hosts.editor.setKey")} wide hint={hasExistingKey(profile) && !keyPath ? t("hosts.editor.keyPreserve") : undefined}>
                  <input aria-label={t("hosts.editor.setKey")} maxLength={4096} required={!hasExistingKey(profile)} value={keyPath} onChange={(event) => { setKeyPath(event.target.value); setSaveError(false) }} placeholder={t("hosts.editor.keyPlaceholder")} />
                </Field>
                <Field label={t("hosts.editor.passphrase")} wide hint={t("hosts.editor.passphraseHint")}>
                  <input aria-label={t("hosts.editor.passphrase")} type="password" value={passphrase} onChange={(event) => { setPassphrase(event.target.value); setSaveError(false) }} autoComplete="new-password" />
                </Field>
              </>}
            </EditorSection>

            <EditorSection icon={<Palette size={15} />} title={t("hosts.editor.terminalPreferences")}>
              <ToggleField
                label={t("hosts.editor.snippets")}
                description={draft.snippetsEnabled ? t("hosts.editor.snippetsEnabled") : t("hosts.editor.snippetsOptional")}
                checked={draft.snippetsEnabled === true}
                onChange={(enabled) => update("snippetsEnabled", enabled)}
                wide
              />
              {draft.snippetsEnabled && <Field label={t("hosts.editor.snippetCollection")} wide>
                <input required maxLength={256} value={draft.snippetCollection ?? ""} onChange={(event) => update("snippetCollection", event.target.value)} placeholder={t("hosts.editor.snippetPlaceholder")} />
              </Field>}
              <Field label={t("hosts.editor.charset")}>
                <select value={draft.charset ?? "utf-8"} onChange={(event) => update("charset", event.target.value as HostProfile["charset"])}>
                  <option value="utf-8">UTF-8</option>
                  <option value="gb18030">GB18030</option>
                  <option value="iso-8859-1">ISO-8859-1</option>
                </select>
              </Field>
              <Field label={t("hosts.editor.themeColor")}>
                <div className="theme-select-wrap"><span className={`theme-swatch theme-swatch-${draft.themeColor ?? "rocker"}`} aria-hidden="true" /><select aria-label={t("hosts.editor.themeColor")} value={draft.themeColor ?? "rocker"} onChange={(event) => update("themeColor", event.target.value as HostProfile["themeColor"])}>
                  <option value="rocker">{t("hosts.editor.themeRocker")}</option>
                  <option value="amber">{t("hosts.editor.themeAmber")}</option>
                  <option value="ocean">{t("hosts.editor.themeOcean")}</option>
                  <option value="slate">{t("hosts.editor.themeSlate")}</option>
                </select></div>
              </Field>
              <Field label={t("hosts.editor.notes")} wide>
                <textarea rows={3} maxLength={10000} value={draft.notes} onChange={(event) => update("notes", event.target.value)} />
              </Field>
              <p className="host-editor-security"><ShieldCheck size={14} />{t("hosts.editor.securityHint")}</p>
            </EditorSection>
          </div>
          <footer className="drawer-footer host-editor-footer">
            {saveError && <p className="inline-error" role="status">{t("hosts.editor.saveError")}</p>}
            <div className="host-editor-actions">
              <button className="secondary-command" type="button" onClick={onClose} disabled={isSaving}>{t("hosts.editor.cancel")}</button>
              <button className="primary-command" type="submit" disabled={isSaving}>{isSaving ? t("hosts.editor.saving") : profile ? t("hosts.editor.saveChanges") : t("hosts.editor.saveHost")}</button>
            </div>
          </footer>
        </form>
      </aside>
    </div>
  )
}

function EditorSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }): ReactElement {
  return <section className="host-editor-section"><div className="host-editor-section-title">{icon}<h3>{title}</h3></div><div className="host-editor-section-grid">{children}</div></section>
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: ReactNode }): ReactElement {
  return <label className={`field${wide ? " field-wide" : ""}`}><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>
}

function ToggleField({ label, description, checked, onChange, wide }: { label: string; description: string; checked: boolean; onChange(value: boolean): void; wide?: boolean }): ReactElement {
  return <div className={`editor-toggle-field${wide ? " field-wide" : ""}`}><div><strong>{label}</strong><small>{description}</small></div><label className="editor-switch"><input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" /></label></div>
}

function draftFromProfile(profile?: HostEditorProfile): HostProfile {
  const source = profile as (HostProfile & { hasIdentityFile?: boolean }) | undefined
  const { identityFile: _identityFile, ...safeProfile } = source ?? {}
  return {
    ...createEmptyHost(),
    ...safeProfile,
    charset: profile?.charset ?? "utf-8",
    themeColor: profile?.themeColor ?? "rocker",
    publicKeyEnabled: isPublicKeyEnabled(profile),
    snippetsEnabled: profile?.snippetsEnabled === true
  }
}

function buildSaveProfile(draft: HostProfile, options: { keyPath: string; publicKeyEnabled: boolean; hasExistingKey: boolean; snippetsEnabled: boolean }): HostSaveProfile {
  const { identityFile: _identityFile, hasIdentityFile: _hasIdentityFile, snippetCollection: _snippetCollection, group: _group, environment: _environment, tags: _tags, ...safeDraft } = draft as HostProfile & { hasIdentityFile?: boolean }
  const base = {
    ...safeDraft,
    authMethod: options.publicKeyEnabled ? "privateKey" as const : draft.authMethod === "privateKey" ? "password" as const : draft.authMethod,
    publicKeyEnabled: options.publicKeyEnabled,
    snippetsEnabled: options.snippetsEnabled,
    charset: draft.charset ?? "utf-8",
    themeColor: draft.themeColor ?? "rocker"
  }
  const withSnippets = options.snippetsEnabled
    ? { ...base, snippetCollection: draft.snippetCollection?.trim() ?? "" }
    : base
  if (options.publicKeyEnabled && options.keyPath.trim()) return { ...withSnippets, identityFile: options.keyPath.trim() }
  if (options.publicKeyEnabled && options.hasExistingKey) return { ...withSnippets, hasIdentityFile: true }
  return withSnippets
}

function isPublicKeyEnabled(profile?: HostEditorProfile): boolean {
  return profile?.publicKeyEnabled === true || profile?.authMethod === "privateKey"
}

function hasExistingKey(profile?: HostEditorProfile): boolean {
  if (!profile) return false
  const source = profile as HostProfile & { hasIdentityFile?: boolean }
  return Boolean(source.identityFile || source.hasIdentityFile === true)
}

function createEmptyHost(): HostProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "",
    port: 22,
    username: "",
    authMethod: "password",
    publicKeyEnabled: false,
    snippetsEnabled: false,
    charset: "utf-8",
    themeColor: "rocker",
    favorite: false,
    notes: ""
  }
}
