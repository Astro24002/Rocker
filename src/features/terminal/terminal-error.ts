import type { TerminalFailureReason, TerminalSessionState } from "../../../electron/ssh/types"

export type TerminalFailureSeverity = "transient" | "blocking"

export interface TerminalFailurePresentation {
  severity: TerminalFailureSeverity
  titleKey: string
  detailKey?: string
  showRetry: boolean
  showCancel: boolean
  showClose: boolean
}

const detailByReason: Partial<Record<TerminalFailureReason, string>> = {
  network: "terminal.networkErrorDetail",
  timeout: "terminal.timeoutErrorDetail",
  dns: "terminal.dnsErrorDetail",
  authentication: "terminal.authenticationErrorDetail",
  "host-key-changed": "terminal.hostKeyChangedDetail",
  "host-key-rejected": "terminal.hostKeyRejectedDetail",
  configuration: "terminal.hostUnavailable",
  "channel-ended": "terminal.channelEndedDetail",
  "local-port-in-use": "terminal.localPortInUseDetail",
  cancelled: "terminal.reconnectCancelledDetail"
}

export function getTerminalFailurePresentation(
  state: TerminalSessionState,
  reason?: TerminalFailureReason
): TerminalFailurePresentation {
  if (state === "connecting") {
    return { severity: "transient", titleKey: "terminal.connecting", showRetry: false, showCancel: true, showClose: false }
  }
  if (state === "restoring") {
    return { severity: "transient", titleKey: "terminal.restoring", showRetry: false, showCancel: false, showClose: false }
  }
  if (state === "reconnecting") {
    return {
      severity: "transient",
      titleKey: "terminal.reconnecting",
      detailKey: detailByReason[reason ?? "network"] ?? "terminal.connectionErrorDetail",
      showRetry: true,
      showCancel: true,
      showClose: false
    }
  }
  if (state === "disconnected") {
    return {
      severity: "blocking",
      titleKey: "terminal.disconnected",
      detailKey: detailByReason[reason ?? "unknown"] ?? "terminal.connectionErrorDetail",
      showRetry: true,
      showCancel: false,
      showClose: true
    }
  }
  return {
    severity: "blocking",
    titleKey: "terminal.connectionError",
    detailKey: detailByReason[reason ?? "unknown"] ?? "terminal.connectionErrorDetail",
    showRetry: true,
    showCancel: false,
    showClose: true
  }
}
