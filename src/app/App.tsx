import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { RecoveryBanner } from "../components/RecoveryBanner"
import { Sidebar, type ContextMenuOwner, type SessionCommandId, type WorkspaceNavKey } from "../components/Sidebar"
import { WorkspaceResizeHandle } from "../components/WorkspaceResizeHandle"
import { WindowChrome } from "../components/WindowChrome"
import { HostEditor } from "../features/hosts/HostEditor"
import { HostList } from "../features/hosts/HostList"
import { hostForSshTarget, parseSshCommand, upsertHost } from "../features/hosts/host-state"
import { HistoryView } from "../features/history/HistoryView"
import { PortsView } from "../features/ports/PortsView"
import { SettingsView } from "../features/settings/SettingsView"
import { TrustView } from "../features/trust/TrustView"
import { ConnectionsView } from "../features/connections/ConnectionsView"
import { SftpWorkspaceView, SnippetsView } from "../features/workspace/WorkspaceLandingViews"
import { CommandPalette, type CommandPaletteFocusRequest } from "../features/commands/CommandPalette"
import { executeCommand, isCommandEnabled, type CommandActions, type CommandContext, type CommandId, type TerminalCommandSurface } from "../features/commands/command-registry"
import { matchGlobalShortcut, shouldIgnoreGlobalShortcutTarget } from "../features/commands/command-shortcuts"
import { TerminalConnectionOverlay } from "../features/terminal/TerminalConnectionOverlay"
import { TerminalContextMenu } from "../features/terminal/TerminalContextMenu"
import { TerminalSearchOverlay } from "../features/terminal/TerminalSearchOverlay"
import { insertHorizontalSplit, removeSessionFromLayout, visibleSessionIds, type TerminalLayout } from "../features/terminal/layout"
import {
  activateSession,
  applyTerminalState,
  attachChannel,
  closeSession,
  createTerminalWorkspaceState,
  forwardingToSessionState,
  isPortForwardingSession,
  isSftpSession,
  isSshSession,
  openSession,
  patchSession,
  sessionKind,
  synchronizePortForwardingSessions,
  type TerminalWorkspaceState,
  type WorkspaceSessionPatch,
  type WorkspaceSession
} from "../features/terminal/session-state"
import { recentSessionIds, recordSessionFocus, removeRecentSession, type RecentSessionState } from "../features/sessions/recent-sessions"
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace"
import { SessionContentView } from "../features/sessions/SessionContentView"
import { type TerminalController, type TerminalPreferences } from "../features/terminal/terminal-controller"
import type { TerminalSearchController } from "../features/terminal/terminal-search"
import { I18nProvider, useI18n } from "../i18n"
import { normalizeSidebarWidth } from "../shared/sidebar-width"
import { bootstrapReducer, createBootstrapState, deriveBootstrapCapabilities, retryableBootstrapResources } from "./bootstrap-state"
import { getRockerBridge } from "./bridge"
import type { BootstrapResourceName, HostKeyInventoryEntry, HostKeyInventorySnapshot, HostSaveProfile } from "../../electron/ipc/bridge-contract"
import type {
  AppSettings,
  ConnectionHistoryItem,
  HostProfile,
  StoredWorkspaceSession,
  ForwardingInfo,
  StoredWorkspaceWindow,
  TerminalDimensions,
  TerminalFailureReason,
  TerminalSessionEvent,
  TerminalStateEvent
} from "./types"
import type { ForwardingProfile } from "../../electron/storage/types"

interface PendingTerminalOpen {
  hostId: string
  forceNewConnection?: boolean
  restorePriority?: "active" | "background"
}

interface RestoreAdmission {
  pendingSessionIds: Set<string>
}

interface RestoredWorkspace {
  workspace: TerminalWorkspaceState
  pending: Array<{ sessionId: string; hostId: string; restorePriority: "active" | "background" }>
  restoreActiveSessionId?: string
}

type SettingsKey = keyof AppSettings
type SettingsVersionSnapshot = Partial<Record<SettingsKey, number>>

interface PendingSettingsWrite {
  update: Partial<AppSettings>
  versions: SettingsVersionSnapshot
  mutationVersion: number
  statusVersion: number
}

const settingsKeys: SettingsKey[] = [
  "locale",
  "sidebarWidth",
  "globalThemeId",
  "hostThemeOverrides",
  "hostSort",
  "hostFavoritesOnly",
  "connectionsTab",
  "terminalFont",
  "terminalFontSize",
  "scrollback",
  "cursorStyle",
  "cursorBlink",
  "terminalBell",
  "connectionTimeout",
  "autoReconnect",
  "reconnectMode",
  "restorePreviousWorkspace",
  "confirmMultilinePaste",
  "bindAddress"
]

const terminalAppearanceKeys: SettingsKey[] = [
  "terminalFont",
  "terminalFontSize",
  "scrollback",
  "cursorStyle",
  "cursorBlink",
  "terminalBell"
]

const defaultSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  globalThemeId: "forest",
  hostThemeOverrides: {},
  hostSort: "name-asc",
  hostFavoritesOnly: false,
  connectionsTab: "history",
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  scrollback: 10000,
  cursorStyle: "bar",
  cursorBlink: true,
  terminalBell: true,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

export default function App() {
  return <I18nProvider><Workspace /></I18nProvider>
}

function Workspace() {
  const bridge = useMemo(() => getRockerBridge(), [])
  const { locale, setLocale, t } = useI18n()
  const translation = useRef(t)
  translation.current = t
  const [activeNav, setActiveNav] = useState<WorkspaceNavKey>("hosts")
  const [hostForwardingHostId, setHostForwardingHostId] = useState<string>()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [history, setHistory] = useState<ConnectionHistoryItem[]>([])
  const [hostKeyInventory, setHostKeyInventory] = useState<HostKeyInventorySnapshot>({ entries: [], history: [] })
  const [hostKeyLoading, setHostKeyLoading] = useState(false)
  const [hostKeyLoadError, setHostKeyLoadError] = useState(false)
  const [editor, setEditor] = useState<{ open: boolean; profile?: HostProfile }>({ open: false })
  const [workspace, setWorkspace] = useState<TerminalWorkspaceState>(createTerminalWorkspaceState)
  const [bootstrapState, dispatchBootstrap] = useReducer(bootstrapReducer, undefined, createBootstrapState)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [settingsPersistenceFailed, setSettingsPersistenceFailed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [recentSessionState, setRecentSessionState] = useState<RecentSessionState>({})
  const [contextMenuOwner, setContextMenuOwner] = useState<ContextMenuOwner>()
  const [terminalContextMenu, setTerminalContextMenu] = useState<{ sessionId: string; x: number; y: number }>()
  const [, setCommandContextVersion] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? defaultSettings.sidebarWidth)
    return normalizeSidebarWidth(Number.isFinite(stored) ? stored : defaultSettings.sidebarWidth)
  })

  const controllers = useRef(new Map<string, TerminalController>())
  const searchControllers = useRef(new Map<string, TerminalSearchController>())
  const terminalSurfaces = useRef(new Map<string, TerminalCommandSurface>())
  const commandContextRef = useRef<CommandContext | undefined>(undefined)
  const settingsRef = useRef(settings)
  const pendingAppearanceUpdate = useRef<Partial<AppSettings>>({})
  const settingsPersistTimer = useRef<number | undefined>(undefined)
  const settingsFieldVersions = useRef<SettingsVersionSnapshot>({})
  const dirtySettingsKeys = useRef(new Set<SettingsKey>())
  const settingsMutationVersion = useRef(0)
  const settingsWriteQueue = useRef<PendingSettingsWrite[]>([])
  const settingsWriteInFlight = useRef<PendingSettingsWrite | undefined>(undefined)
  const latestSettingsStatusVersion = useRef(0)
  const activeSessionIdRef = useRef<string | undefined>(undefined)
  const pendingSearchSessionId = useRef<string | undefined>(undefined)
  const workspaceRef = useRef(workspace)
  const activeNavigationRef = useRef<WorkspaceNavKey>("hosts")
  const workspaceStageRef = useRef<HTMLDivElement>(null)
  const focusRestoreTimer = useRef<number | undefined>(undefined)
  const connectionIds = useRef(new Map<string, string>())
  const pendingOpens = useRef(new Map<string, PendingTerminalOpen>())
  const openingSessionIds = useRef(new Set<string>())
  const restoreAdmission = useRef<RestoreAdmission | undefined>(undefined)
  const workspaceWritable = useRef(false)
  const bootstrapMounted = useRef(true)
  const retryInFlight = useRef(false)
  const retryGeneration = useRef(0)
  const capabilities = useMemo(() => deriveBootstrapCapabilities(bootstrapState), [bootstrapState])
  const hostKeysAvailable = bootstrapState.phase !== "error" && bootstrapState.resources.hostKeys?.health.status !== undefined && bootstrapState.resources.hostKeys.health.status !== "blocked"
  const settingsMutationsAvailable = capabilities.settingsWritable
  settingsRef.current = settings
  const terminalPreferences = useMemo<TerminalPreferences>(() => terminalPreferencesForSettings(settings), [
    settings.terminalFont,
    settings.terminalFontSize,
    settings.scrollback,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.terminalBell
  ])
  const themeForHost = useCallback((hostId: string): string => settings.hostThemeOverrides?.[hostId] ?? settings.globalThemeId ?? "forest", [settings.globalThemeId, settings.hostThemeOverrides])

  const refreshHostKeys = useCallback(async (): Promise<void> => {
    setHostKeyLoading(true)
    setHostKeyLoadError(false)
    try {
      const inventory = await bridge.hostKeys.list()
      if (!bootstrapMounted.current) return
      setHostKeyInventory(inventory)
    } catch {
      if (!bootstrapMounted.current) return
      setHostKeyLoadError(true)
      setHostKeyInventory({ entries: [], history: [] })
    } finally {
      if (bootstrapMounted.current) setHostKeyLoading(false)
    }
  }, [bridge])

  const pumpSettingsWrites = useCallback((): void => {
    if (settingsWriteInFlight.current) return
    const write = settingsWriteQueue.current.shift()
    if (!write) return
    settingsWriteInFlight.current = write
    void bridge.settings.update(write.update)
      .then((persisted) => {
        if (!bootstrapMounted.current) return
        const nextSettings = mergeSettingsResponse(
          settingsRef.current,
          persisted,
          write.update,
          write.versions,
          settingsFieldVersions.current,
          dirtySettingsKeys.current
        )
        settingsRef.current = nextSettings
        setSettings(nextSettings)
        for (const key of Object.keys(write.update) as SettingsKey[]) {
          if (write.versions[key] === settingsFieldVersions.current[key]) dirtySettingsKeys.current.delete(key)
        }
        if (write.statusVersion === latestSettingsStatusVersion.current && write.mutationVersion === settingsMutationVersion.current) {
          setSettingsPersistenceFailed(false)
        }
      })
      .catch(() => {
        if (bootstrapMounted.current && write.statusVersion === latestSettingsStatusVersion.current && write.mutationVersion === settingsMutationVersion.current) {
          setSettingsPersistenceFailed(true)
        }
      })
      .finally(() => {
        if (settingsWriteInFlight.current === write) settingsWriteInFlight.current = undefined
        pumpSettingsWrites()
      })
  }, [bridge])

  const queueSettingsWrite = useCallback((update: Partial<AppSettings>): void => {
    const write: PendingSettingsWrite = {
      update: { ...update },
      versions: { ...settingsFieldVersions.current },
      mutationVersion: settingsMutationVersion.current,
      statusVersion: ++latestSettingsStatusVersion.current
    }
    settingsWriteQueue.current.push(write)
    pumpSettingsWrites()
  }, [pumpSettingsWrites])

  useEffect(() => {
    bootstrapMounted.current = true
    retryGeneration.current += 1
    return () => {
      bootstrapMounted.current = false
      retryGeneration.current += 1
      if (settingsPersistTimer.current !== undefined) {
        window.clearTimeout(settingsPersistTimer.current)
        settingsPersistTimer.current = undefined
      }
      if (focusRestoreTimer.current !== undefined) {
        window.clearTimeout(focusRestoreTimer.current)
        focusRestoreTimer.current = undefined
      }
      const pending = pendingAppearanceUpdate.current
      pendingAppearanceUpdate.current = {}
      if (Object.keys(pending).length > 0) queueSettingsWrite(pending)
    }
  }, [queueSettingsWrite])

  const markSessionState = useCallback((sessionId: string, state: TerminalStateEvent["state"], reason?: TerminalFailureReason): void => {
    setWorkspace((current) => {
      const session = current.sessions.find((candidate) => candidate.id === sessionId)
      return isSshSession(session)
        ? applyTerminalState(current, {
            kind: "state",
            sessionId,
            channelGeneration: session.channelGeneration,
            state,
            reason
          })
        : current
    })
  }, [])

  const releaseRestoreAdmission = useCallback((sessionId: string): void => {
    const admission = restoreAdmission.current
    if (!admission || !admission.pendingSessionIds.delete(sessionId) || admission.pendingSessionIds.size > 0) return
    restoreAdmission.current = undefined
    void bridge.sessions.completeRestore().catch(() => undefined)
  }, [bridge])

  const openPendingSession = useCallback(async (sessionId: string, dimensions: TerminalDimensions, bypassCapabilityCheck = false): Promise<void> => {
    const pending = pendingOpens.current.get(sessionId)
    if (!pending || openingSessionIds.current.has(sessionId) || (!capabilities.sshAvailable && !bypassCapabilityCheck)) return

    pendingOpens.current.delete(sessionId)
    openingSessionIds.current.add(sessionId)
    markSessionState(sessionId, pending.restorePriority ? "restoring" : "connecting")

    try {
      const request = bridge.sessions.open({
        sessionId,
        hostId: pending.hostId,
        cols: dimensions.cols,
        rows: dimensions.rows,
        forceNewConnection: pending.forceNewConnection,
        restorePriority: pending.restorePriority
      })
      releaseRestoreAdmission(sessionId)
      const info = await request
      setWorkspace((current) => attachChannel(current, info))
      void bridge.history.list().then(setHistory).catch(() => undefined)
    } catch (error) {
      releaseRestoreAdmission(sessionId)
      markSessionState(sessionId, "error", failureReasonFor(error))
    } finally {
      openingSessionIds.current.delete(sessionId)
    }
  }, [bridge, capabilities.sshAvailable, markSessionState, releaseRestoreAdmission])

  const handleTerminalResize = useCallback((sessionId: string, channelGeneration: number, dimensions: TerminalDimensions): void => {
    setWorkspace((current) => {
      const session = current.sessions.find((candidate) => candidate.id === sessionId)
      if (!isSshSession(session) || sameDimensions(session.dimensions, dimensions)) return current
      return {
        ...current,
        sessions: current.sessions.map((candidate) => candidate.id === sessionId ? { ...candidate, dimensions } : candidate)
      }
    })

    if (pendingOpens.current.has(sessionId)) {
      void openPendingSession(sessionId, dimensions)
      return
    }
    if (channelGeneration > 0) {
      void bridge.sessions.resize(sessionId, channelGeneration, dimensions.cols, dimensions.rows).catch(() => undefined)
    }
  }, [bridge, openPendingSession])

  const handleTerminalInput = useCallback((sessionId: string, channelGeneration: number, data: string): void => {
    void bridge.sessions.write(sessionId, channelGeneration, data).catch(() => undefined)
  }, [bridge])

  const handleTerminalAck = useCallback((sessionId: string, channelGeneration: number, sequence: number): void => {
    void bridge.sessions.ackOutput(sessionId, channelGeneration, sequence).catch(() => undefined)
  }, [bridge])

  const handleTerminalController = useCallback((sessionId: string, controller: TerminalController | undefined): void => {
    if (controller) {
      controllers.current.set(sessionId, controller)
      controller.applyPreferences(terminalPreferencesForSettings(settingsRef.current))
    } else {
      controllers.current.delete(sessionId)
    }
  }, [])

  const handleSearchController = useCallback((sessionId: string, controller: TerminalSearchController | undefined): void => {
    if (controller) searchControllers.current.set(sessionId, controller)
    else searchControllers.current.delete(sessionId)
    setCommandContextVersion((current) => current + 1)
  }, [])

  const handleTerminalCommandSurface = useCallback((sessionId: string, surface: TerminalCommandSurface | undefined): void => {
    if (surface) terminalSurfaces.current.set(sessionId, surface)
    else terminalSurfaces.current.delete(sessionId)
    setCommandContextVersion((current) => current + 1)
  }, [])

  const handleSessionEvent = useCallback((event: TerminalSessionEvent): void => {
    if (event.kind === "output") {
      controllers.current.get(event.packet.sessionId)?.acceptOutput(event.packet)
      const isVisible = activeNavigationRef.current === "terminal" && activeSessionIdRef.current === event.packet.sessionId
      if (!isVisible) {
        setWorkspace((current) => {
          const session = current.sessions.find((candidate) => candidate.id === event.packet.sessionId)
          if (!isSshSession(session) || event.packet.channelGeneration < session.channelGeneration) return current
          return patchSession(current, event.packet.sessionId, { kind: "ssh", hasUnreadActivity: true })
        })
      }
      return
    }

    const controller = controllers.current.get(event.sessionId)
    controller?.setChannelGeneration(event.channelGeneration)
    controller?.setConnected(event.state === "connected")
    if (event.notice) {
      controller?.writeLocalNotice(
        event.notice,
        event.notice === "reconnected" ? translation.current("terminal.noticeReconnected") : translation.current("terminal.noticeRestored")
      )
    }
    if (event.connectionId) connectionIds.current.set(event.sessionId, event.connectionId)
    setWorkspace((current) => applyTerminalState(current, event))
  }, [])

  const queueSessionOpen = useCallback((host: HostProfile, label: string | ((current: TerminalWorkspaceState) => string), options: Pick<PendingTerminalOpen, "forceNewConnection"> = {}): void => {
    if (!capabilities.sshAvailable) return
    const sessionId = crypto.randomUUID()
    pendingOpens.current.set(sessionId, { hostId: host.id, forceNewConnection: options.forceNewConnection })
    setWorkspace((current) => openSession(current, { id: sessionId, hostId: host.id, label: typeof label === "string" ? label : label(current), kind: "ssh" }))
    setActiveNav("terminal")
  }, [capabilities.sshAvailable])

  const openSftpSession = useCallback((host: HostProfile, initial: { label?: string; path?: string } = {}): void => {
    const existing = workspaceRef.current.sessions.find((session) => sessionKind(session) === "sftp" && session.hostId === host.id)
    if (isSftpSession(existing)) {
      setWorkspace((current) => activateSession(current, existing.id))
      setRecentSessionState((current) => recordSessionFocus(current, existing.id))
      setActiveNav("sftp")
      return
    }
    const sessionId = crypto.randomUUID()
    setWorkspace((current) => openSession(current, {
      id: sessionId,
      hostId: host.id,
      label: initial.label ?? host.name,
      kind: "sftp",
      path: initial.path ?? "."
    }))
    setActiveNav("sftp")
  }, [])

  const openPfSession = useCallback((profile: ForwardingProfile, runtime?: ForwardingInfo, initial: { label?: string; applicationProtocol?: "http" | "https" } = {}): void => {
    const existing = workspaceRef.current.sessions.find((session) => isPortForwardingSession(session) && session.hostId === profile.hostId)
    if (isPortForwardingSession(existing)) {
      setWorkspace((current) => patchSession(activateSession(current, existing.id), existing.id, {
        kind: "pf",
        profileId: profile.id,
        forwardingId: runtime?.id,
        forwardingStatus: runtime?.status ?? existing.forwardingStatus,
        state: runtime ? forwardingToSessionState(runtime.status) : existing.state,
        applicationProtocol: initial.applicationProtocol ?? existing.applicationProtocol
      }))
      setRecentSessionState((current) => recordSessionFocus(current, existing.id))
      setHostForwardingHostId(profile.hostId)
      setActiveNav("host-port-forwarding")
      return
    }
    const sessionId = crypto.randomUUID()
    setWorkspace((current) => openSession(current, {
      id: sessionId,
      hostId: profile.hostId,
      label: initial.label ?? hosts.find((host) => host.id === profile.hostId)?.name ?? profile.hostId,
      kind: "pf",
      profileId: profile.id,
      forwardingId: runtime?.id,
      forwardingStatus: runtime?.status ?? "stopped",
      applicationProtocol: initial.applicationProtocol
    }))
    setHostForwardingHostId(profile.hostId)
    setActiveNav("host-port-forwarding")
  }, [hosts])

  const openHostForwardingFromHost = useCallback((host: HostProfile): void => {
    const session = workspaceRef.current.sessions.find((candidate) => candidate.hostId === host.id && isPortForwardingSession(candidate))
    if (session) {
      setWorkspace((current) => activateSession(current, session.id))
      setRecentSessionState((current) => recordSessionFocus(current, session.id))
    } else {
      const sessionId = crypto.randomUUID()
      setWorkspace((current) => {
        const existing = current.sessions.find((candidate) => candidate.hostId === host.id && isPortForwardingSession(candidate))
        if (existing) return activateSession(current, existing.id)
        return openSession(current, { id: sessionId, hostId: host.id, label: host.name, kind: "pf" })
      })
    }
    setHostForwardingHostId(host.id)
    setActiveNav("host-port-forwarding")
  }, [])

  const patchWorkspaceSession = useCallback((sessionId: string, patch: WorkspaceSessionPatch): void => {
    setWorkspace((current) => patchSession(current, sessionId, patch))
  }, [])

  useEffect(() => {
    const unsubscribeSession = bridge.events.onSessionEvent(handleSessionEvent)
    return unsubscribeSession
  }, [bridge, handleSessionEvent])

  useEffect(() => {
    const sessionId = workspace.activeSessionId
    if (activeNav !== "terminal" || !sessionId) return
    setWorkspace((current) => patchSession(current, sessionId, { kind: "ssh", hasUnreadActivity: false }))
  }, [activeNav, workspace.activeSessionId])

  useEffect(() => {
    if (bootstrapState.phase === "loading" || bootstrapState.phase === "error") return
    let cancelled = false
    const synchronize = async (): Promise<void> => {
      try {
        const rows = await bridge.ports.listOverview()
        if (!cancelled) setWorkspace((current) => synchronizePortForwardingSessions(current, rows))
      } catch {
        // The dedicated forwarding views retain their existing error handling.
      }
    }
    void synchronize()
    const unsubscribe = bridge.events.onForwardingEvent(() => { void synchronize() })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bootstrapState.phase, bridge])

  useEffect(() => {
    if (bootstrapState.phase === "loading" || bootstrapState.phase === "error") return
    let cancelled = false
    const synchronize = async (workspaceId: string): Promise<void> => {
      try {
        const transfers = await bridge.sftp.listTransfers(workspaceId)
        if (cancelled) return
        const activeTransferCount = transfers.filter((task) => task.status === "queued" || task.status === "running").length
        setWorkspace((current) => patchSession(current, workspaceId, { kind: "sftp", activeTransferCount }))
      } catch {
        // Transfer rows retain their last known state when the runtime is temporarily unavailable.
      }
    }
    for (const session of workspaceRef.current.sessions) {
      if (isSftpSession(session)) void synchronize(session.id)
    }
    const unsubscribe = bridge.events.onSftpEvent((event) => {
      if (event.kind === "transfer") void synchronize(event.task.workspaceId)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bootstrapState.phase, bridge])

  useEffect(() => {
    const unsubscribeLaunch = bridge.events.onSessionLaunch((request) => {
      if (!capabilities.sshAvailable) return
      void (async () => {
        const availableHosts = await bridge.hosts.list()
        const host = availableHosts.find((candidate) => candidate.id === request.hostId)
        if (!host) return
        if (request.kind === "sftp") {
          openSftpSession(host, { label: request.label, path: request.path })
          return
        }
        if (request.kind === "pf") {
          if (request.profileId) {
            const row = (await bridge.ports.listForHost(host.id)).find((candidate) => candidate.profile.id === request.profileId)
            if (row) {
              openPfSession(row.profile, row.runtime, { label: request.label, applicationProtocol: request.applicationProtocol })
              return
            }
          }
          openHostForwardingFromHost(host)
          return
        }
        queueSessionOpen(host, request.label ?? host.name, { forceNewConnection: true })
      })().catch(() => undefined)
    })
    return unsubscribeLaunch
  }, [bridge, capabilities.sshAvailable, openHostForwardingFromHost, openPfSession, openSftpSession, queueSessionOpen])

  useEffect(() => {
    let cancelled = false

    const initialize = async (): Promise<void> => {
      dispatchBootstrap({ type: "load-start" })
      try {
        const snapshot = await bridge.bootstrap.load()
        if (cancelled) return

        workspaceWritable.current = isWorkspaceWritable(snapshot.workspace.health.status)
        dispatchBootstrap({ type: "load-success", snapshot })
        if (snapshot.hostKeys.health.status === "blocked") {
          setHostKeyInventory({ entries: [], history: [] })
          setHostKeyLoadError(true)
        } else {
          void refreshHostKeys()
        }
        const snapshotCapabilities = deriveBootstrapCapabilities(snapshot)

        const availableHosts = snapshot.hosts.health.status === "blocked" ? [] : snapshot.hosts.value ?? []
        const loadedHistory = snapshot.history.health.status === "blocked" ? [] : snapshot.history.value ?? []
        const storedSettings = snapshot.settings.health.status === "blocked" ? defaultSettings : snapshot.settings.value ?? defaultSettings
        const nextSettings = mergeSettingsSnapshot(
          settingsRef.current,
          storedSettings,
          settingsFieldVersions.current,
          settingsFieldVersions.current,
          dirtySettingsKeys.current
        )
        setHosts(availableHosts)
        setHistory(loadedHistory)
        settingsRef.current = nextSettings
        setSettings(nextSettings)
        setLocale(nextSettings.locale)
        setSidebarWidth(normalizeSidebarWidth(nextSettings.sidebarWidth))

        if (nextSettings.restorePreviousWorkspace && workspaceWritable.current && snapshot.workspace.value) {
          const restored = restoreWorkspace(snapshot.workspace.value, availableHosts, snapshot.hosts.health.status !== "blocked")
          if (restored.restoreActiveSessionId) {
            if (snapshotCapabilities.sshAvailable) {
              try {
                await bridge.sessions.beginRestore(restored.restoreActiveSessionId)
              } catch {
                // The individual opens still retain active/background ordering if admission is unavailable.
              }
              if (cancelled) {
                void bridge.sessions.completeRestore().catch(() => undefined)
                return
              }
              restoreAdmission.current = { pendingSessionIds: new Set(restored.pending.map((entry) => entry.sessionId)) }
            }
            for (const pending of restored.pending) {
              pendingOpens.current.set(pending.sessionId, {
                hostId: pending.hostId,
                restorePriority: pending.restorePriority
              })
            }
          }
          if (cancelled) {
            if (restoreAdmission.current) void bridge.sessions.completeRestore().catch(() => undefined)
            return
          }
          setWorkspace(restored.workspace)
          if (restored.workspace.sessions.length > 0) {
            const restoredActive = restored.workspace.sessions.find((session) => session.id === restored.workspace.activeSessionId)
            if (isSftpSession(restoredActive)) {
              setActiveNav("sftp")
            } else if (isPortForwardingSession(restoredActive)) {
              setHostForwardingHostId(restoredActive.hostId)
              setActiveNav("host-port-forwarding")
            } else {
              setActiveNav("terminal")
            }
          }
        }
      } catch {
        if (!cancelled) {
          workspaceWritable.current = false
          dispatchBootstrap({ type: "load-error" })
          setHostKeyInventory({ entries: [], history: [] })
          setHostKeyLoadError(true)
        }
      }
    }

    void initialize()
    return () => { cancelled = true }
  }, [bridge, refreshHostKeys])

  useEffect(() => {
    if (!workspaceWritable.current) return
    void bridge.workspace.save(serializeWorkspace(workspace)).catch(() => undefined)
  }, [bridge, bootstrapState.phase, workspace])

  const retryBootstrap = useCallback(async (resources: BootstrapResourceName[]): Promise<void> => {
    if (resources.length === 0 || retryInFlight.current) return
    const selectedResources = retryableBootstrapResources(bootstrapState)
    if (selectedResources.length === 0) return
    const generation = retryGeneration.current
    const isActive = (): boolean => bootstrapMounted.current && retryGeneration.current === generation
    const retrySettingsVersions = { ...settingsFieldVersions.current }
    const retryStatusVersion = selectedResources.includes("settings") ? ++latestSettingsStatusVersion.current : undefined
    retryInFlight.current = true
    workspaceWritable.current = false
    dispatchBootstrap({ type: "retry-start", resources: selectedResources })

    try {
      const result = await bridge.bootstrap.retry(selectedResources)
      if (!isActive()) return
      const mergedResources = { ...bootstrapState.resources, ...result }
      const mergedCapabilities = deriveBootstrapCapabilities(mergedResources)
      let nextSettings = settingsRef.current
      if (result.settings) {
        const settingsBlocked = result.settings.health.status === "blocked"
        if (settingsBlocked) {
          if (retryStatusVersion === latestSettingsStatusVersion.current) setSettingsPersistenceFailed(true)
        } else {
          nextSettings = mergeSettingsSnapshot(
            settingsRef.current,
            result.settings.value ?? defaultSettings,
            retrySettingsVersions,
            settingsFieldVersions.current,
            dirtySettingsKeys.current
          )
          settingsRef.current = nextSettings
          setSettings(nextSettings)
          setLocale(nextSettings.locale)
          setSidebarWidth(normalizeSidebarWidth(nextSettings.sidebarWidth))
          if (retryStatusVersion === latestSettingsStatusVersion.current) setSettingsPersistenceFailed(false)
        }
      }
      if (result.history) setHistory(result.history.health.status === "blocked" ? [] : result.history.value ?? [])
      if (result.hosts) setHosts(result.hosts.health.status === "blocked" ? [] : result.hosts.value ?? [])
      if (result.hostKeys) {
        if (result.hostKeys.health.status === "blocked") {
          setHostKeyInventory({ entries: [], history: [] })
          setHostKeyLoadError(true)
        } else {
          void refreshHostKeys()
        }
      }

      let restoredWorkspace: TerminalWorkspaceState | undefined
      if (result.workspace) {
        const workspaceCanWrite = mergedCapabilities.workspaceWritable
        workspaceWritable.current = workspaceCanWrite
        if (workspaceCanWrite && result.workspace.value && nextSettings.restorePreviousWorkspace) {
          const availableHosts = result.hosts?.health.status === "blocked"
            ? []
            : result.hosts?.value ?? hosts
          const hostsKnown = mergedResources.hosts?.health.status !== undefined && mergedResources.hosts.health.status !== "blocked"
          const restored = restoreWorkspace(result.workspace.value, availableHosts, hostsKnown)
          restoredWorkspace = restored.workspace
          for (const pending of restored.pending) {
            pendingOpens.current.set(pending.sessionId, { hostId: pending.hostId, restorePriority: pending.restorePriority })
          }
          if (mergedCapabilities.sshAvailable && restored.restoreActiveSessionId) {
            try {
              await bridge.sessions.beginRestore(restored.restoreActiveSessionId)
              if (!isActive()) {
                void bridge.sessions.completeRestore().catch(() => undefined)
                return
              }
              restoreAdmission.current = { pendingSessionIds: new Set(restored.pending.map((entry) => entry.sessionId)) }
            } catch {
              if (!isActive()) return
              // Individual session opens still retain their ordering if admission is unavailable.
            }
          }
          setWorkspace(restored.workspace)
          if (restored.workspace.sessions.length > 0) {
            const restoredActive = restored.workspace.sessions.find((session) => session.id === restored.workspace.activeSessionId)
            setActiveNav(isSftpSession(restoredActive) ? "sftp" : "terminal")
          }
        }
      }
      const restoreSource = restoredWorkspace ?? workspace
      const pendingRestoreEntries = [...pendingOpens.current.entries()]
      if (mergedCapabilities.sshAvailable && pendingRestoreEntries.length > 0) {
        if (!restoreAdmission.current) {
          const activePendingSessionId = restoreSource.activeSessionId && pendingRestoreEntries.some(([sessionId]) => sessionId === restoreSource.activeSessionId)
            ? restoreSource.activeSessionId
            : pendingRestoreEntries[0][0]
          try {
            await bridge.sessions.beginRestore(activePendingSessionId)
            if (!isActive()) {
              void bridge.sessions.completeRestore().catch(() => undefined)
              return
            }
            restoreAdmission.current = { pendingSessionIds: new Set(pendingRestoreEntries.map(([sessionId]) => sessionId)) }
          } catch {
            if (!isActive()) return
            // Individual session opens still retain their ordering if admission is unavailable.
          }
        }
        for (const [sessionId] of pendingRestoreEntries) {
          const session = restoreSource.sessions.find((candidate) => candidate.id === sessionId)
          void openPendingSession(sessionId, isSshSession(session) ? session.dimensions ?? { cols: 120, rows: 40 } : { cols: 120, rows: 40 }, true)
        }
      }
      if (selectedResources.includes("workspace") && !result.workspace) workspaceWritable.current = false
      else workspaceWritable.current = mergedCapabilities.workspaceWritable
      dispatchBootstrap({ type: "retry-success", resources: result })
    } catch {
      if (!isActive()) return
      if (selectedResources.includes("workspace")) workspaceWritable.current = false
      dispatchBootstrap({ type: "retry-error", resources: selectedResources })
    } finally {
      retryInFlight.current = false
    }
  }, [bootstrapState, bridge, hosts, openPendingSession, refreshHostKeys, setLocale, workspace])

  const activeSession = workspace.sessions.find((session) => session.id === workspace.activeSessionId)
  const activeHost = activeSession ? hosts.find((host) => host.id === activeSession.hostId) : undefined
  const activeConnectionId = activeSession && canUseConnection(activeSession.state)
    ? connectionIds.current.get(activeSession.id)
    : undefined
  const activeSearchController = activeSession ? searchControllers.current.get(activeSession.id) : undefined
  const activeTerminalSurface = activeSession ? terminalSurfaces.current.get(activeSession.id) : undefined
  activeSessionIdRef.current = workspace.activeSessionId
  workspaceRef.current = workspace
  activeNavigationRef.current = activeNav

  const applyLocalSettingsUpdate = (update: Partial<AppSettings>): AppSettings => {
    if (Object.keys(update).length === 0) return settingsRef.current
    const mutationVersion = ++settingsMutationVersion.current
    for (const key of Object.keys(update) as SettingsKey[]) {
      settingsFieldVersions.current[key] = mutationVersion
      dirtySettingsKeys.current.add(key)
    }
    const nextSettings = { ...settingsRef.current, ...update }
    settingsRef.current = nextSettings
    setSettings(nextSettings)
    if (Object.keys(pickTerminalAppearanceUpdate(update)).length > 0) {
      const preferences = terminalPreferencesForSettings(nextSettings)
      for (const controller of controllers.current.values()) controller.applyPreferences(preferences)
    }
    return nextSettings
  }

  const changeSidebarWidth = (width: number): void => {
    if (!settingsMutationsAvailable) return
    const next = normalizeSidebarWidth(width)
    localStorage.setItem("rocker.sidebarWidth", String(next))
    setSidebarWidth(next)
    applyLocalSettingsUpdate({ sidebarWidth: next })
    queueSettingsWrite({ sidebarWidth: next })
  }

  const updateSettings = (update: Partial<AppSettings>): void => {
    const appearanceUpdate = pickTerminalAppearanceUpdate(update)
    const nonAppearanceUpdate = omitTerminalAppearanceUpdate(update)
    if (!settingsMutationsAvailable && Object.keys(appearanceUpdate).length === 0) return

    const acceptedUpdate = settingsMutationsAvailable ? { ...nonAppearanceUpdate, ...appearanceUpdate } : appearanceUpdate
    applyLocalSettingsUpdate(acceptedUpdate)
    if (!settingsMutationsAvailable) return
    if (Object.keys(nonAppearanceUpdate).length > 0) queueSettingsWrite(nonAppearanceUpdate)
    if (Object.keys(appearanceUpdate).length === 0) return

    pendingAppearanceUpdate.current = { ...pendingAppearanceUpdate.current, ...appearanceUpdate }
    if (settingsPersistTimer.current !== undefined) window.clearTimeout(settingsPersistTimer.current)
    settingsPersistTimer.current = window.setTimeout(() => {
      settingsPersistTimer.current = undefined
      const pending = pendingAppearanceUpdate.current
      pendingAppearanceUpdate.current = {}
      if (Object.keys(pending).length === 0) return
      queueSettingsWrite(pending)
    }, 300)
  }

  const refreshConfigurationAfterImport = useCallback((): void => {
    if (settingsPersistTimer.current !== undefined) {
      window.clearTimeout(settingsPersistTimer.current)
      settingsPersistTimer.current = undefined
    }
    pendingAppearanceUpdate.current = {}
    settingsWriteQueue.current = []
    const importMutationVersion = ++settingsMutationVersion.current
    for (const key of settingsKeys) settingsFieldVersions.current[key] = importMutationVersion
    dirtySettingsKeys.current.clear()
    latestSettingsStatusVersion.current += 1

    void Promise.all([bridge.hosts.list(), bridge.settings.get()]).then(([importedHosts, importedSettings]) => {
      if (!bootstrapMounted.current) return
      settingsRef.current = importedSettings
      setHosts(importedHosts)
      setSettings(importedSettings)
      setLocale(importedSettings.locale)
      localStorage.setItem("rocker.sidebarWidth", String(normalizeSidebarWidth(importedSettings.sidebarWidth)))
      setSidebarWidth(normalizeSidebarWidth(importedSettings.sidebarWidth))
      const preferences = terminalPreferencesForSettings(importedSettings)
      for (const controller of controllers.current.values()) controller.applyPreferences(preferences)
      setSettingsPersistenceFailed(false)
      void refreshHostKeys()
    }).catch(() => {
      if (bootstrapMounted.current) setSettingsPersistenceFailed(true)
    })
  }, [bridge, refreshHostKeys, setLocale])

  const connectHost = (host: HostProfile): void => {
    if (!capabilities.sshAvailable) return
    const existing = recentSessionIds(recentSessionState, workspaceRef.current.sessions)
      .map((sessionId) => workspaceRef.current.sessions.find((session) => session.id === sessionId))
      .find((session) => isSshSession(session) && session.hostId === host.id && session.state !== "closing")
      ?? workspaceRef.current.sessions.find((session) => isSshSession(session) && session.hostId === host.id && session.state !== "closing")
    if (existing) {
      activateExistingSession(existing.id)
      return
    }
    queueSessionOpen(host, host.name)
  }

  const openNewHostSession = (host: HostProfile): void => {
    queueSessionOpen(host, (current) => {
      const labels = new Set(current.sessions.filter((session) => isSshSession(session) && session.hostId === host.id).map((session) => session.label))
      if (!labels.has(host.name)) return host.name
      let suffix = 1
      while (labels.has(`${host.name}(${suffix})`)) suffix += 1
      return `${host.name}(${suffix})`
    })
  }

  const connectSshCommand = async (command: string): Promise<void> => {
    if (!capabilities.hostMutationsAvailable) return
    const target = parseSshCommand(command)
    if (!target) return
    const saved = hostForSshTarget(hosts, target)
    if (saved) {
      connectHost(saved)
      return
    }
    if (!target.username) {
      setEditor({
        open: true,
        profile: {
          id: crypto.randomUUID(),
          name: target.host,
          host: target.host,
          port: target.port,
          username: "",
          authMethod: "agent",
          favorite: false,
          notes: "Created from direct SSH command."
        }
      })
      return
    }
    const profile: HostProfile = {
      id: crypto.randomUUID(),
      name: `${target.username}@${target.host}`,
      host: target.host,
      port: target.port,
      username: target.username,
      authMethod: "agent",
      favorite: false,
      notes: "Created from direct SSH command."
    }
    await bridge.hosts.save({ profile })
    setHosts((current) => [...current, profile])
    connectHost(profile)
  }

  const activateExistingSession = useCallback((sessionOrId: WorkspaceSession | string): void => {
    const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId.id
    const session = workspaceRef.current.sessions.find((candidate) => candidate.id === sessionId)
    if (!session) return
    setWorkspace((current) => activateSession(current, sessionId))
    setRecentSessionState((current) => recordSessionFocus(current, sessionId))
    if (isSftpSession(session)) {
      setActiveNav("sftp")
    } else if (isPortForwardingSession(session)) {
      setHostForwardingHostId(session.hostId)
      setActiveNav("host-port-forwarding")
    } else {
      setActiveNav("terminal")
    }
  }, [])

  const navigateWorkspace = useCallback((destination: WorkspaceNavKey): void => {
    // Sidebar and navigation commands always target the global workspace view.
    setHostForwardingHostId(undefined)
    if (destination === "history" || destination === "trust") {
      updateSettings({ connectionsTab: destination })
      setActiveNav("connections")
      return
    }
    setActiveNav(destination)
  }, [updateSettings])

  const openHostForwarding = useCallback((session: WorkspaceSession): void => {
    if (!workspaceRef.current.sessions.some((candidate) => candidate.id === session.id)) return
    setWorkspace((current) => activateSession(current, session.id))
    setRecentSessionState((current) => recordSessionFocus(current, session.id))
    setHostForwardingHostId(session.hostId)
    setActiveNav("host-port-forwarding")
  }, [])

  const openHostWorkspace = useCallback((hostId: string): void => {
    const host = hosts.find((candidate) => candidate.id === hostId)
    if (host) {
      openHostForwardingFromHost(host)
      return
    }
    setHostForwardingHostId(hostId)
    setActiveNav("host-port-forwarding")
  }, [hosts, openHostForwardingFromHost])

  const openSearchForSession = useCallback((sessionOrId: WorkspaceSession | string): void => {
    const sessionId = typeof sessionOrId === "string" ? sessionOrId : sessionOrId.id
    if (!workspaceRef.current.sessions.some((session) => session.id === sessionId)) return
    pendingSearchSessionId.current = sessionId
    activateExistingSession(sessionId)
    setActiveNav("terminal")
    setSearchOpen(true)
  }, [activateExistingSession])

  const duplicateSession = (session: WorkspaceSession, forceNewConnection = false, split = false): void => {
    if (!capabilities.sshAvailable || sessionKind(session) !== "ssh") return
    const host = hosts.find((candidate) => candidate.id === session.hostId)
    if (!host) return
    const sessionId = crypto.randomUUID()
    pendingOpens.current.set(sessionId, { hostId: host.id, forceNewConnection })
    setWorkspace((current) => {
      const match = /^(.*?) ?\((\d+)\)$/.exec(session.label)
      const baseLabel = match?.[1] ?? session.label
      let suffix = match ? Number(match[2]) + 1 : 1
      const labels = new Set(current.sessions.filter((candidate) => isSshSession(candidate) && candidate.hostId === session.hostId).map((candidate) => candidate.label))
      while (labels.has(`${baseLabel} (${suffix})`) || labels.has(`${baseLabel}(${suffix})`)) suffix += 1
      const opened = openSession(current, {
        id: sessionId,
        hostId: session.hostId,
        label: split ? `${session.label} split` : `${baseLabel} (${suffix})`,
        kind: "ssh"
      })
      if (!split) return opened
      const layout = current.layout ?? { kind: "leaf" as const, sessionId: current.activeSessionId ?? session.id }
      return { ...opened, layout: insertHorizontalSplit(layout, session.id, sessionId) }
    })
    setActiveNav("terminal")
  }

  const renameTerminalSession = (session: WorkspaceSession): void => {
    const label = window.prompt("Rename session", session.label)?.trim()
    if (!label) return
    setWorkspace((current) => ({
      ...current,
      sessions: current.sessions.map((candidate) => candidate.id === session.id ? { ...candidate, label } : candidate)
    }))
  }

  const closeTerminalSession = async (session: WorkspaceSession): Promise<void> => {
    const kind = sessionKind(session)
    if (kind === "sftp") {
      const transfers = await bridge.sftp.listTransfers(session.id).catch(() => [])
      const activeTransfers = transfers.filter((transfer) => transfer.status === "queued" || transfer.status === "running")
      if (activeTransfers.length > 0) {
        const continueInBackground = window.confirm(
          t("session.sftp.closeWithTransfersPrompt").replace("{count}", String(activeTransfers.length))
        )
        if (!continueInBackground) {
          await Promise.allSettled(activeTransfers.map((transfer) => bridge.sftp.cancelTransfer(transfer.id)))
        }
      }
    }
    pendingOpens.current.delete(session.id)
    releaseRestoreAdmission(session.id)
    connectionIds.current.delete(session.id)
    controllers.current.delete(session.id)
    searchControllers.current.delete(session.id)
    terminalSurfaces.current.delete(session.id)
    setRecentSessionState((current) => removeRecentSession(current, session.id))
    if (kind === "ssh") void bridge.sessions.close(session.id).catch(() => undefined)
    if (kind === "sftp") void bridge.sftp.close(session.id).catch(() => undefined)
    const currentWorkspace = workspaceRef.current
    const nextWorkspace = closeSession(currentWorkspace, session.id)
    setWorkspace((current) => closeSession(current, session.id))
    const remaining = nextWorkspace.sessions
    const anotherPfForHost = remaining.some((candidate) => candidate.hostId === session.hostId && isPortForwardingSession(candidate))
    const anotherSshForHost = remaining.some((candidate) => candidate.hostId === session.hostId && isSshSession(candidate))
    const leavingHostForwarding = hostForwardingHostId === session.hostId && !anotherPfForHost && (
      kind === "pf" || (kind === "ssh" && !anotherSshForHost)
    )
    if (leavingHostForwarding) {
      setHostForwardingHostId(undefined)
      setActiveNav("port-forwarding")
    }
    if (currentWorkspace.activeSessionId === session.id && activeNavigationRef.current === "sftp") {
      const nextActive = nextWorkspace.sessions.find((candidate) => candidate.id === nextWorkspace.activeSessionId)
      if (isPortForwardingSession(nextActive)) setHostForwardingHostId(nextActive.hostId)
      setActiveNav(nextActive ? (isSftpSession(nextActive) ? "sftp" : isPortForwardingSession(nextActive) ? "host-port-forwarding" : "terminal") : "hosts")
    }
    if (remaining.length === 0 && (activeNavigationRef.current === "terminal" || activeNavigationRef.current === "sftp")) {
      setHostForwardingHostId(undefined)
      setActiveNav(leavingHostForwarding ? "port-forwarding" : "hosts")
    }
  }

  const focusCurrentTerminal = useCallback((): boolean => {
    if (activeNavigationRef.current !== "terminal") return false
    const sessionId = activeSessionIdRef.current
    const current = workspaceRef.current.sessions.find((session) => session.id === sessionId)
    if (current && sessionKind(current) !== "ssh") return false
    if (!sessionId) return false
    const surface = terminalSurfaces.current.get(sessionId)
    if (surface) {
      surface.focus()
      return true
    }
    const controller = controllers.current.get(sessionId)
    if (!controller) return false
    controller.focus()
    return true
  }, [])

  const restoreCurrentFocus = useCallback((): void => {
    if (focusCurrentTerminal()) return
    workspaceStageRef.current?.focus()
  }, [focusCurrentTerminal])

  const scheduleFocusRestore = useCallback((restore: () => void): void => {
    if (focusRestoreTimer.current !== undefined) window.clearTimeout(focusRestoreTimer.current)
    focusRestoreTimer.current = window.setTimeout(() => {
      focusRestoreTimer.current = undefined
      restore()
    }, 0)
  }, [])

  const restorePaletteFocus = useCallback((request?: CommandPaletteFocusRequest): void => {
    if (!request) {
      restoreCurrentFocus()
      return
    }
    scheduleFocusRestore(() => {
      if (request === "terminal.search") {
        const searchInput = document.querySelector<HTMLInputElement>(".terminal-search-overlay input")
        if (searchInput) {
          searchInput.focus()
          return
        }
      }
      if (request.startsWith("navigation.") && activeNavigationRef.current !== "terminal") {
        workspaceStageRef.current?.focus()
        return
      }
      if (focusCurrentTerminal()) return
      workspaceStageRef.current?.focus()
    })
  }, [focusCurrentTerminal, restoreCurrentFocus, scheduleFocusRestore])

  const restoreSidebarFocus = useCallback((closedSessionId: string): void => {
    scheduleFocusRestore(() => {
      if (focusCurrentTerminal()) return
      const remainingSessionIds = new Set(workspaceRef.current.sessions.filter((session) => session.id !== closedSessionId).map((session) => session.id))
      const remainingSessionButton = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-session-id]")).find((button) => button.dataset.sessionId && remainingSessionIds.has(button.dataset.sessionId))
      if (remainingSessionButton?.isConnected) {
        remainingSessionButton.focus()
        return
      }
      workspaceStageRef.current?.focus()
    })
  }, [focusCurrentTerminal, scheduleFocusRestore])

  const openCommandPalette = useCallback((): void => {
    if (focusRestoreTimer.current !== undefined) {
      window.clearTimeout(focusRestoreTimer.current)
      focusRestoreTimer.current = undefined
    }
    setContextMenuOwner(undefined)
    setTerminalContextMenu(undefined)
    setPaletteOpen(true)
  }, [])

  const commandActions: CommandActions = {
    terminal: {
      search: () => {
        if (activeSession) openSearchForSession(activeSession)
      },
      copy: () => activeTerminalSurface?.copy(),
      paste: () => activeTerminalSurface?.paste(),
      selectAll: () => activeTerminalSurface?.selectAll(),
      clear: () => activeTerminalSurface?.clear(),
      focus: restoreCurrentFocus,
      increaseFont: () => updateSettings({ terminalFontSize: clampTerminalFontSize(settingsRef.current.terminalFontSize + 1) }),
      decreaseFont: () => updateSettings({ terminalFontSize: clampTerminalFontSize(settingsRef.current.terminalFontSize - 1) }),
      resetFont: () => updateSettings({ terminalFontSize: defaultSettings.terminalFontSize })
    },
    session: {
      activate: activateExistingSession,
      reconnect: (session) => capabilities.sshAvailable && sessionKind(session) === "ssh" ? bridge.sessions.reconnect(session.id) : undefined,
      rename: renameTerminalSession,
      duplicate: (session) => duplicateSession(session),
      duplicateWindow: (session) => capabilities.sshAvailable ? bridge.sessions.duplicateInNewWindow({
        hostId: session.hostId,
        kind: sessionKind(session),
        label: session.label,
        ...(isSftpSession(session) ? { path: session.browser.path } : {}),
        ...(isPortForwardingSession(session) && session.profileId ? { profileId: session.profileId } : {}),
        ...(isPortForwardingSession(session) && session.applicationProtocol ? { applicationProtocol: session.applicationProtocol } : {})
      }) : undefined,
      splitHorizontal: (session) => duplicateSession(session, false, true),
      close: closeTerminalSession,
      sftp: (session) => {
        if (!isSshSession(session)) return
        const host = hosts.find((candidate) => candidate.id === session.hostId)
        if (host) openSftpSession(host)
      },
      portForwarding: openHostForwarding
    },
    navigation: {
      navigate: (destination) => navigateWorkspace(destination)
    },
    palette: { open: openCommandPalette }
  }
  const recentSessionCommands = recentSessionIds(recentSessionState, workspace.sessions).flatMap((sessionId) => {
    const session = workspace.sessions.find((candidate) => candidate.id === sessionId)
    const lastFocusedAt = recentSessionState[sessionId]
    return session && lastFocusedAt !== undefined ? [{ id: session.id, label: session.label, session, lastFocusedAt }] : []
  })
  const commandContext: CommandContext = {
    activeSession,
    connectionState: activeSession?.state,
    terminalBufferAvailable: activeSession !== undefined && sessionKind(activeSession) === "ssh",
    terminal: activeTerminalSurface,
    selection: { hasSelection: activeTerminalSurface?.hasSelection() ?? false },
    clipboard: { canPaste: activeSession?.state === "connected" },
    activeNavigation: activeNav === "host-port-forwarding" ? "port-forwarding" : activeNav,
    settingsAvailable: true,
    settingsPersistenceAvailable: settingsMutationsAvailable,
    recentSessions: recentSessionCommands,
    actions: commandActions
  }
  commandContextRef.current = commandContext

  const invokeSessionCommand = (commandId: SessionCommandId, session: WorkspaceSession): void => {
    const context = commandContextRef.current
    if (!context) return
    const surface = terminalSurfaces.current.get(session.id)
    const sessionContext: CommandContext = {
      ...context,
      activeSession: session,
      connectionState: session.state,
      terminalBufferAvailable: surface !== undefined && sessionKind(session) === "ssh",
      terminal: surface,
      selection: { hasSelection: surface?.hasSelection() ?? false },
      clipboard: { canPaste: session.state === "connected" }
    }
    if (!isCommandEnabled(commandId, sessionContext)) return
    void executeCommand(commandId, sessionContext)
  }

  const invokeCommand = (commandId: CommandId): void => {
    const context = commandContextRef.current
    if (!context || !isCommandEnabled(commandId, context)) return
    void executeCommand(commandId, context)
  }

  const handleContextMenuOwnerChange = useCallback((owner: ContextMenuOwner | undefined): void => {
    setContextMenuOwner(owner)
      if (owner !== "terminal") setTerminalContextMenu(undefined)
  }, [])

  const closeTerminalContextMenu = useCallback((): void => {
    setTerminalContextMenu(undefined)
    setContextMenuOwner((owner) => owner === "terminal" ? undefined : owner)
  }, [])
  const openTerminalContextMenu = useCallback((sessionId: string, event: MouseEvent): void => {
    if (paletteOpen) return
    event.preventDefault()
    event.stopPropagation()
    if (focusRestoreTimer.current !== undefined) {
      window.clearTimeout(focusRestoreTimer.current)
      focusRestoreTimer.current = undefined
    }
    if (!workspaceRef.current.sessions.some((session) => session.id === sessionId)) return
    if (workspaceRef.current.activeSessionId !== sessionId) activateExistingSession(sessionId)
    setContextMenuOwner("terminal")
    setTerminalContextMenu({ sessionId, x: event.clientX, y: event.clientY })
  }, [activateExistingSession, paletteOpen])

  const terminalMenuSession = terminalContextMenu
    ? workspace.sessions.find((session) => session.id === terminalContextMenu.sessionId)
    : undefined
  const terminalMenuSurface = terminalMenuSession ? terminalSurfaces.current.get(terminalMenuSession.id) : undefined
  const terminalMenuActions: CommandActions | undefined = terminalMenuSession
    ? {
        ...commandContext.actions,
        terminal: {
          ...commandContext.actions.terminal,
          search: () => {
            openSearchForSession(terminalMenuSession)
          },
          copy: () => terminalSurfaces.current.get(terminalMenuSession.id)?.copy(),
          paste: () => terminalSurfaces.current.get(terminalMenuSession.id)?.paste(),
          selectAll: () => terminalSurfaces.current.get(terminalMenuSession.id)?.selectAll(),
          clear: () => terminalSurfaces.current.get(terminalMenuSession.id)?.clear(),
          focus: () => terminalSurfaces.current.get(terminalMenuSession.id)?.focus()
        }
      }
    : undefined
  const terminalMenuContext: CommandContext = terminalMenuSession
    ? {
        ...commandContext,
        activeSession: terminalMenuSession,
        connectionState: terminalMenuSession.state,
        terminalBufferAvailable: terminalMenuSurface !== undefined && sessionKind(terminalMenuSession) === "ssh",
        terminal: terminalMenuSurface,
        selection: { hasSelection: terminalMenuSurface?.hasSelection() ?? false },
        clipboard: { canPaste: terminalMenuSession.state === "connected" },
        actions: terminalMenuActions!
      }
    : commandContext

  useEffect(() => {
    if (!terminalContextMenu) return
    if (activeNav === "terminal" && terminalMenuSession && terminalMenuSurface) return
    setTerminalContextMenu(undefined)
    setContextMenuOwner((owner) => owner === "terminal" ? undefined : owner)
    restorePaletteFocus()
  }, [activeNav, restorePaletteFocus, terminalContextMenu, terminalMenuSession, terminalMenuSurface])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalShortcutTarget(event.target)) return
      const commandId = matchGlobalShortcut(event, bridge.app.platform)
      const context = commandContextRef.current
      if (!commandId || !context || !isCommandEnabled(commandId, context)) return
      event.preventDefault()
      void executeCommand(commandId, context)
    }
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [bridge])

  useEffect(() => {
    if (activeNav !== "terminal") {
      pendingSearchSessionId.current = undefined
      setSearchOpen(false)
      return
    }
    if (pendingSearchSessionId.current === activeSession?.id) {
      pendingSearchSessionId.current = undefined
      return
    }
    pendingSearchSessionId.current = undefined
    setSearchOpen(false)
  }, [activeNav, activeSession?.id])

  const saveHost = async (profile: HostSaveProfile, credentials: { password?: string; passphrase?: string }): Promise<void> => {
    if (!capabilities.hostMutationsAvailable) throw new Error("Host mutations are unavailable")
    await bridge.hosts.save({ profile, credentials })
    setHosts((current) => upsertHost(current, profile as HostProfile))
    setEditor({ open: false })
  }

  const duplicateHost = async (host: HostProfile): Promise<HostProfile> => {
    if (!capabilities.hostMutationsAvailable) throw new Error("Host mutations are unavailable")
    const duplicate = await bridge.hosts.duplicate(host.id)
    setHosts((current) => upsertHost(current, duplicate))
    return duplicate
  }

  const toggleHostFavorite = async (host: HostProfile): Promise<HostProfile> => {
    if (!capabilities.hostMutationsAvailable) throw new Error("Host mutations are unavailable")
    const updated = await bridge.hosts.setFavorite(host.id, !host.favorite)
    setHosts((current) => upsertHost(current, updated))
    return updated
  }

  const removeHost = async (host: HostProfile): Promise<void> => {
    if (!capabilities.hostMutationsAvailable) throw new Error("Host mutations are unavailable")
    await bridge.hosts.remove(host.id)
    setHosts((current) => current.filter((candidate) => candidate.id !== host.id))
    if (hostForwardingHostId === host.id) {
      setHostForwardingHostId(undefined)
      setActiveNav("port-forwarding")
    }
  }

  const removeHostKey = async (entry: HostKeyInventoryEntry): Promise<void> => {
    if (!hostKeysAvailable) throw new Error("Host Key storage is unavailable")
    await bridge.hostKeys.remove(entry)
    await refreshHostKeys()
  }

  const hostList = (
    <HostList
      hosts={hosts}
      disabled={!capabilities.hostMutationsAvailable}
      onConnect={openNewHostSession}
      onOpenSftp={openSftpSession}
      onOpenForwarding={openHostForwardingFromHost}
      onConnectCommand={(command) => void connectSshCommand(command)}
      onAdd={() => setEditor({ open: true })}
      onEdit={(profile) => setEditor({ open: true, profile })}
      onDuplicate={duplicateHost}
      onToggleFavorite={toggleHostFavorite}
      onRemove={removeHost}
      history={history}
      sort={settings.hostSort ?? "name-asc"}
      favoritesOnly={settings.hostFavoritesOnly === true}
      onPreferencesChange={(update) => updateSettings({
        ...(update.sort ? { hostSort: update.sort } : {}),
        ...(update.favoritesOnly !== undefined ? { hostFavoritesOnly: update.favoritesOnly } : {})
      })}
      onImport={() => {
        if (!capabilities.hostMutationsAvailable) return
        void bridge.hosts.importSshConfig().then(() => bridge.hosts.list()).then(setHosts).catch(() => undefined)
      }}
    />
  )

  return (
    <div className="app-shell" data-theme={settings.globalThemeId ?? "forest"} data-ui-style="modern-professional">
      <Sidebar
        width={sidebarWidth}
        activeNav={activeNav}
        sessions={workspace.sessions}
        activeSessionId={workspace.activeSessionId}
        themeForHost={themeForHost}
        commandPaletteOpen={paletteOpen}
        contextMenuOwner={contextMenuOwner}
        onNavigate={navigateWorkspace}
        onSessionActivate={activateExistingSession}
        onSessionCommand={invokeSessionCommand}
        onContextMenuOwnerChange={handleContextMenuOwnerChange}
        onRestoreFocus={restoreSidebarFocus}
        commandContext={commandContext}
      />
      <main className="workspace" data-active-view={activeNav === "sftp" ? "sftp" : undefined}>
          <WorkspaceResizeHandle width={sidebarWidth} onWidthChange={changeSidebarWidth} />
          <WindowChrome />
          <RecoveryBanner state={bootstrapState} onRetry={retryBootstrap} onExportDiagnostics={() => bridge.diagnostics.export()} />
          <div className="workspace-stage" data-testid="workspace-stage" ref={workspaceStageRef} tabIndex={-1}>
          {workspace.sessions.some((session) => sessionKind(session) === "ssh") && (
            <div className="terminal-workspace-host" hidden={activeNav !== "terminal" || sessionKind(activeSession) !== "ssh"}>
              <TerminalWorkspace
                workspace={workspace}
                workspaceVisible={activeNav === "terminal" && sessionKind(activeSession) === "ssh"}
                themeForHost={themeForHost}
                overlay={<>
                  <TerminalConnectionOverlay
                    session={isSshSession(activeSession) ? activeSession : undefined}
                    onCancel={() => { if (activeSession) void bridge.sessions.cancelReconnect(activeSession.id).catch(() => undefined) }}
                    reconnectDisabled={!capabilities.sshAvailable}
                    onReconnectNow={() => { if (activeSession && capabilities.sshAvailable) void bridge.sessions.reconnect(activeSession.id).catch(() => undefined) }}
                    onClose={() => { if (activeSession) closeTerminalSession(activeSession) }}
                  />
                  <TerminalSearchOverlay controller={activeSearchController} open={searchOpen} onClose={() => setSearchOpen(false)} onRestoreFocus={restoreCurrentFocus} />
                </>}
                preferences={terminalPreferences}
                confirmMultilinePaste={settings.confirmMultilinePaste}
                multilinePasteConfirmation={t("terminal.multilinePasteConfirmation")}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
                onAck={handleTerminalAck}
                onController={handleTerminalController}
                onSearchController={handleSearchController}
                onCommandSurface={handleTerminalCommandSurface}
                onContextMenu={openTerminalContextMenu}
              />
            </div>
          )}
          {workspace.sessions.filter((session) => sessionKind(session) !== "ssh" && !(activeNav === "sftp" && isSftpSession(session))).map((session) => (
            <div
              className="session-content-host"
              data-session-id={session.id}
              data-theme={themeForHost(session.hostId)}
              hidden={activeNav !== "terminal" || workspace.activeSessionId !== session.id}
              key={session.id}
            >
              <SessionContentView
                session={session}
                host={hosts.find((candidate) => candidate.id === session.hostId)}
                bridge={bridge}
                onPatch={patchWorkspaceSession}
              />
            </div>
          ))}
          <div className="workspace-destination" data-destination="hosts" hidden={activeNav !== "hosts" && !(activeNav === "terminal" && workspace.sessions.length === 0)}>
            {hostList}
          </div>
          {activeNav === "settings" ? (
            <SettingsView locale={locale} settings={settings} hosts={hosts} bridge={hasDataProtectionBridge(bridge) ? bridge : undefined} onConfigurationImported={refreshConfigurationAfterImport} disabled={!settingsMutationsAvailable} terminalAppearanceDisabled={false} persistenceUnavailable={!settingsMutationsAvailable || settingsPersistenceFailed} onLocaleChange={(next) => {
              if (!settingsMutationsAvailable) return
              setLocale(next)
              updateSettings({ locale: next })
            }} onUpdate={updateSettings} onExportDiagnostics={() => bridge.diagnostics.export()} />
          ) : activeNav === "terminal" ? (
            null
          ) : activeNav === "hosts" ? (
            null
          ) : activeNav === "connections" || activeNav === "history" || activeNav === "trust" ? (
            <ConnectionsView
              tab={activeNav === "trust" ? "trust" : activeNav === "history" ? "history" : settings.connectionsTab ?? "history"}
              onTabChange={(connectionsTab) => updateSettings({ connectionsTab })}
              history={<HistoryView items={history} hosts={hosts} disabled={!capabilities.historyWritable} reconnectDisabled={!capabilities.sshAvailable} onReconnect={connectHost} onClear={() => {
                if (!capabilities.historyWritable) return
                void bridge.history.clear().then(() => setHistory([])).catch(() => undefined)
              }} />}
              trust={<TrustView entries={hostKeyInventory.entries} history={hostKeyInventory.history} hosts={hosts} disabled={!hostKeysAvailable} loading={hostKeyLoading} error={hostKeyLoadError} onRemove={removeHostKey} />}
            />
          ) : activeNav === "host-port-forwarding" && hostForwardingHostId ? (
            (() => {
              const hostSession = workspace.sessions.find((candidate) => candidate.hostId === hostForwardingHostId && isSshSession(candidate))
              const forwardingSession = workspace.sessions.find((candidate) => candidate.hostId === hostForwardingHostId && isPortForwardingSession(candidate))
              const hostConnectionId = hostSession && canUseConnection(hostSession.state) ? connectionIds.current.get(hostSession.id) : undefined
              const host = hosts.find((candidate) => candidate.id === hostForwardingHostId)
              return <PortsView mode="host" bridge={bridge} hostId={hostForwardingHostId} hostName={host?.name} connectionId={hostConnectionId} session={forwardingSession} username={host?.username} bindAddress={settings.bindAddress} onOpenSession={openPfSession} />
            })()
          ) : activeNav === "port-forwarding" ? (
            <PortsView mode="global" bridge={bridge} hosts={hosts} onOpenHost={openHostWorkspace} onOpenSession={openPfSession} />
          ) : activeNav === "sftp" ? (
            <SftpWorkspaceView
              hosts={hosts}
              selectedSession={isSftpSession(activeSession) ? activeSession : undefined}
              bridge={bridge}
              onOpen={openSftpSession}
              onPatch={patchWorkspaceSession}
            />
          ) : (
            <SnippetsView sessions={workspace.sessions} onSelect={activateExistingSession} />
          )}
          </div>
      </main>
      <HostEditor open={editor.open} profile={editor.profile} onClose={() => setEditor({ open: false })} onSave={saveHost} />
      <CommandPalette open={paletteOpen} context={commandContext} onClose={() => setPaletteOpen(false)} onRestoreFocus={restorePaletteFocus} />
      {!paletteOpen && terminalContextMenu && terminalMenuSession && <TerminalContextMenu open x={terminalContextMenu.x} y={terminalContextMenu.y} context={terminalMenuContext} onClose={closeTerminalContextMenu} onRestoreFocus={(request) => {
        if (request === "terminal.focus") return
        restorePaletteFocus(request)
      }} />}
    </div>
  )
}

function restoreWorkspace(snapshot: StoredWorkspaceWindow, hosts: HostProfile[], hostsKnown = true): RestoredWorkspace {
  const availableHostIds = new Set(hosts.map((host) => host.id))
  const seenSessionIds = new Set<string>()
  const restorableSessionIds: string[] = []
  let workspace = createTerminalWorkspaceState()

  for (const stored of snapshot.sessions) {
    if (seenSessionIds.has(stored.sessionId)) continue
    seenSessionIds.add(stored.sessionId)
    const kind = stored.kind ?? "ssh"
    if (kind === "sftp") {
      workspace = openSession(workspace, { id: stored.sessionId, hostId: stored.hostId, label: stored.label, kind, path: stored.path ?? "/" })
      continue
    }
    if (kind === "pf") {
      workspace = openSession(workspace, {
        id: stored.sessionId,
        hostId: stored.hostId,
        label: stored.label,
        kind,
        ...(stored.profileId ? { profileId: stored.profileId } : {}),
        applicationProtocol: stored.applicationProtocol
      })
      continue
    }
    workspace = openSession(workspace, {
      id: stored.sessionId,
      hostId: stored.hostId,
      label: stored.label,
      dimensions: validDimensions(stored.cols, stored.rows) ? { cols: stored.cols!, rows: stored.rows! } : undefined
    })
    const isAvailable = !hostsKnown || availableHostIds.has(stored.hostId)
    workspace = applyTerminalState(workspace, {
      kind: "state",
      sessionId: stored.sessionId,
      channelGeneration: 0,
      state: isAvailable ? "restoring" : "error",
      reason: isAvailable ? undefined : "configuration"
    })
    if (isAvailable) restorableSessionIds.push(stored.sessionId)
  }

  if (snapshot.activeSessionId) workspace = activateSession(workspace, snapshot.activeSessionId)
  const restoreActiveSessionId = restorableSessionIds.includes(workspace.activeSessionId ?? "")
    ? workspace.activeSessionId
    : restorableSessionIds[0]
  const pending = restorableSessionIds.map((sessionId) => ({
    sessionId,
    hostId: workspace.sessions.find((session) => session.id === sessionId)!.hostId,
    restorePriority: sessionId === restoreActiveSessionId ? "active" as const : "background" as const
  }))
  const layout = normalizeLayout(snapshot.layout, new Set(workspace.sessions.map((session) => session.id)))

  return { workspace: { ...workspace, layout }, pending, restoreActiveSessionId }
}

function normalizeLayout(layout: TerminalLayout | undefined, sessionIds: Set<string>): TerminalLayout | undefined {
  let normalized = layout
  for (const sessionId of layout ? visibleSessionIds(layout) : []) {
    if (!sessionIds.has(sessionId)) normalized = normalized ? removeSessionFromLayout(normalized, sessionId) : undefined
  }
  return normalized
}

function serializeWorkspace(workspace: TerminalWorkspaceState): {
  activeSessionId?: string
  sessions: StoredWorkspaceSession[]
  layout?: TerminalLayout
} {
  const sessions: StoredWorkspaceSession[] = []
  for (const session of workspace.sessions) {
    if (isSshSession(session)) {
      if (session.dimensions && validDimensions(session.dimensions.cols, session.dimensions.rows)) {
        sessions.push({ sessionId: session.id, hostId: session.hostId, label: session.label, cols: session.dimensions.cols, rows: session.dimensions.rows })
      }
    } else if (isSftpSession(session)) {
      sessions.push({ sessionId: session.id, hostId: session.hostId, label: session.label, kind: "sftp", path: session.browser.path })
    } else {
      sessions.push({
        sessionId: session.id,
        hostId: session.hostId,
        label: session.label,
        kind: "pf" as const,
        ...(session.profileId ? { profileId: session.profileId } : {}),
        ...(session.applicationProtocol ? { applicationProtocol: session.applicationProtocol } : {})
      })
    }
  }
  const sessionIds = new Set(sessions.map((session) => session.sessionId))
  return {
    activeSessionId: workspace.activeSessionId && sessionIds.has(workspace.activeSessionId) ? workspace.activeSessionId : undefined,
    sessions,
    layout: normalizeLayout(workspace.layout, sessionIds)
  }
}

function canUseConnection(state: WorkspaceSession["state"]): boolean {
  return state === "connected" || state === "reconnecting"
}

function isWorkspaceWritable(status: string): boolean {
  return status === "ok" || status === "recovered" || status === "defaulted"
}

function sameDimensions(left: TerminalDimensions | undefined, right: TerminalDimensions): boolean {
  return left?.cols === right.cols && left.rows === right.rows
}

function validDimensions(cols: unknown, rows: unknown): boolean {
  return typeof cols === "number" && Number.isInteger(cols) && cols >= 1 && cols <= 1_000 && typeof rows === "number" && Number.isInteger(rows) && rows >= 1 && rows <= 1_000
}

function terminalPreferencesForSettings(settings: AppSettings): TerminalPreferences {
  return {
    fontFamily: settings.terminalFont,
    fontSize: clampTerminalFontSize(settings.terminalFontSize),
    scrollback: settings.scrollback,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    terminalBell: settings.terminalBell
  }
}

function hasDataProtectionBridge(bridge: { configuration?: unknown; credentials?: unknown }): bridge is typeof bridge & {
  configuration: NonNullable<typeof bridge.configuration>
  credentials: NonNullable<typeof bridge.credentials>
} {
  return bridge.configuration !== undefined && bridge.credentials !== undefined
}

function clampTerminalFontSize(value: number): number {
  if (!Number.isFinite(value)) return defaultSettings.terminalFontSize
  return Math.max(10, Math.min(24, value))
}

function pickTerminalAppearanceUpdate(update: Partial<AppSettings>): Partial<AppSettings> {
  const appearance: Partial<AppSettings> = {}
  if (update.terminalFont !== undefined) appearance.terminalFont = update.terminalFont
  if (update.terminalFontSize !== undefined) appearance.terminalFontSize = clampTerminalFontSize(update.terminalFontSize)
  if (update.scrollback !== undefined) appearance.scrollback = update.scrollback
  if (update.cursorStyle !== undefined) appearance.cursorStyle = update.cursorStyle
  if (update.cursorBlink !== undefined) appearance.cursorBlink = update.cursorBlink
  if (update.terminalBell !== undefined) appearance.terminalBell = update.terminalBell
  return appearance
}

function omitTerminalAppearanceUpdate(update: Partial<AppSettings>): Partial<AppSettings> {
  const nonAppearance = { ...update }
  delete nonAppearance.terminalFont
  delete nonAppearance.terminalFontSize
  delete nonAppearance.scrollback
  delete nonAppearance.cursorStyle
  delete nonAppearance.cursorBlink
  delete nonAppearance.terminalBell
  return nonAppearance
}

function mergeSettingsResponse(
  current: AppSettings,
  persisted: AppSettings,
  update: Partial<AppSettings>,
  requestVersions: SettingsVersionSnapshot,
  currentVersions: SettingsVersionSnapshot,
  dirtyKeys: Set<SettingsKey>
): AppSettings {
  const requestedKeys = new Set(Object.keys(update) as SettingsKey[])
  const next = { ...current } as Record<SettingsKey, AppSettings[SettingsKey]>
  for (const key of settingsKeys) {
    if (isTerminalAppearanceKey(key) && !requestedKeys.has(key)) continue
    if (requestVersions[key] !== currentVersions[key]) continue
    if (!requestedKeys.has(key) && dirtyKeys.has(key)) continue
    next[key] = persisted[key]
  }
  return next as AppSettings
}

function mergeSettingsSnapshot(
  current: AppSettings,
  incoming: AppSettings,
  snapshotVersions: SettingsVersionSnapshot,
  currentVersions: SettingsVersionSnapshot,
  dirtyKeys: Set<SettingsKey>
): AppSettings {
  const next = { ...current } as Record<SettingsKey, AppSettings[SettingsKey]>
  for (const key of settingsKeys) {
    if (snapshotVersions[key] !== currentVersions[key] || dirtyKeys.has(key)) continue
    next[key] = incoming[key]
  }
  return next as AppSettings
}

function isTerminalAppearanceKey(key: SettingsKey): boolean {
  return terminalAppearanceKeys.includes(key)
}

export function failureReasonFor(error: unknown): TerminalFailureReason {
  const typedReason = error && typeof error === "object" && "reason" in error
    ? (error as { reason?: unknown }).reason
    : undefined
  if (isTerminalFailureReason(typedReason)) return typedReason
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code).toLowerCase()
    : ""
  if (message.includes("host key") && message.includes("changed")) return "host-key-changed"
  if (message.includes("host key")) return "host-key-rejected"
  if (message.includes("auth")) return "authentication"
  if (message.includes("credential") || message.includes("configuration") || message.includes("host profile")) return "configuration"
  if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout") || code === "etimedout") return "timeout"
  if (message.includes("dns") || message.includes("enotfound") || code === "enotfound" || code === "eai_again" || code === "eai_fail") return "dns"
  if (message.includes("cancel")) return "cancelled"
  return "unknown"
}

function isTerminalFailureReason(value: unknown): value is TerminalFailureReason {
  return value === "network" || value === "timeout" || value === "dns" || value === "authentication" ||
    value === "host-key-changed" || value === "host-key-rejected" || value === "configuration" ||
    value === "channel-ended" || value === "local-port-in-use" || value === "cancelled" || value === "unknown"
}
