import { AlertTriangle, LoaderCircle, RotateCw, X } from "lucide-react"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "./session-state"

interface TerminalConnectionOverlayProps {
  session?: WorkspaceSession
  onCancel(): void
  onReconnectNow(): void
}

export function TerminalConnectionOverlay({ session, onCancel, onReconnectNow }: TerminalConnectionOverlayProps) {
  const { t } = useI18n()
  if (!session || session.state === "idle" || session.state === "connected" || session.state === "closing") return null

  const isRetrying = session.state === "reconnecting"
  const isPassive = session.state === "connecting" || session.state === "restoring"
  const title = session.state === "restoring"
    ? t("terminal.restoring")
    : session.state === "connecting"
      ? t("terminal.connecting")
      : isRetrying
        ? t("terminal.reconnecting")
        : t("terminal.connectionError")
  const detail = session.reason === "configuration"
    ? t("terminal.hostUnavailable")
    : isRetrying && session.attempt
      ? `${t("terminal.reconnectAttempt")} ${session.attempt}`
      : undefined

  return (
    <section className="terminal-connection-overlay" data-state={session.state} role="status">
      {isPassive || isRetrying ? <LoaderCircle aria-hidden="true" className="is-spinning" size={15} /> : <AlertTriangle aria-hidden="true" size={15} />}
      <div className="terminal-connection-copy"><strong>{title}</strong>{detail && <span>{detail}</span>}</div>
      {isRetrying && <div className="terminal-connection-actions"><button aria-label={t("terminal.cancelReconnect")} className="terminal-overlay-button" type="button" onClick={onCancel}><X size={13} /><span>{t("terminal.cancelReconnect")}</span></button><button aria-label={t("terminal.reconnectNow")} className="terminal-overlay-button terminal-overlay-primary" type="button" onClick={onReconnectNow}><RotateCw size={13} /><span>{t("terminal.reconnectNow")}</span></button></div>}
      {!isPassive && !isRetrying && <button aria-label={t("terminal.reconnect")} className="terminal-overlay-button terminal-overlay-primary" type="button" onClick={onReconnectNow}><RotateCw size={13} /><span>{t("terminal.reconnect")}</span></button>}
    </section>
  )
}
