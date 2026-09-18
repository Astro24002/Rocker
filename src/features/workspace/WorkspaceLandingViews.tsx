import { FileCode2, FolderClosed, Server } from "lucide-react"
import { useEffect, useState, type ReactElement } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { SftpTransferTask } from "../../../electron/sftp/types"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "../terminal/session-state"

interface HostWorkspacePickerProps {
  kind: "sftp" | "ports"
  hosts: readonly HostProfile[]
  onOpen(host: HostProfile): void
  bridge?: RockerBridge
}

export function HostWorkspacePicker({ kind, hosts, onOpen, bridge }: HostWorkspacePickerProps): ReactElement {
  const { t } = useI18n()
  const isSftp = kind === "sftp"
  const Icon = isSftp ? FolderClosed : Server
  const [transfers, setTransfers] = useState<SftpTransferTask[]>([])

  useEffect(() => {
    if (!isSftp || !bridge) return
    const refresh = (): void => { void bridge.sftp.listTransfers().then(setTransfers).catch(() => undefined) }
    refresh()
    return bridge.events.onSftpEvent((event) => {
      if (event.kind === "transfer") refresh()
    })
  }, [bridge, isSftp])

  return <section className="workspace-picker-view">
    <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{isSftp ? t("nav.sftp") : t("nav.portForwarding")}</h1><p>{isSftp ? t("workspace.sftpPicker") : t("workspace.portsPicker")}</p></div></header>
    {isSftp && transfers.length > 0 ? <div className="sftp-transfer-overview">
      <div className="sftp-transfer-overview-heading"><strong>{t("session.sftp.transfers")}</strong><span>{transfers.length}</span></div>
      {transfers.map((task) => <div className="sftp-transfer-overview-row" key={task.id}><span>{task.name}</span><small>{transferStatusLabel(t, task.status)}</small></div>)}
    </div> : null}
    <div className="workspace-picker-list">
      {hosts.length === 0 ? <div className="port-empty"><Icon aria-hidden="true" size={28} /><strong>{t("workspace.noHosts")}</strong></div> : hosts.map((host) => <button className="workspace-picker-row" key={host.id} type="button" onClick={() => onOpen(host)}><Icon aria-hidden="true" size={16} /><span><strong>{host.name}</strong><small>SSH · {host.username}</small></span></button>)}
    </div>
  </section>
}

function transferStatusLabel(t: ReturnType<typeof useI18n>["t"], status: SftpTransferTask["status"]): string {
  if (status === "queued") return t("session.sftp.transferStatus.queued")
  if (status === "running") return t("session.sftp.transferStatus.running")
  if (status === "completed") return t("session.sftp.transferStatus.completed")
  if (status === "failed") return t("session.sftp.transferStatus.failed")
  return t("session.sftp.transferStatus.cancelled")
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
