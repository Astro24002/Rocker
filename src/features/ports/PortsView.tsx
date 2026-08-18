import { Clipboard, ExternalLink, Play, RefreshCw, Square } from "lucide-react"
import { useMemo, useState } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { DiscoveredPort, ForwardingInfo } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "../terminal/session-state"
import { applyDiscoveredPorts, applyForwarding, createPortState, setPortError, setPortLoading } from "./port-state"

interface PortsViewProps {
  bridge: RockerBridge
  session?: WorkspaceSession
  username?: string
}

export function PortsView({ bridge, session, username }: PortsViewProps) {
  const { t } = useI18n()
  const [state, setState] = useState(createPortState)
  const [localPorts, setLocalPorts] = useState<Record<string, number>>({})
  const connectionId = session?.connectionId

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

  const startForwarding = async (port: DiscoveredPort): Promise<void> => {
    if (!connectionId) return
    try {
      const forwarding = await bridge.ports.start(connectionId, {
        localAddress: "127.0.0.1",
        localPort: localPorts[port.id] ?? port.remotePort,
        remoteAddress: normalizeRemoteAddress(port.remoteAddress),
        remotePort: port.remotePort
      })
      setState((current) => applyForwarding(current, forwarding))
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
      {!connectionId ? (
        <div className="port-empty"><strong>{t("ports.noConnection")}</strong><span>{t("ports.noConnectionBody")}</span></div>
      ) : (
        <div className="ports-content">
          {state.error && <div className="inline-error">{formatPortError(state.error)}</div>}
          <div className="ports-table">
            <div className="ports-heading"><span>Port</span><span>Forwarded address</span><span>Process</span><span>Source</span><span>User</span><span>Status</span><span /></div>
            {state.ports.map((port) => {
              const forwarding = forwardingByPort.get(port.remotePort)
              const address = forwarding ? `${forwarding.localAddress}:${forwarding.localPort}` : "—"
              return (
                <div key={port.id} className="port-row">
                  <div className="port-input"><span>:</span><input aria-label={`Local port for ${port.remotePort}`} type="number" min={1} max={65535} disabled={Boolean(forwarding)} value={localPorts[port.id] ?? port.remotePort} onChange={(event) => setLocalPorts((current) => ({ ...current, [port.id]: Number(event.target.value) }))} /></div>
                  <code>{address}</code>
                  <span>{port.process ?? "Unknown"}{port.pid ? <small>PID {port.pid}</small> : null}</span>
                  <span className="source-label">{port.source}</span>
                  <span>{port.user ?? username ?? "—"}</span>
                  <span className="port-status" data-status={forwarding?.status ?? "discovered"}>{forwarding?.status ?? "discovered"}</span>
                  <div className="port-actions">
                    {forwarding ? <>
                      <IconButton label="Copy address" onClick={() => void navigator.clipboard?.writeText(address)}><Clipboard size={14} /></IconButton>
                      <IconButton label="Open address" onClick={() => void bridge.ports.openAddress(forwarding.id)}><ExternalLink size={14} /></IconButton>
                      <IconButton label="Stop forwarding" onClick={() => void stopForwarding(forwarding)}><Square size={13} /></IconButton>
                    </> : <IconButton label="Forward port" onClick={() => void startForwarding(port)}><Play size={14} /></IconButton>}
                  </div>
                </div>
              )
            })}
          </div>
          {state.ports.length === 0 && !state.loading && <div className="port-empty"><strong>{t("ports.idleTitle")}</strong><span>{t("ports.idleBody")}</span></div>}
        </div>
      )}
    </section>
  )
}

function normalizeRemoteAddress(address: string): string {
  return address === "0.0.0.0" || address === "::" || address === "*" ? "127.0.0.1" : address
}

function formatPortError(error: string): string {
  return error.includes("LOCAL_PORT_IN_USE") ? "That local port is already in use. Choose another port and try again." : error
}
