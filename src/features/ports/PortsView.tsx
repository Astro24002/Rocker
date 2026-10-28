import { AlertTriangle, Check, ChevronDown, ChevronUp, Clipboard, ExternalLink, Eye, Pause, Pencil, Play, Plus, RefreshCw, Server, Share2, Square, Trash2, X } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { ForwardingProfileRequest, ForwardingProfileView } from "../../../electron/ports/types"
import type { ForwardingProfile } from "../../../electron/storage/types"
import type { AppSettings, DiscoveredPort, ForwardingInfo, HostProfile, PortStatus } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import { isPortForwardingSession, type WorkspaceSession } from "../terminal/session-state"
import { forwardingSshCommand } from "./forwarding-command"
import { applyDiscoveredPorts, applyForwarding, createPortState, setPortError, setPortLoading } from "./port-state"

interface PortsViewProps {
  bridge: RockerBridge
  mode?: "global" | "host"
  hostId?: string
  hostName?: string
  connectionId?: string
  session?: WorkspaceSession
  username?: string
  bindAddress?: AppSettings["bindAddress"]
  hosts?: readonly HostProfile[]
  onOpenSession?(profile: ForwardingProfile, runtime?: ForwardingInfo): void
  onProfileRemoved?(profileId: string): void
}

export function PortsView(props: PortsViewProps) {
  if (props.mode === "global") return <GlobalPortsView {...props} />
  if (props.mode === "host") return <HostPortsView {...props} />
  return <LegacyPortsView {...props} />
}

function LegacyPortsView({ bridge, connectionId, session, username, bindAddress = "127.0.0.1" }: PortsViewProps) {
  const { t } = useI18n()
  const [state, setState] = useState(createPortState)
  const [localPorts, setLocalPorts] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    void bridge.ports.list().then((forwardings) => {
      if (!cancelled) setState((current) => ({ ...current, forwardings }))
    }).catch((error) => {
      if (!cancelled) setState((current) => setPortError(current, error instanceof Error ? error.message : String(error)))
    })
    return () => { cancelled = true }
  }, [bridge])

  const scan = async (): Promise<void> => {
    if (!connectionId) return
    setState((current) => setPortLoading(current, true))
    try {
      const [ports, forwardings] = await Promise.all([bridge.ports.scan(connectionId), bridge.ports.list()])
      setState((current) => forwardings.reduce((next, forwarding) => applyForwarding(next, forwarding), applyDiscoveredPorts(current, ports)))
      setLocalPorts((current) => ({ ...Object.fromEntries(ports.map((port) => [port.id, current[port.id] ?? port.remotePort])) }))
    } catch (error) {
      setState((current) => setPortError(current, error instanceof Error ? error.message : String(error)))
    }
  }

  const forwardingByPort = useMemo(() => new Map(state.forwardings
    .filter((forwarding) => forwarding.connectionId === connectionId && forwarding.status !== "stopped")
    .map((forwarding) => [forwarding.remotePort, forwarding])), [state.forwardings, connectionId])
  const standaloneForwardings = useMemo(() => state.forwardings
    .filter((forwarding) => forwarding.status !== "stopped")
    .filter((forwarding) => !state.ports.some((port) =>
      forwarding.connectionId === connectionId && forwarding.remotePort === port.remotePort
    )), [connectionId, state.forwardings, state.ports])

  const startForwarding = async (port: DiscoveredPort): Promise<void> => {
    if (!connectionId) return
    try {
      const forwarding = await bridge.ports.start(connectionId, {
        localAddress: bindAddress,
        localPort: localPorts[port.id] ?? port.remotePort,
        remoteAddress: normalizeRemoteAddress(port.remoteAddress),
        remotePort: port.remotePort
      })
      setState((current) => applyForwarding(current, forwarding))
    } catch (error) {
      setState((current) => setPortError(current, error instanceof Error ? error.message : String(error)))
    }
  }

  const resumeForwarding = async (forwarding: ForwardingInfo): Promise<void> => {
    try {
      const resumed = await bridge.ports.resume(forwarding.id)
      setState((current) => applyForwarding(current, resumed))
    } catch (error) {
      setState((current) => setPortError(current, error instanceof Error ? error.message : String(error)))
    }
  }

  const stopForwarding = async (forwarding: ForwardingInfo): Promise<void> => {
    await bridge.ports.stop(forwarding.id)
    setState((current) => applyForwarding(current, { ...forwarding, status: "stopped" }))
  }

  return (
    <section className="ports-view">
      <header className="view-header">
        <div><span className="view-eyebrow">Rocker / {session?.label ?? t("workspace.personal")}</span><h1>{t("ports.title")}</h1><p>{t("ports.subtitle")}</p></div>
        <button className="secondary-command" type="button" disabled={!connectionId || state.loading} onClick={() => void scan()}><RefreshCw size={15} className={state.loading ? "is-spinning" : ""} />{t("ports.scan")}</button>
      </header>
      <div className="ports-content">
        {state.error && <div className="inline-error">{formatPortError(state.error, t("ports.localPortInUse"))}</div>}
        {standaloneForwardings.length > 0 && <div className="ports-table">
          <div className="ports-heading"><span>{t("ports.port")}</span><span>{t("ports.forwardedAddress")}</span><span>{t("ports.process")}</span><span>{t("ports.source")}</span><span>{t("ports.user")}</span><span>{t("ports.status")}</span><span /></div>
          {standaloneForwardings.map((forwarding) => {
            const address = formatAddress(forwarding.localAddress, forwarding.localPort)
            return (
              <div key={forwarding.id} className="port-row">
                <code>:{forwarding.localPort}</code>
                <code>{address}</code>
                <span>{forwarding.remoteAddress}:{forwarding.remotePort}</span>
                <span className="source-label">SSH</span>
                <span>{username ?? "-"}</span>
                <span className="port-status" data-status={forwarding.status}>{t(statusKey(forwarding.status))}</span>
                <div className="port-actions">
                  {forwarding.status === "suspended" ? <>
                    <IconButton label={t("ports.resumeForwarding")} onClick={() => void resumeForwarding(forwarding)}><Play size={14} /></IconButton>
                    <IconButton label={t("ports.stopForwarding")} onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>
                  </> : forwarding.status === "forwarding" ? <>
                    <IconButton label={t("ports.copyAddress")} onClick={() => void navigator.clipboard?.writeText(address)}><Clipboard size={14} /></IconButton>
                    <IconButton label={t("ports.openAddress")} onClick={() => void bridge.ports.openAddress(forwarding.id)}><ExternalLink size={14} /></IconButton>
                    <IconButton label={t("ports.stopForwarding")} onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>
                  </> : <IconButton label={t("ports.stopForwarding")} onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>}
                </div>
              </div>
            )
          })}
        </div>}
        {!connectionId ? (
          <div className="port-empty"><strong>{t("ports.noConnection")}</strong><span>{t("ports.noConnectionBody")}</span></div>
        ) : (
          <>
          <div className="ports-table">
            <div className="ports-heading"><span>{t("ports.port")}</span><span>{t("ports.forwardedAddress")}</span><span>{t("ports.process")}</span><span>{t("ports.source")}</span><span>{t("ports.user")}</span><span>{t("ports.status")}</span><span /></div>
            {state.ports.map((port) => {
              const forwarding = forwardingByPort.get(port.remotePort)
              const address = forwarding ? `${forwarding.localAddress}:${forwarding.localPort}` : t("ports.addressUnset")
              return (
                <div key={port.id} className="port-row">
                  <div className="port-input"><span>:</span><input aria-label={`${t("ports.localPort")} ${port.remotePort}`} type="number" min={1} max={65535} disabled={Boolean(forwarding)} value={localPorts[port.id] ?? port.remotePort} onChange={(event) => setLocalPorts((current) => ({ ...current, [port.id]: Number(event.target.value) }))} /></div>
                  <code>{address}</code>
                  <span>{port.process ?? t("ports.unknown")}{port.pid ? <small>{t("ports.pid")} {port.pid}</small> : null}</span>
                  <span className="source-label">{port.source}</span>
                  <span>{port.user ?? username ?? "-"}</span>
                  <span className="port-status" data-status={forwarding?.status ?? "discovered"}>{t(statusKey(forwarding?.status ?? "discovered"))}</span>
                  <div className="port-actions">
                    {forwarding?.status === "suspended" ? <>
                      <IconButton label={t("ports.resumeForwarding")} onClick={() => void resumeForwarding(forwarding)}><Play size={14} /></IconButton>
                      <IconButton label={t("ports.stopForwarding")} onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>
                    </> : forwarding ? <>
                      <IconButton label={t("ports.copyAddress")} onClick={() => void navigator.clipboard?.writeText(address)}><Clipboard size={14} /></IconButton>
                      <IconButton label={t("ports.openAddress")} onClick={() => void bridge.ports.openAddress(forwarding.id)}><ExternalLink size={14} /></IconButton>
                      <IconButton label={t("ports.stopForwarding")} onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>
                    </> : <IconButton label={t("ports.forwardPort")} onClick={() => void startForwarding(port)}><Play size={14} /></IconButton>}
                  </div>
                </div>
              )
            })}
          </div>
          {state.ports.length === 0 && !state.loading && <div className="port-empty"><strong>{t("ports.idleTitle")}</strong><span>{t("ports.idleBody")}</span></div>}
          </>
        )}
      </div>
    </section>
  )
}

function compareForwardingPorts(a: ForwardingProfileView, b: ForwardingProfileView): number {
  return a.profile.localPort - b.profile.localPort
    || a.profile.remotePort - b.profile.remotePort
    || a.profile.id.localeCompare(b.profile.id)
}

function GlobalPortsView({ bridge, hosts, onOpenSession, onProfileRemoved }: PortsViewProps) {
  const { t } = useI18n()
  const [rows, setRows] = useState<ForwardingProfileView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [expandedHosts, setExpandedHosts] = useState<Record<string, boolean>>({})
  const [busyProfileId, setBusyProfileId] = useState<string>()
  const [copiedProfileId, setCopiedProfileId] = useState<string>()

  useEffect(() => {
    if (!copiedProfileId) return
    const timeout = window.setTimeout(() => setCopiedProfileId(undefined), 2000)
    return () => window.clearTimeout(timeout)
  }, [copiedProfileId])

  const groups = useMemo(() => {
    const byHost = new Map<string, ForwardingProfileView[]>()
    for (const row of rows) {
      const hostRows = byHost.get(row.profile.hostId) ?? []
      hostRows.push(row)
      byHost.set(row.profile.hostId, hostRows)
    }
    const createdAt = (row: ForwardingProfileView): number => Date.parse(row.profile.createdAt) || 0
    return [...byHost.entries()].map(([hostId, profiles]) => ({
      hostId,
      newestCreatedAt: Math.max(...profiles.map(createdAt)),
      profiles: profiles.sort(compareForwardingPorts)
    })).sort((a, b) => b.newestCreatedAt - a.newestCreatedAt || a.hostId.localeCompare(b.hostId))
  }, [rows])

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      if (bridge.ports.listOverview) setRows(await bridge.ports.listOverview())
      else setRows((await bridge.ports.list()).map((runtime) => ({
        profile: runtimeToFallbackProfile(runtime),
        runtime
      })))
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const unsubscribe = bridge.events?.onForwardingEvent?.(() => { void refresh() })
    return () => unsubscribe?.()
  }, [bridge])

  const restart = async (profile: ForwardingProfile): Promise<void> => {
    setBusyProfileId(profile.id)
    try {
      const runtime = await bridge.ports.startProfile(profile.id)
      setRows((current) => current.map((row) => row.profile.id === profile.id ? { ...row, runtime } : row))
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyProfileId(undefined)
    }
  }

  const pause = async (profile: ForwardingProfile, runtime: ForwardingInfo): Promise<void> => {
    setBusyProfileId(profile.id)
    try {
      await bridge.ports.stop(runtime.id)
      setRows((current) => current.map((row) => row.runtime?.id === runtime.id ? { ...row, runtime: { ...runtime, status: "stopped" } } : row))
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyProfileId(undefined)
    }
  }

  const removeProfile = async (profile: ForwardingProfile): Promise<void> => {
    if (!window.confirm(t("ports.removeConfirm").replace("{name}", profile.name))) return
    setBusyProfileId(profile.id)
    try {
      await bridge.ports.removeProfile(profile.id)
      setRows((current) => current.filter((row) => row.profile.id !== profile.id))
      onProfileRemoved?.(profile.id)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyProfileId(undefined)
    }
  }

  const share = async (command: string, profileId: string): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t("ports.shareFailed"))
      await navigator.clipboard.writeText(command)
      setCopiedProfileId(profileId)
      setError(undefined)
    } catch {
      setError(t("ports.shareFailed"))
    }
  }

  return (
    <section className="ports-view ports-overview-view" data-mode="global">
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("nav.portForwarding")}</span>
          <h1>{t("ports.title")}</h1>
          <p>{t("ports.globalSubtitle")}</p>
        </div>
        <button className="secondary-command" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} className={loading ? "is-spinning" : ""} />{t("ports.refreshOverview")}
        </button>
      </header>
      <div className="ports-content">
        {error && <div className="inline-error">{error}</div>}
        {rows.length > 0 ? (
          <div className="ports-overview-groups">
            {groups.map(({ hostId, profiles }) => {
              const host = hosts?.find((candidate) => candidate.id === hostId)
              const expanded = expandedHosts[hostId] ?? false
              return <section className="ports-overview-group" key={hostId} aria-label={host?.name ?? hostId}>
                <header className="ports-overview-host-header">
                  <Server size={17} aria-hidden="true" />
                  <h2 title={host?.name ?? hostId}>{host?.name ?? hostId}</h2>
                </header>
                <div className="ports-card-grid">
                  {(expanded ? profiles : profiles.slice(0, 2)).map(({ profile, runtime }) => {
                    const status = runtime?.status ?? "stopped"
                    const command = host ? forwardingSshCommand(profile, host) : undefined
                    const transitioning = status === "starting" || status === "stopping"
                    const busy = busyProfileId === profile.id || transitioning
                    return <ForwardingRuleCard key={profile.id} profile={profile} status={status} actions={<>
                        <IconButton label={t("ports.viewDetails")} disabled={!onOpenSession} onClick={() => onOpenSession?.(profile, runtime)}><Eye size={15} /></IconButton>
                        {status === "forwarding" || transitioning
                          ? <IconButton label={t("ports.pauseForwarding")} disabled={busy || !runtime} onClick={() => { if (runtime) void pause(profile, runtime) }}><Pause size={15} /></IconButton>
                          : <IconButton label={t("ports.startForwarding")} disabled={busy} onClick={() => void restart(profile)}><Play size={15} /></IconButton>}
                        <IconButton label={t("ports.removeProfile")} disabled={busy} onClick={() => void removeProfile(profile)}><Trash2 size={15} /></IconButton>
                        <IconButton label={command ? (copiedProfileId === profile.id ? t("ports.shareCopied") : t("ports.shareCommand")) : t("ports.shareUnavailable")} disabled={!command} onClick={() => { if (command) void share(command, profile.id) }}>
                          {copiedProfileId === profile.id ? <Check size={15} /> : <Share2 size={15} />}
                        </IconButton>
                      </>} />
                  })}
                </div>
                {profiles.length > 2 && <button className="ports-overview-disclosure" type="button" aria-expanded={expanded} onClick={() => setExpandedHosts((current) => ({ ...current, [hostId]: !current[hostId] }))}>
                  {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                  {expanded ? t("ports.showLess") : t("ports.showMore").replace("{count}", String(profiles.length - 2))}
                </button>}
              </section>
            })}
          </div>
        ) : !loading ? (
          <div className="port-empty"><strong>{t("ports.globalEmptyTitle")}</strong><span>{t("ports.globalEmptyBody")}</span></div>
        ) : <div className="port-empty"><strong>{t("ports.loading")}</strong></div>}
      </div>
    </section>
  )
}

interface HostForwardingFormState {
  name: string
  description: string
  localAddress: "127.0.0.1" | "::1" | "0.0.0.0"
  localPort: string
  remoteAddress: string
  remotePort: string
}

function ForwardingRuleCard({ profile, status, actions }: {
  profile: ForwardingProfile
  status: PortStatus
  actions: ReactNode
}) {
  const { t } = useI18n()
  const localAddress = formatAddress(profile.localAddress, profile.localPort)
  const remoteAddress = formatAddress(profile.remoteAddress, profile.remotePort)
  return <article className="forwarding-rule-card" aria-label={profile.name}>
    <header className="forwarding-card-header">
      <div className="forwarding-card-title">
        <span className="forwarding-card-state" data-status={status} title={t(statusKey(status))} aria-hidden="true" />
        <strong className="forwarding-card-port" aria-label={`${t("ports.remotePort")}: ${profile.remotePort}`}>{profile.remotePort}</strong>
      </div>
      <div className="forwarding-card-toolbar">
        <span className="port-status" data-status={status}>{t(statusKey(status))}</span>
        <div className="port-actions forwarding-card-actions">{actions}</div>
      </div>
    </header>
    <dl className="forwarding-card-route">
      <div><dt>{t("ports.cardName")}</dt><dd><span title={profile.name}>{profile.name}</span></dd></div>
      <div><dt>{t("session.info.local")}</dt><dd><code>{localAddress}</code></dd></div>
      <div><dt>{t("session.info.remote")}</dt><dd><code>{remoteAddress}</code></dd></div>
    </dl>
  </article>
}

function HostPortsView({ bridge, hostId, hostName, connectionId, session, username, hosts, bindAddress = "127.0.0.1", onOpenSession, onProfileRemoved }: PortsViewProps) {
  const { t } = useI18n()
  const canCreateProfile = Boolean(hostId && session)
  const [rows, setRows] = useState<ForwardingProfileView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<ForwardingProfile>()
  const [form, setForm] = useState<HostForwardingFormState>(() => emptyForwardingForm(bindAddress))
  const [saving, setSaving] = useState(false)
  const [discoveredPorts, setDiscoveredPorts] = useState<DiscoveredPort[]>([])
  const [scanning, setScanning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string>()
  const [detailId, setDetailId] = useState<string>()
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({})
  const [copiedProfileId, setCopiedProfileId] = useState<string>()
  const detail = rows.find((row) => row.profile.id === detailId)
  const host = hosts?.find((candidate) => candidate.id === hostId)
  const workspaceId = isPortForwardingSession(session) ? session.id : undefined

  useEffect(() => {
    if (!copiedProfileId) return
    const timeout = window.setTimeout(() => setCopiedProfileId(undefined), 2000)
    return () => window.clearTimeout(timeout)
  }, [copiedProfileId])

  useEffect(() => {
    if (!workspaceId || !hostId) return
    let cancelled = false
    setConnecting(true)
    setConnectionError(undefined)
    void bridge.ports.openWorkspace(workspaceId, hostId).catch((reason: unknown) => {
      if (!cancelled) setConnectionError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!cancelled) setConnecting(false) })
    // Explicit Session close and main-process owner cleanup release the lease.
    return () => { cancelled = true }
  }, [bridge, workspaceId, hostId])

  const refresh = async (): Promise<void> => {
    if (!hostId) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (bridge.ports.listForHost) setRows(await bridge.ports.listForHost(hostId))
      else setRows((await bridge.ports.list()).filter((runtime) => runtime.hostId === hostId).map((runtime) => ({ profile: runtimeToFallbackProfile(runtime), runtime })))
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const unsubscribe = bridge.events?.onForwardingEvent?.((event) => {
      if (event.hostId === undefined || event.hostId === hostId) void refresh()
    })
    return () => unsubscribe?.()
  }, [bridge, hostId])

  const openNew = (): void => {
    if (!canCreateProfile) return
    setEditing(undefined)
    setForm(emptyForwardingForm(bindAddress))
    setError(undefined)
    setEditorOpen(true)
  }

  const openEdit = (profile: ForwardingProfile): void => {
    setEditing(profile)
    setForm({
      name: profile.name,
      description: profile.description ?? "",
      localAddress: profile.localAddress,
      localPort: String(profile.localPort),
      remoteAddress: profile.remoteAddress,
      remotePort: String(profile.remotePort)
    })
    setError(undefined)
    setEditorOpen(true)
  }

  const updateField = <K extends keyof HostForwardingFormState>(key: K, value: HostForwardingFormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const toRequest = (): ForwardingProfileRequest | undefined => {
    const localPort = Number(form.localPort)
    const remotePort = Number(form.remotePort)
    if (!form.name.trim()) {
      setError(t("ports.profileNameRequired"))
      return undefined
    }
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      setError(t("ports.invalidPort"))
      return undefined
    }
    if (!form.remoteAddress.trim()) {
      setError(t("ports.remoteAddressRequired"))
      return undefined
    }
    return {
      name: form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      localAddress: form.localAddress,
      localPort,
      remoteAddress: form.remoteAddress.trim(),
      remotePort
    }
  }

  const saveProfile = async (startAfterSave: boolean): Promise<void> => {
    if (!hostId || !canCreateProfile || saving) return
    const request = toRequest()
    if (!request) return
    setSaving(true)
    try {
      const profile = editing
        ? await bridge.ports.updateProfile(editing.id, request)
        : await bridge.ports.createProfile(hostId, request)
      let runtime = rows.find((row) => row.profile.id === profile.id)?.runtime
      if (startAfterSave) {
        runtime = await bridge.ports.startProfile(profile.id)
        setRows((current) => {
          const next = current.filter((row) => row.profile.id !== profile.id)
          return [...next, { profile, runtime }]
        })
      } else {
        setRows((current) => {
          const next = current.filter((row) => row.profile.id !== profile.id)
          return [...next, { profile, runtime: current.find((row) => row.profile.id === profile.id)?.runtime }]
        })
      }
      onOpenSession?.(profile, runtime)
      setEditorOpen(false)
      setError(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const startProfile = async (profile: ForwardingProfile): Promise<void> => {
    try {
      const runtime = await bridge.ports.startProfile(profile.id)
      setRows((current) => current.map((row) => row.profile.id === profile.id ? { ...row, runtime } : row))
      onOpenSession?.(profile, runtime)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setProfileErrors((current) => ({ ...current, [profile.id]: message }))
      setError(message)
      void refresh()
    }
  }

  const stopRuntime = async (runtime: ForwardingInfo): Promise<void> => {
    try {
      await bridge.ports.stop(runtime.id)
      setRows((current) => current.map((row) => row.runtime?.id === runtime.id ? { ...row, runtime: { ...runtime, status: "stopped" } } : row))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const removeProfile = async (profile: ForwardingProfile): Promise<void> => {
    if (!window.confirm(t("ports.removeConfirm").replace("{name}", profile.name))) return
    try {
      await bridge.ports.removeProfile(profile.id)
      setRows((current) => current.filter((row) => row.profile.id !== profile.id))
      onProfileRemoved?.(profile.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const scan = async (): Promise<void> => {
    if ((!workspaceId && !connectionId) || scanning || connecting) return
    setScanning(true)
    setError(undefined)
    setConnectionError(undefined)
    try {
      if (workspaceId && hostId) await bridge.ports.openWorkspace(workspaceId, hostId)
      setDiscoveredPorts(await bridge.ports.scan(workspaceId ? { workspaceId } : connectionId!))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setScanning(false)
    }
  }

  const quickForward = (port: DiscoveredPort): void => {
    setEditing(undefined)
    setForm({
      ...emptyForwardingForm(bindAddress),
      name: port.process ? `${port.process} :${port.remotePort}` : `Port ${port.remotePort}`,
      remoteAddress: normalizeRemoteAddress(port.remoteAddress),
      remotePort: String(port.remotePort),
      localPort: String(port.remotePort)
    })
    setEditorOpen(true)
  }

  return (
    <section className="ports-view ports-host-view" data-mode="host">
      <header className="view-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("nav.portForwarding")} / {hostName ?? session?.label ?? t("ports.hostWorkspace")}</span>
          <h1>{t("ports.hostTitle")}</h1>
          <p>{t("ports.hostSubtitle")}</p>
        </div>
        <div className="view-header-actions">
          <button className="secondary-command" type="button" onClick={() => void scan()} disabled={(!workspaceId && !connectionId) || scanning || connecting}>
            <RefreshCw size={15} className={scanning || connecting ? "is-spinning" : ""} />{connecting ? t("ports.connecting") : t("ports.scan")}
          </button>
          <button className="primary-command" type="button" onClick={openNew} disabled={!canCreateProfile}>
            <Plus size={15} />{t("ports.newForwarding")}
          </button>
        </div>
      </header>
      <div className="ports-content">
        <div className="ports-host-context">
          <Server size={16} aria-hidden="true" />
          <div className="ports-host-context-copy">
            <strong>{hostName ?? session?.label ?? t("ports.hostWorkspace")}</strong>
          </div>
          {username && <small>{username}</small>}
        </div>
        {error && <div className="inline-error">{error}</div>}
        {connectionError && <div className="inline-error" role="alert">{connectionError}</div>}
        {rows.length > 0 ? <div className="ports-card-grid">
          {[...rows].sort(compareForwardingPorts).map(({ profile, runtime }) => {
            const status = runtime?.status ?? "stopped"
            const command = host ? forwardingSshCommand(profile, host) : undefined
            const transitioning = status === "starting" || status === "stopping"
            return <ForwardingRuleCard key={profile.id} profile={profile} status={status} actions={<>
                <IconButton label={t("ports.viewDetails")} onClick={() => setDetailId(profile.id)}><Eye size={15} /></IconButton>
                {status === "forwarding" || transitioning
                  ? <IconButton label={t("ports.pauseForwarding")} disabled={transitioning || !runtime} onClick={() => { if (runtime) void stopRuntime(runtime) }}><Pause size={15} /></IconButton>
                  : <IconButton label={status === "suspended" ? t("ports.resumeForwarding") : t("ports.startForwarding")} onClick={() => void startProfile(profile)}><Play size={15} /></IconButton>}
                <IconButton label={t("ports.removeProfile")} onClick={() => void removeProfile(profile)}><Trash2 size={14} /></IconButton>
                <IconButton label={command ? (copiedProfileId === profile.id ? t("ports.shareCopied") : t("ports.shareCommand")) : t("ports.shareUnavailable")} disabled={!command} onClick={() => { if (!command || !navigator.clipboard?.writeText) { setError(t("ports.shareFailed")); return }; void navigator.clipboard.writeText(command).then(() => setCopiedProfileId(profile.id)).catch(() => setError(t("ports.shareFailed"))) }}>{copiedProfileId === profile.id ? <Check size={15} /> : <Share2 size={15} />}</IconButton>
              </>} />
          })}
        </div> : !loading ? <div className="port-empty"><strong>{t("ports.hostEmptyTitle")}</strong><span>{t("ports.hostEmptyBody")}</span></div> : <div className="port-empty"><strong>{t("ports.loading")}</strong></div>}
        {discoveredPorts.length > 0 && <section className="ports-discovery" aria-label={t("ports.discoveredTitle")}>
          <h2 className="ports-section-label">{t("ports.discoveredTitle")}</h2>
          <div className="ports-card-grid ports-discovery-grid">{discoveredPorts.map((port) => <article className="port-discovery-card" key={port.id}>
            <div className="port-discovery-info"><strong title={port.process ?? t("ports.unknown")}>{port.process ?? t("ports.unknown")}</strong><code>{formatAddress(port.remoteAddress, port.remotePort)}</code></div>
            <button className="secondary-command compact-command" type="button" onClick={() => quickForward(port)}><Play size={14} aria-hidden="true" />{t("ports.forwardPort")}</button>
          </article>)}</div>
        </section>}
      </div>
      {detail && <div className="forwarding-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailId(undefined) }}>
        <div className="forwarding-editor" role="dialog" aria-modal="true" aria-label={t("ports.viewDetails")}>
          <div className="forwarding-editor-header"><h2>{detail.profile.name}</h2><IconButton label={t("hosts.editor.close")} onClick={() => setDetailId(undefined)}><X size={14} /></IconButton></div>
          <div className="forwarding-detail-content">
            {detail.profile.description && <p>{detail.profile.description}</p>}
            <dl className="forwarding-card-route"><div><dt>{t("session.info.local")}</dt><dd><code>{formatAddress(detail.profile.localAddress, detail.profile.localPort)}</code></dd></div><div><dt>{t("session.info.remote")}</dt><dd><code>{formatAddress(detail.profile.remoteAddress, detail.profile.remotePort)}</code></dd></div></dl>
            <h3>{t("ports.log")}</h3><div className="forwarding-detail-log" role="log">{detail.runtime?.error || profileErrors[detail.profile.id] ? formatPortError(detail.runtime?.error ?? profileErrors[detail.profile.id], t("ports.localPortInUse")) : t("ports.noLogEntries")}</div>
          </div>
          <div className="forwarding-editor-actions">
            {onOpenSession && <button className="secondary-command" type="button" onClick={() => { setDetailId(undefined); onOpenSession(detail.profile, detail.runtime) }}>{t("session.open")}</button>}
            {detail.runtime?.status === "forwarding" && <><IconButton label={t("ports.copyAddress")} onClick={() => void navigator.clipboard?.writeText(formatAddress(detail.runtime!.localAddress, detail.runtime!.localPort))}><Clipboard size={14} /></IconButton><IconButton label={t("ports.openAddress")} onClick={() => void bridge.ports.openAddress(detail.runtime!.id)}><ExternalLink size={14} /></IconButton></>}
            <button className="secondary-command" type="button" onClick={() => { setDetailId(undefined); openEdit(detail.profile) }}><Pencil size={14} />{t("ports.editProfile")}</button>
          </div>
        </div>
      </div>}
      {editorOpen && <div className="forwarding-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false) }}>
        <div className="forwarding-editor" role="dialog" aria-modal="true" aria-labelledby="forwarding-editor-title">
          <div className="forwarding-editor-header"><div><span className="view-eyebrow">{t("ports.editorEyebrow")}</span><h2 id="forwarding-editor-title">{editing ? t("ports.editTitle") : t("ports.newTitle")}</h2></div><IconButton label={t("hosts.editor.close")} onClick={() => setEditorOpen(false)}><X size={14} /></IconButton></div>
          <div className="forwarding-form">
            <label><span>{t("ports.profileName")}</span><input aria-label={t("ports.profileName")} value={form.name} onChange={(event) => updateField("name", event.target.value)} autoFocus /></label>
            <label><span>{t("ports.description")}</span><textarea aria-label={t("ports.description")} value={form.description} onChange={(event) => updateField("description", event.target.value)} /></label>
            <div className="forwarding-form-grid">
              <label><span>{t("ports.localAddress")}</span><select aria-label={t("ports.localAddress")} value={form.localAddress} onChange={(event) => updateField("localAddress", event.target.value as HostForwardingFormState["localAddress"])}><option value="127.0.0.1">127.0.0.1</option><option value="::1">::1</option><option value="0.0.0.0">0.0.0.0</option></select></label>
              <label><span>{t("ports.localPortLabel")}</span><input aria-label={t("ports.localPortLabel")} type="number" min={1} max={65535} value={form.localPort} onChange={(event) => updateField("localPort", event.target.value)} /></label>
              <label><span>{t("ports.remoteAddress")}</span><input aria-label={t("ports.remoteAddress")} value={form.remoteAddress} onChange={(event) => updateField("remoteAddress", event.target.value)} /></label>
              <label><span>{t("ports.remotePort")}</span><input aria-label={t("ports.remotePort")} type="number" min={1} max={65535} value={form.remotePort} onChange={(event) => updateField("remotePort", event.target.value)} /></label>
            </div>
            {form.localAddress === "0.0.0.0" && <div className="forwarding-exposure-warning"><AlertTriangle size={15} /><span>{t("ports.exposureWarning")}</span></div>}
          </div>
          <div className="forwarding-editor-actions"><button className="secondary-command" type="button" onClick={() => setEditorOpen(false)}>{t("hosts.editor.close")}</button><button className="secondary-command" type="button" disabled={saving} onClick={() => void saveProfile(false)}>{t("ports.saveProfile")}</button><button className="primary-command" type="button" disabled={saving} onClick={() => void saveProfile(true)}><Play size={14} />{t("ports.saveAndStart")}</button></div>
        </div>
      </div>}
    </section>
  )
}

function emptyForwardingForm(bindAddress: PortsViewProps["bindAddress"] = "127.0.0.1"): HostForwardingFormState {
  return { name: "", description: "", localAddress: bindAddress ?? "127.0.0.1", localPort: "8080", remoteAddress: "127.0.0.1", remotePort: "8080" }
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

function normalizeRemoteAddress(address: string): string {
  return address === "0.0.0.0" || address === "::" || address === "*" ? "127.0.0.1" : address
}

function formatPortError(error: string, localPortInUse: string): string {
  return error.includes("LOCAL_PORT_IN_USE") ? localPortInUse : error
}

function formatAddress(address: string, port: number): string {
  return address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`
}

function statusKey(status: PortStatus): "ports.status.discovered" | "ports.status.starting" | "ports.status.forwarding" | "ports.status.suspended" | "ports.status.stopping" | "ports.status.stopped" | "ports.status.error" {
  return `ports.status.${status}`
}
