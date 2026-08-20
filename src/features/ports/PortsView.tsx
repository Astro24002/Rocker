import { Clipboard, ExternalLink, Play, RefreshCw, Square } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { AppSettings, DiscoveredPort, ForwardingInfo, PortStatus } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "../terminal/session-state"
import { applyDiscoveredPorts, applyForwarding, createPortState, setPortError, setPortLoading } from "./port-state"

interface PortsViewProps {
  bridge: RockerBridge
  connectionId?: string
  session?: WorkspaceSession
  username?: string
  bindAddress?: AppSettings["bindAddress"]
}

export function PortsView({ bridge, connectionId, session, username, bindAddress = "127.0.0.1" }: PortsViewProps) {
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
