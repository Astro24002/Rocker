import { ArrowRightLeft, Clipboard, Download, ExternalLink, File, Folder, FolderOpen, Globe, Network, Pencil, Play, Plus, RefreshCw, Square, Trash2, Upload } from "lucide-react"
import { useCallback, useEffect, useState, type DragEvent, type ReactElement } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { ForwardingInfo, ForwardingProfileView, PortStatus } from "../../../electron/ports/types"
import type { ForwardingProfile } from "../../../electron/storage/types"
import type { SftpTransferTask } from "../../../electron/sftp/types"
import type { HostProfile } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import {
  forwardingToSessionState,
  isPortForwardingSession,
  isSftpSession,
  type ApplicationProtocol,
  type PortForwardingWorkspaceSession,
  type SftpDirectoryEntry,
  type SftpWorkspaceSession,
  type WorkspaceSessionPatch,
  type WorkspaceSession
} from "../terminal/session-state"

interface SessionContentViewProps {
  session: WorkspaceSession
  host?: HostProfile
  bridge: RockerBridge
  onPatch(sessionId: string, patch: WorkspaceSessionPatch): void
}

export function SessionContentView({ session, host, bridge, onPatch }: SessionContentViewProps): ReactElement {
  if (isSftpSession(session)) return <SftpSessionView session={session} host={host} bridge={bridge} onPatch={onPatch} />
  if (isPortForwardingSession(session)) return <PfSessionView session={session} host={host} bridge={bridge} onPatch={onPatch} />
  return <></>
}

function SftpSessionView({
  session,
  host,
  bridge,
  onPatch
}: {
  session: SftpWorkspaceSession
  host?: HostProfile
  bridge: RockerBridge
  onPatch(sessionId: string, patch: WorkspaceSessionPatch): void
}): ReactElement {
  const { t } = useI18n()
  const path = session.browser.path || "."
  const [draft, setDraft] = useState(path)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [transfers, setTransfers] = useState<SftpTransferTask[]>([])
  const [actionError, setActionError] = useState<string>()
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => {
    setDraft(path)
  }, [path, session.id])

  const refresh = useCallback(async (nextPath: string): Promise<void> => {
    onPatch(session.id, { kind: "sftp", browser: { path: nextPath, loading: true, error: undefined } })
    try {
      await bridge.sftp.open(session.id, session.hostId)
      const directory = await bridge.sftp.list(session.id, nextPath)
      onPatch(session.id, {
        kind: "sftp",
        state: "connected",
        browser: { path: directory.path, entries: directory.entries, loading: false, error: undefined }
      })
      setActionError(undefined)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      onPatch(session.id, { kind: "sftp", state: "error", browser: { loading: false, error: message } })
      setActionError(message)
    }
  }, [bridge, onPatch, session.hostId, session.id])

  useEffect(() => {
    void refresh(path)
  }, [path, refresh, refreshNonce])

  const refreshTransfers = useCallback((): void => {
    void bridge.sftp.listTransfers(session.id).then(setTransfers).catch(() => undefined)
  }, [bridge, session.id])

  useEffect(() => {
    refreshTransfers()
    const unsubscribe = bridge.events.onSftpEvent((event) => {
      if (event.kind === "transfer" && event.task.workspaceId === session.id) refreshTransfers()
      if (event.kind === "workspace" && event.workspace.workspaceId === session.id) {
        onPatch(session.id, { kind: "sftp", state: event.workspace.state === "ready" ? "connected" : "disconnected" })
      }
    })
    return unsubscribe
  }, [bridge, onPatch, refreshTransfers, session.id])

  const applyPath = (): void => {
    const next = normalizeSftpPath(draft)
    setDraft(next)
    onPatch(session.id, { kind: "sftp", browser: { path: next, error: undefined } })
  }

  const createDirectory = async (): Promise<void> => {
    const name = window.prompt(t("session.sftp.newFolderPrompt"))?.trim()
    if (!name) return
    const nextPath = `${path.replace(/\/$/, "")}/${name}`
    try {
      await bridge.sftp.mkdir(session.id, nextPath)
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const startUpload = async (localPath?: string): Promise<void> => {
    try {
      const selection = await bridge.sftp.chooseUpload(session.id, path, localPath)
      if (!selection) return
      let result = await bridge.sftp.upload(selection.selectionId)
      if (result.kind === "overwrite-required") {
        if (!window.confirm(t("session.sftp.overwritePrompt"))) return
        result = await bridge.sftp.upload(selection.selectionId, true)
      }
      if (result.kind === "started") refreshTransfers()
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const renameEntry = async (entry: SftpDirectoryEntry): Promise<void> => {
    const nextName = window.prompt(t("session.sftp.renamePrompt"), entry.name)?.trim()
    if (!nextName || nextName === entry.name) return
    if (nextName.includes("/") || nextName.includes("\u0000")) {
      setActionError(t("session.sftp.invalidName"))
      return
    }
    try {
      await bridge.sftp.rename(session.id, entry.path, joinSftpPath(path, nextName))
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const paths = Array.from(event.dataTransfer.files)
      .map(getDroppedFilePath)
      .filter((value): value is string => value !== undefined)
    if (paths.length === 0) {
      setActionError(t("session.sftp.dropUnsupported"))
      return
    }
    void (async (): Promise<void> => {
      for (const localPath of paths) await startUpload(localPath)
    })()
  }

  const startDownload = async (entry: SftpDirectoryEntry): Promise<void> => {
    try {
      const selection = await bridge.sftp.chooseDownload(session.id, entry.path, entry.name)
      if (!selection) return
      let result = await bridge.sftp.download(selection.selectionId)
      if (result.kind === "overwrite-required") {
        if (!window.confirm(t("session.sftp.overwritePrompt"))) return
        result = await bridge.sftp.download(selection.selectionId, true)
      }
      if (result.kind === "started") refreshTransfers()
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const removeEntry = async (entry: SftpDirectoryEntry): Promise<void> => {
    if (entry.type !== "file" && entry.type !== "directory") return
    const firstConfirmation = t("session.sftp.removePrompt").replace("{name}", entry.name)
    const secondConfirmation = t("session.sftp.removeConfirmAgain").replace("{name}", entry.name)
    if (!window.confirm(firstConfirmation) || !window.confirm(secondConfirmation)) return
    try {
      await bridge.sftp.remove(session.id, entry.path, entry.type)
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <section className="session-content-view sftp-session-view" data-session-kind="sftp" data-session-id={session.id}>
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("session.kind.sftp")}</span>
          <h1>{t("session.sftp.title")}</h1>
          <p>{host ? `${host.username}@${host.host}` : session.label}</p>
        </div>
        <div className="view-header-actions">
          <IconButton label={t("session.sftp.refresh")} onClick={() => setRefreshNonce((current) => current + 1)}><RefreshCw size={15} /></IconButton>
          <IconButton label={t("session.sftp.newFolder")} onClick={() => void createDirectory()}><Plus size={15} /></IconButton>
          <button className="primary-command" type="button" onClick={() => void startUpload()}><Upload size={14} />{t("session.sftp.upload")}</button>
        </div>
      </header>
      <div className="session-content-body">
        <label className="sftp-path-field">
          <span>{t("session.sftp.path")}</span>
          <span className="sftp-path-row">
            <input
              aria-label={t("session.sftp.path")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  applyPath()
                }
              }}
            />
            <button className="secondary-command" type="button" onClick={applyPath}>{t("session.sftp.browse")}</button>
          </span>
        </label>
        {session.browser.error || actionError ? <div className="inline-error">{session.browser.error ?? actionError}</div> : null}
        <div className="sftp-browser-toolbar">
          <button className="secondary-command" type="button" onClick={() => {
            const parent = parentSftpPath(path)
            setDraft(parent)
            onPatch(session.id, { kind: "sftp", browser: { path: parent, error: undefined } })
          }} disabled={path === "/"}>{t("session.sftp.parent")}</button>
          <code>{path}</code>
        </div>
        <div
          className={`sftp-browser-surface${dropActive ? " is-drop-active" : ""}`}
          role="region"
          aria-label={t("session.sftp.dropTarget")}
          onDragEnter={(event) => { event.preventDefault(); setDropActive(true) }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false) }}
          onDrop={handleDrop}
        >
          {session.browser.loading ? (
            <div className="port-empty"><FolderOpen aria-hidden="true" size={28} /><span>{t("session.sftp.loading")}</span></div>
          ) : session.browser.entries.length === 0 ? (
            <div className="port-empty"><FolderOpen aria-hidden="true" size={28} /><strong>{t("session.sftp.emptyTitle")}</strong><span>{t("session.sftp.emptyBody")}</span></div>
          ) : (
            <>
              <div className="sftp-directory-header" aria-hidden="true">
                <span>{t("session.sftp.column.name")}</span>
                <span>{t("session.sftp.column.modified")}</span>
                <span>{t("session.sftp.column.size")}</span>
                <span>{t("session.sftp.column.permissions")}</span>
                <span>{t("session.sftp.column.owner")}</span>
                <span />
                <span />
                <span />
              </div>
              <div className="sftp-directory-list" role="list">
                {session.browser.entries.map((entry) => (
                  <div className="sftp-directory-row" key={entry.path} role="listitem">
                    <button className="sftp-entry-main" type="button" onDoubleClick={() => openSftpDirectory(entry, session.id, onPatch, setDraft)} onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      openSftpDirectory(entry, session.id, onPatch, setDraft)
                    }} onClick={() => setDraft(entry.path)}>
                      {entry.type === "directory" ? <Folder aria-hidden="true" size={17} /> : <File aria-hidden="true" size={17} />}
                      <span>{entry.name}</span>
                    </button>
                    <span className="sftp-entry-meta">{formatModifiedAt(entry.modifiedAt)}</span>
                    <span className="sftp-entry-meta">{entry.type === "directory" ? t("session.sftp.folder") : formatFileSize(entry.size)}</span>
                    <span className="sftp-entry-meta">{formatPermissions(entry.permissions)}</span>
                    <span className="sftp-entry-meta">{formatOwner(entry.uid, entry.gid)}</span>
                    {entry.type === "file" ? <IconButton label={t("session.sftp.download")} onClick={() => void startDownload(entry)}><Download size={14} /></IconButton> : <span className="sftp-entry-spacer" />}
                    <IconButton label={t("session.sftp.rename")} onClick={() => void renameEntry(entry)}><Pencil size={14} /></IconButton>
                    <IconButton label={t("session.sftp.remove")} onClick={() => void removeEntry(entry)}><Trash2 size={14} /></IconButton>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {transfers.length > 0 ? (
          <div className="sftp-transfer-list">
            <h2>{t("session.sftp.transfers")}</h2>
            {transfers.map((task) => <SftpTransferRow key={task.id} task={task} bridge={bridge} onRefresh={refreshTransfers} />)}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function openSftpDirectory(
  entry: SftpDirectoryEntry,
  sessionId: string,
  onPatch: (sessionId: string, patch: WorkspaceSessionPatch) => void,
  setDraft: (path: string) => void
): void {
  if (entry.type !== "directory") return
  setDraft(entry.path)
  onPatch(sessionId, { kind: "sftp", browser: { path: entry.path, error: undefined } })
}

function SftpTransferRow({ task, bridge, onRefresh }: { task: SftpTransferTask; bridge: RockerBridge; onRefresh(): void }): ReactElement {
  const { t } = useI18n()
  const progress = task.totalBytes && task.totalBytes > 0 ? Math.min(100, Math.round(task.bytesTransferred / task.totalBytes * 100)) : undefined
  const statusLabel = task.status === "queued"
    ? t("session.sftp.transferStatus.queued")
      : task.status === "running"
        ? task.direction === "move" ? t("session.sftp.transferStatus.moving") : t("session.sftp.transferStatus.running")
      : task.status === "completed"
        ? t("session.sftp.transferStatus.completed")
        : task.status === "failed"
          ? t("session.sftp.transferStatus.failed")
          : t("session.sftp.transferStatus.cancelled")
  return (
    <div className="sftp-transfer-row">
      <span>{task.direction === "move" ? <ArrowRightLeft size={14} /> : task.direction === "upload" ? <Upload size={14} /> : <Download size={14} />}{task.name}</span>
      <span>{progress === undefined ? statusLabel : `${progress}%`}</span>
      {task.status === "queued" || task.status === "running" ? <IconButton label={t("session.sftp.cancelTransfer")} onClick={() => void bridge.sftp.cancelTransfer(task.id).then(onRefresh)}><Square size={13} /></IconButton> : null}
      {task.status === "failed" || task.status === "cancelled" ? <IconButton label={t("session.sftp.retryTransfer")} onClick={() => void bridge.sftp.retryTransfer(task.id).then(onRefresh)}><RefreshCw size={13} /></IconButton> : null}
    </div>
  )
}

function PfSessionView({
  session,
  host,
  bridge,
  onPatch
}: {
  session: PortForwardingWorkspaceSession
  host?: HostProfile
  bridge: RockerBridge
  onPatch(sessionId: string, patch: WorkspaceSessionPatch): void
}): ReactElement {
  const { t } = useI18n()
  const [row, setRow] = useState<ForwardingProfileView>()
  const [error, setError] = useState<string>()
  const protocol = session.applicationProtocol
  const showPreview = protocol === "http" || protocol === "https"

  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const rows = await loadForwardingRows(bridge, session.hostId)
        if (cancelled) return
        const match = rows.find((candidate) => candidate.profile.id === session.profileId)
        setRow(match)
        setError(undefined)
        if (!match) return
        const forwardingStatus = match.runtime?.status ?? "stopped"
        const forwardingId = match.runtime?.id
        const state = forwardingToSessionState(forwardingStatus)
        if (
          session.forwardingId === forwardingId
          && session.forwardingStatus === forwardingStatus
          && session.state === state
        ) return
        onPatch(session.id, {
          kind: "pf",
          forwardingId,
          forwardingStatus,
          state
        })
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void refresh()
    const unsubscribe = bridge.events.onForwardingEvent?.((event) => {
      if (event.profileId === session.profileId || event.hostId === session.hostId) void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [bridge, onPatch, session.forwardingId, session.forwardingStatus, session.hostId, session.id, session.profileId, session.state])

  const profile = row?.profile
  const runtime = row?.runtime
  const status = runtime?.status ?? session.forwardingStatus ?? "stopped"
  const localAddress = runtime ? formatAddress(runtime.localAddress, runtime.localPort) : profile ? formatAddress(profile.localAddress, profile.localPort) : "—"
  const remoteAddress = runtime
    ? `${runtime.remoteAddress}:${runtime.remotePort}`
    : profile
      ? `${profile.remoteAddress}:${profile.remotePort}`
      : "—"

  const start = async (): Promise<void> => {
    if (!session.profileId) return
    try {
      const next = await bridge.ports.startProfile(session.profileId)
      setRow((current) => current ? { ...current, runtime: next } : current)
      onPatch(session.id, {
        kind: "pf",
        forwardingId: next.id,
        forwardingStatus: next.status,
        state: forwardingToSessionState(next.status)
      })
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const stop = async (): Promise<void> => {
    const forwardingId = runtime?.id ?? session.forwardingId
    if (!forwardingId) return
    try {
      await bridge.ports.stop(forwardingId)
      const stopped: ForwardingInfo | undefined = runtime ? { ...runtime, status: "stopped" } : undefined
      setRow((current) => current ? { ...current, runtime: stopped } : current)
      onPatch(session.id, {
        kind: "pf",
        forwardingStatus: "stopped",
        state: "disconnected"
      })
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const setProtocol = (value: string): void => {
    const next: ApplicationProtocol | undefined = value === "http" || value === "https" ? value : undefined
    onPatch(session.id, { kind: "pf", applicationProtocol: next })
  }

  return (
    <section className="session-content-view pf-session-view" data-session-kind="pf" data-session-id={session.id}>
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("session.kind.pf")}</span>
          <h1>{showPreview ? t("session.pf.previewTitle") : t("session.pf.title")}</h1>
          <p>{host ? `${host.username}@${host.host}` : session.label}</p>
        </div>
        <div className="view-header-actions">
          {status === "forwarding" && runtime ? (
            <button className="secondary-command" type="button" onClick={() => void stop()}>
              <Square size={14} />{t("ports.stopForwarding")}
            </button>
          ) : (
            <button className="primary-command" type="button" onClick={() => void start()} disabled={!session.profileId}>
              <Play size={14} />{status === "suspended" ? t("ports.resumeForwarding") : t("ports.startForwarding")}
            </button>
          )}
        </div>
      </header>
      <div className="session-content-body">
        {error ? <div className="inline-error">{error}</div> : null}
        {!profile && !session.profileId ? (
          <div className="port-empty">
            <Network aria-hidden="true" size={28} />
            <strong>{t("session.pf.missingTitle")}</strong>
            <span>{t("session.pf.missingBody")}</span>
          </div>
        ) : (
          <>
            <dl className="session-forwarding-facts">
              <div><dt>{t("ports.rule")}</dt><dd>{profile?.name ?? session.label}</dd></div>
              <div><dt>{t("session.info.local")}</dt><dd><code>{localAddress}</code></dd></div>
              <div><dt>{t("session.info.remote")}</dt><dd><code>{remoteAddress}</code></dd></div>
              <div><dt>{t("ports.status")}</dt><dd className="port-status" data-status={status}>{t(statusKey(status))}</dd></div>
              <div>
                <dt>{t("session.info.protocol")}</dt>
                <dd>
                  <select aria-label={t("session.info.protocol")} value={protocol ?? ""} onChange={(event) => setProtocol(event.target.value)}>
                    <option value="">{t("session.protocol.unspecified")}</option>
                    <option value="http">{t("session.protocol.http")}</option>
                    <option value="https">{t("session.protocol.https")}</option>
                  </select>
                </dd>
              </div>
            </dl>
            {showPreview ? (
              <div className="session-preview-panel">
                <Globe aria-hidden="true" size={22} />
                <strong>{t("session.pf.previewTitle")}</strong>
                <p>{t("session.pf.previewBody")}</p>
                <code>{previewUrl(protocol, runtime ?? profile)}</code>
                <div className="session-preview-actions">
                  {runtime?.status === "forwarding" ? (
                    <>
                      <IconButton label={t("ports.copyAddress")} onClick={() => void navigator.clipboard?.writeText(localAddress)}><Clipboard size={14} /></IconButton>
                      <button className="primary-command" type="button" onClick={() => void bridge.ports.openAddress(runtime.id)}>
                        <ExternalLink size={14} />{t("ports.openAddress")}
                      </button>
                    </>
                  ) : (
                    <span>{t("session.pf.previewIdle")}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="port-empty">
                <Network aria-hidden="true" size={28} />
                <strong>{t("session.pf.infoTitle")}</strong>
                <span>{t("session.pf.infoBody")}</span>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

async function loadForwardingRows(bridge: RockerBridge, hostId: string): Promise<ForwardingProfileView[]> {
  if (bridge.ports.listForHost) return bridge.ports.listForHost(hostId)
  if (bridge.ports.listOverview) {
    const rows = await bridge.ports.listOverview()
    return rows.filter((row) => row.profile.hostId === hostId)
  }
  const runtimes = await bridge.ports.list()
  return runtimes.filter((runtime) => runtime.hostId === hostId).map((runtime) => ({
    profile: runtimeToFallbackProfile(runtime),
    runtime
  }))
}

function runtimeToFallbackProfile(runtime: ForwardingInfo): ForwardingProfile {
  const now = new Date(0).toISOString()
  return {
    id: runtime.profileId ?? runtime.id,
    hostId: runtime.hostId ?? "unknown",
    name: `${runtime.remoteAddress}:${runtime.remotePort}`,
    localAddress: runtime.localAddress === "::1" || runtime.localAddress === "0.0.0.0" ? runtime.localAddress : "127.0.0.1",
    localPort: runtime.localPort,
    remoteAddress: runtime.remoteAddress,
    remotePort: runtime.remotePort,
    autoStart: false,
    createdAt: now,
    updatedAt: now
  }
}

function formatAddress(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`
}

function previewUrl(protocol: ApplicationProtocol | undefined, target: { localAddress: string; localPort: number } | undefined): string {
  if (!protocol || !target) return "—"
  const host = target.localAddress === "0.0.0.0" || target.localAddress === "::" ? "127.0.0.1" : target.localAddress
  return `${protocol}://${host}:${target.localPort}`
}

function normalizeSftpPath(value: string): string {
  const trimmed = value.trim() || "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function parentSftpPath(value: string): string {
  const normalized = normalizeSftpPath(value)
  if (normalized === "/") return "/"
  const parent = normalized.slice(0, normalized.lastIndexOf("/"))
  return parent || "/"
}

function formatFileSize(size: number | undefined): string {
  if (size === undefined) return "-"
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${Math.round(size / 1_024)} KB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
}

function joinSftpPath(directory: string, name: string): string {
  const base = directory.replace(/\/$/, "")
  return `${base || "/"}/${name}`.replace(/^\/\//, "/")
}

function getDroppedFilePath(file: File): string | undefined {
  const candidate = file as File & { path?: unknown }
  return typeof candidate.path === "string" && candidate.path.trim().length > 0 ? candidate.path : undefined
}

function formatModifiedAt(value: string | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}

function formatPermissions(mode: number | undefined): string {
  if (mode === undefined) return "-"
  return (mode & 0o7777).toString(8).padStart(4, "0")
}

function formatOwner(uid: number | undefined, gid: number | undefined): string {
  if (uid === undefined && gid === undefined) return "-"
  return `${uid ?? "?"}:${gid ?? "?"}`
}

function statusKey(status: string): "ports.status.discovered" | "ports.status.starting" | "ports.status.forwarding" | "ports.status.suspended" | "ports.status.stopping" | "ports.status.stopped" | "ports.status.error" {
  if (status === "starting" || status === "forwarding" || status === "suspended" || status === "stopping" || status === "stopped" || status === "error" || status === "discovered") {
    return `ports.status.${status}`
  }
  return "ports.status.stopped"
}

export function forwardingStatusLabel(status: PortStatus | undefined): PortStatus {
  return status ?? "stopped"
}
