import { AlertTriangle, LoaderCircle, RotateCw, X } from "lucide-react"
import { useI18n } from "../../i18n"
import type { WorkspaceSession } from "./session-state"
import { getTerminalFailurePresentation } from "./terminal-error"

interface TerminalConnectionOverlayProps {
  session?: WorkspaceSession
  onCancel(): void
  onReconnectNow(): void
  onClose?(): void
}

export function TerminalConnectionOverlay({ session, onCancel, onReconnectNow, onClose = onCancel }: TerminalConnectionOverlayProps) {
  const { t } = useI18n()
  if (!session || session.state === "idle" || session.state === "connected" || session.state === "closing") return null

  const presentation = getTerminalFailurePresentation(session.state, session.reason)
  const isRetrying = session.state === "reconnecting"
  const isPassive = session.state === "connecting" || session.state === "restoring"
  const cancelLabel = session.state === "connecting" ? t("terminal.cancelConnection") : t("terminal.cancelReconnect")
  const detail = presentation.detailKey ? t(presentation.detailKey as Parameters<typeof t>[0]) : undefined
  const attempt = isRetrying && session.attempt ? `${t("terminal.reconnectAttempt")} ${session.attempt}` : undefined

  return (
    <section className="terminal-connection-overlay" data-severity={presentation.severity} data-state={session.state} role="status">
      {isPassive || isRetrying ? <LoaderCircle aria-hidden="true" className="is-spinning" size={15} /> : <AlertTriangle aria-hidden="true" size={15} />}
      <div className="terminal-connection-copy"><strong>{t(presentation.titleKey as Parameters<typeof t>[0])}</strong>{detail && <span>{detail}</span>}{attempt && <span>{attempt}</span>}</div>
      <div className="terminal-connection-actions">
        {presentation.showCancel && <button aria-label={cancelLabel} className="terminal-overlay-button" type="button" onClick={onCancel}><X size={13} /><span>{cancelLabel}</span></button>}
        {presentation.showRetry && <button aria-label={isRetrying ? t("terminal.reconnectNow") : t("terminal.reconnect")} className="terminal-overlay-button terminal-overlay-primary" type="button" onClick={onReconnectNow}><RotateCw size={13} /><span>{isRetrying ? t("terminal.reconnectNow") : t("terminal.reconnect")}</span></button>}
        {presentation.showClose && <button aria-label={t("terminal.closeSession")} className="terminal-overlay-button" type="button" onClick={onClose}><X size={13} /><span>{t("terminal.closeSession")}</span></button>}
      </div>
    </section>
  )
}
