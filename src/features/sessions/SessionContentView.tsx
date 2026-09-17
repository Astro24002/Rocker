import { Clipboard, ExternalLink, FolderOpen, Globe, Network, Play, Square } from "lucide-react"
import { useEffect, useState, type ReactElement } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { ForwardingInfo, ForwardingProfileView, PortStatus } from "../../../electron/ports/types"
import type { ForwardingProfile } from "../../../electron/storage/types"
import type { HostProfile } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import {
  forwardingToSessionState,
  isPortForwardingSession,
  isSftpSession,
  type ApplicationProtocol,
  type PortForwardingWorkspaceSession,
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
  if (isSftpSession(session)) return <SftpSessionView session={session} host={host} onPatch={onPatch} />
  if (isPortForwardingSession(session)) return <PfSessionView session={session} host={host} bridge={bridge} onPatch={onPatch} />
  return <></>
}

function SftpSessionView({
  session,
  host,
  onPatch
}: {
  session: SftpWorkspaceSession
  host?: HostProfile
  onPatch(sessionId: string, patch: WorkspaceSessionPatch): void
}): ReactElement {
  const { t } = useI18n()
  const path = session.browser.path
  const [draft, setDraft] = useState(path)

  useEffect(() => {
    setDraft(path)
  }, [path, session.id])

  const applyPath = (): void => {
    const next = normalizeSftpPath(draft)
    setDraft(next)
    onPatch(session.id, { kind: "sftp", browser: { path: next, error: undefined } })
  }

  return (
    <section className="session-content-view sftp-session-view" data-session-kind="sftp" data-session-id={session.id}>
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("session.kind.sftp")}</span>
          <h1>{t("session.sftp.title")}</h1>
          <p>{host ? `${host.username}@${host.host}` : session.label}</p>
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
        {session.browser.error ? <div className="inline-error">{session.browser.error}</div> : null}
        <div className="port-empty sftp-deferred">
          <FolderOpen aria-hidden="true" size={28} />
          <strong>{t("session.sftp.deferredTitle")}</strong>
          <span>{t("session.sftp.deferredBody")}</span>
          <code>{path}</code>
        </div>
      </div>
    </section>
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
          session.label === match.profile.name
          && session.forwardingId === forwardingId
          && session.forwardingStatus === forwardingStatus
          && session.state === state
        ) return
        onPatch(session.id, {
          kind: "pf",
          label: match.profile.name,
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
  }, [bridge, onPatch, session.forwardingId, session.forwardingStatus, session.hostId, session.id, session.label, session.profileId, session.state])

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

function statusKey(status: string): "ports.status.discovered" | "ports.status.starting" | "ports.status.forwarding" | "ports.status.suspended" | "ports.status.stopping" | "ports.status.stopped" | "ports.status.error" {
  if (status === "starting" || status === "forwarding" || status === "suspended" || status === "stopping" || status === "stopped" || status === "error" || status === "discovered") {
    return `ports.status.${status}`
  }
  return "ports.status.stopped"
}

export function forwardingStatusLabel(status: PortStatus | undefined): PortStatus {
  return status ?? "stopped"
}
