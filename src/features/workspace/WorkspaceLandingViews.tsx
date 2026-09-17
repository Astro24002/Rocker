import { FileCode2, FolderClosed, Server } from "lucide-react"
import type { ReactElement } from "react"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "../terminal/session-state"

interface HostWorkspacePickerProps {
  kind: "sftp" | "ports"
  hosts: readonly HostProfile[]
  onOpen(host: HostProfile): void
}

export function HostWorkspacePicker({ kind, hosts, onOpen }: HostWorkspacePickerProps): ReactElement {
  const { t } = useI18n()
  const isSftp = kind === "sftp"
  const Icon = isSftp ? FolderClosed : Server
  return <section className="workspace-picker-view">
    <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{isSftp ? t("nav.sftp") : t("nav.portForwarding")}</h1><p>{isSftp ? t("workspace.sftpPicker") : t("workspace.portsPicker")}</p></div></header>
    <div className="workspace-picker-list">
      {hosts.length === 0 ? <div className="port-empty"><Icon aria-hidden="true" size={28} /><strong>{t("workspace.noHosts")}</strong></div> : hosts.map((host) => <button className="workspace-picker-row" key={host.id} type="button" onClick={() => onOpen(host)}><Icon aria-hidden="true" size={16} /><span><strong>{host.name}</strong><small>SSH · {host.username}</small></span></button>)}
    </div>
  </section>
}

export function SnippetsView({ sessions, onSelect }: { sessions: readonly WorkspaceSession[]; onSelect(session: WorkspaceSession): void }): ReactElement {
  const { t } = useI18n()
  const sshSessions = sessions.filter((session) => (session.kind ?? "ssh") === "ssh")
  return <section className="workspace-picker-view snippets-view">
    <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{t("nav.snippets")}</h1><p>{t("workspace.snippetsPicker")}</p></div></header>
    <div className="workspace-picker-list">
      {sshSessions.length === 0 ? <div className="port-empty"><FileCode2 aria-hidden="true" size={28} /><strong>{t("workspace.noSshSession")}</strong><span>{t("workspace.noSshSessionBody")}</span></div> : sshSessions.map((session) => <button className="workspace-picker-row" key={session.id} type="button" onClick={() => onSelect(session)}><FileCode2 aria-hidden="true" size={16} /><span><strong>{session.label}</strong><small>{t("session.kind.ssh")}</small></span></button>)}
    </div>
  </section>
}
