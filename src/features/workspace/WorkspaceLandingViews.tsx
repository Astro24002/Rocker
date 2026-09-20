import { FileCode2 } from "lucide-react"
import type { ReactElement } from "react"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "../terminal/session-state"

export { SftpWorkspacePage as SftpWorkspaceView } from "../sftp/SftpWorkspacePage"

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
