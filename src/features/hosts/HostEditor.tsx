import { KeyRound, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { HostProfile } from "../../app/types"
import { IconButton } from "../../components/IconButton"

interface HostEditorProps {
  open: boolean
  profile?: HostProfile
  onClose(): void
  onSave(profile: HostProfile, credentials: { password?: string; passphrase?: string }): void
}

export function HostEditor({ open, profile, onClose, onSave }: HostEditorProps) {
  const [draft, setDraft] = useState<HostProfile>(() => profile ?? createEmptyHost())
  const [password, setPassword] = useState("")
  const [passphrase, setPassphrase] = useState("")

  useEffect(() => {
    setDraft(profile ?? createEmptyHost())
    setPassword("")
    setPassphrase("")
  }, [profile, open])

  if (!open) return null
  const update = <Key extends keyof HostProfile>(key: Key, value: HostProfile[Key]): void => setDraft((current) => ({ ...current, [key]: value }))

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <aside className="host-editor" aria-label={profile ? "Edit host" : "Add host"}>
        <header className="drawer-header">
          <div><span className="view-eyebrow">SSH profile</span><h2>{profile ? "Edit host" : "Add host"}</h2></div>
          <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
        </header>
        <form onSubmit={(event) => {
          event.preventDefault()
          onSave(draft, { password: password || undefined, passphrase: passphrase || undefined })
          setPassword("")
          setPassphrase("")
        }}>
          <div className="form-grid">
            <label className="field field-wide"><span>Name</span><input required value={draft.name} onChange={(event) => update("name", event.target.value)} autoFocus /></label>
            <label className="field field-wide"><span>Host</span><input required value={draft.host} onChange={(event) => update("host", event.target.value)} placeholder="server.example.com" /></label>
            <label className="field"><span>Port</span><input required min={1} max={65535} type="number" value={draft.port} onChange={(event) => update("port", Number(event.target.value))} /></label>
            <label className="field"><span>Username</span><input required value={draft.username} onChange={(event) => update("username", event.target.value)} /></label>
            <label className="field field-wide"><span>Authentication</span><select value={draft.authMethod} onChange={(event) => update("authMethod", event.target.value as HostProfile["authMethod"])}><option value="password">Password</option><option value="privateKey">Private key</option><option value="agent">SSH Agent</option></select></label>
            {draft.authMethod === "password" && <label className="field field-wide"><span>Password</span><div className="input-with-icon"><KeyRound size={14} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div></label>}
            {draft.authMethod === "privateKey" && <>
              <label className="field field-wide"><span>Private key path</span><input required value={draft.identityFile ?? ""} onChange={(event) => update("identityFile", event.target.value)} placeholder="~/.ssh/id_ed25519" /></label>
              <label className="field field-wide"><span>Passphrase</span><input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></label>
            </>}
            <label className="field field-wide"><span>Group</span><input value={draft.group ?? ""} onChange={(event) => update("group", event.target.value)} placeholder="Personal" /></label>
            <label className="field field-wide"><span>Notes</span><textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
          </div>
          <footer className="drawer-footer"><button className="secondary-command" type="button" onClick={onClose}>Cancel</button><button className="primary-command" type="submit">Save host</button></footer>
        </form>
      </aside>
    </div>
  )
}

function createEmptyHost(): HostProfile {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "",
    port: 22,
    username: "",
    authMethod: "password",
    group: "Personal",
    favorite: false,
    notes: ""
  }
}
