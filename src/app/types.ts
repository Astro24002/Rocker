export type {
  AppSettings,
  AuthMethod,
  ConnectionHistoryItem,
  CredentialKind,
  HostCharset,
  HostEnvironment,
  HostPlatform,
  HostProfile,
  HostThemeColor,
  StoredHostDocument,
  StoredTerminalLayout,
  StoredWorkspaceDocument,
  StoredWorkspaceSession,
  StoredWorkspaceWindow
} from "../../electron/storage/types"

export type { DiscoveredPort, ForwardingInfo, ForwardingSpec, PortSource, PortStatus } from "../../electron/ports/types"
export type {
  ConnectionTestResult,
  OwnedTerminalSessionEvent,
  TerminalDimensions,
  TerminalFailureReason,
  TerminalOutputPacket,
  TerminalSessionEvent,
  TerminalSessionInfo,
  TerminalSessionState,
  TerminalStateEvent
} from "../../electron/ssh/types"
