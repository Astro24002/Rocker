import { Clipboard, ExternalLink, Play, RefreshCw, Square } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { DiscoveredPort, ForwardingInfo } from "../../app/types"
import { IconButton } from "../../components/IconButton"
import { useI18n } from "../../i18n"
import type { TerminalTab } from "../terminal/session-state"
import { applyDiscoveredPorts, applyForwarding, createPortState, setPortError, setPortLoading } from "./port-state"

interface PortsViewProps {
  bridge: RockerBridge
  session?: TerminalTab
  username?: string
}

export function PortsView({ bridge, session, username }: PortsViewProps) {
  const { t } = useI18n()
  const [state, setState] = useState(createPortState)
  const [localPorts, setLocalPorts] = useState<Record<string, number>>({})
  const sessionId = session?.sessionId

  const scan = async (): Promise<void> => {
    if (!sessionId) return
    setState((current) => setPortLoading(current, true))
    try {
      const [ports, forwardings] = await Promise.all([bridge.ports.scan(sessionId), bridge.ports.list()])
      setState((current) => forwardings.reduce((next, forwarding) => applyForwarding(next, forwarding), applyDiscoveredPorts(current, ports)))
      setLocalPorts((current) => ({ ...Object.fromEntries(ports.map((port) => [port.id, current[port.id] ?? port.remotePort])) }))
    } catch (error) {
      setState((current) => setPortError(current, error instanceof Error ? error.message : String(error)))
    }
  }

  useEffect(() => {
    void scan()
  }, [sessionId])

  const forwardingByPort = useMemo(() => new Map(state.forwardings
    .filter((forwarding) => forwarding.sessionId === sessionId && forwarding.status !== "stopped")
    .map((forwarding) => [forwarding.remotePort, forwarding])), [state.forwardings, sessionId])

  const startForwarding = async (port: DiscoveredPort): Promise<void> => {
    if (!sessionId) return
    try {
      const forwarding = await bridge.ports.start(sessionId, {
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
        <div><span className="view-eyebrow">Rocker / {session?.label ?? t("workspace.personal")}</span><h1>{t("ports.title")}</h1><p>Discover remote services and forward only the ports you need.</p></div>
        <button className="secondary-command" type="button" disabled={!sessionId || state.loading} onClick={() => void scan()}><RefreshCw size={15} className={state.loading ? "is-spinning" : ""} />Scan ports</button>
      </header>
      {!sessionId ? (
        <div className="port-empty"><strong>No connected host</strong><span>Open an SSH session to discover listening ports.</span></div>
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
          {state.ports.length === 0 && !state.loading && <div className="port-empty"><strong>No listening ports found</strong><span>The terminal remains available even when discovery is unsupported.</span></div>}
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
