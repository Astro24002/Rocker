import { Command, Search } from "lucide-react"
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { ComingSoonView } from "../components/ComingSoonView"
import { IconButton } from "../components/IconButton"
import { RecoveryBanner } from "../components/RecoveryBanner"
import { Sidebar, clampSidebarWidth, type WorkspaceNavKey } from "../components/Sidebar"
import { WindowChrome } from "../components/WindowChrome"
import { HostEditor } from "../features/hosts/HostEditor"
import { HostList } from "../features/hosts/HostList"
import { toggleFavorite, upsertHost } from "../features/hosts/host-state"
import { HistoryView } from "../features/history/HistoryView"
import { applyMetrics, createMonitorState, toggleMonitor } from "../features/monitoring/monitor-state"
import { PortsView } from "../features/ports/PortsView"
import { SettingsView } from "../features/settings/SettingsView"
import { CommandPalette, type CommandPaletteFocusRequest } from "../features/commands/CommandPalette"
import { executeCommand, isCommandEnabled, type CommandActions, type CommandContext, type CommandId, type TerminalCommandSurface } from "../features/commands/command-registry"
import { matchGlobalShortcut, shouldIgnoreGlobalShortcutTarget } from "../features/commands/command-shortcuts"
import { TerminalConnectionOverlay } from "../features/terminal/TerminalConnectionOverlay"
import { TerminalSearchOverlay } from "../features/terminal/TerminalSearchOverlay"
import { insertHorizontalSplit, removeSessionFromLayout, visibleSessionIds, type TerminalLayout } from "../features/terminal/layout"
import {
  activateSession,
  applyTerminalState,
  attachChannel,
  closeSession,
  createTerminalWorkspaceState,
  openSession,
  type TerminalWorkspaceState,
  type WorkspaceSession
} from "../features/terminal/session-state"
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace"
import { type TerminalController, type TerminalPreferences } from "../features/terminal/terminal-controller"
import type { TerminalSearchController } from "../features/terminal/terminal-search"
import { I18nProvider, useI18n } from "../i18n"
import { bootstrapReducer, createBootstrapState, deriveBootstrapCapabilities, retryableBootstrapResources } from "./bootstrap-state"
import { getRockerBridge } from "./bridge"
import type { BootstrapResourceName } from "../../electron/ipc/bridge-contract"
import type {
  AppSettings,
  ConnectionHistoryItem,
  HostProfile,
  StoredWorkspaceWindow,
  TerminalDimensions,
  TerminalFailureReason,
  TerminalSessionEvent,
  TerminalStateEvent
} from "./types"

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
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [history, setHistory] = useState<ConnectionHistoryItem[]>([])
  const [editor, setEditor] = useState<{ open: boolean; profile?: HostProfile }>({ open: false })
  const [workspace, setWorkspace] = useState<TerminalWorkspaceState>(createTerminalWorkspaceState)
  const [bootstrapState, dispatchBootstrap] = useReducer(bootstrapReducer, undefined, createBootstrapState)
  const [monitor, setMonitor] = useState(createMonitorState)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [settingsPersistenceFailed, setSettingsPersistenceFailed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [, setCommandContextVersion] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? defaultSettings.sidebarWidth)
    return clampSidebarWidth(Number.isFinite(stored) ? stored : defaultSettings.sidebarWidth)
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
      return session
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
      if (!session || sameDimensions(session.dimensions, dimensions)) return current
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

  const queueSessionOpen = useCallback((host: HostProfile, label: string, options: Pick<PendingTerminalOpen, "forceNewConnection"> = {}): void => {
    if (!capabilities.sshAvailable) return
    const sessionId = crypto.randomUUID()
    pendingOpens.current.set(sessionId, { hostId: host.id, forceNewConnection: options.forceNewConnection })
    setWorkspace((current) => openSession(current, { id: sessionId, hostId: host.id, label }))
    setActiveNav("terminal")
  }, [capabilities.sshAvailable])

  useEffect(() => {
    const unsubscribeSession = bridge.events.onSessionEvent(handleSessionEvent)
    return unsubscribeSession
  }, [bridge, handleSessionEvent])

  useEffect(() => {
    const unsubscribeLaunch = bridge.events.onSessionLaunch(({ hostId }) => {
      if (!capabilities.sshAvailable) return
      void bridge.hosts.list().then((availableHosts) => {
        const host = availableHosts.find((candidate) => candidate.id === hostId)
        if (host) queueSessionOpen(host, host.name, { forceNewConnection: true })
      }).catch(() => undefined)
    })
    return unsubscribeLaunch
  }, [bridge, capabilities.sshAvailable, queueSessionOpen])

  useEffect(() => {
    let cancelled = false

    const initialize = async (): Promise<void> => {
      dispatchBootstrap({ type: "load-start" })
      try {
        const snapshot = await bridge.bootstrap.load()
        if (cancelled) return

        workspaceWritable.current = isWorkspaceWritable(snapshot.workspace.health.status)
        dispatchBootstrap({ type: "load-success", snapshot })
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
        setSidebarWidth(clampSidebarWidth(nextSettings.sidebarWidth))

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
          if (restored.workspace.sessions.length > 0) setActiveNav("terminal")
        }
      } catch {
        if (!cancelled) {
          workspaceWritable.current = false
          dispatchBootstrap({ type: "load-error" })
        }
      }
    }

    void initialize()
    return () => { cancelled = true }
  }, [bridge])

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
          setSidebarWidth(clampSidebarWidth(nextSettings.sidebarWidth))
          if (retryStatusVersion === latestSettingsStatusVersion.current) setSettingsPersistenceFailed(false)
        }
      }
      if (result.history) setHistory(result.history.health.status === "blocked" ? [] : result.history.value ?? [])
      if (result.hosts) setHosts(result.hosts.health.status === "blocked" ? [] : result.hosts.value ?? [])

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
          if (restored.workspace.sessions.length > 0) setActiveNav("terminal")
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
          void openPendingSession(sessionId, session?.dimensions ?? { cols: 120, rows: 40 }, true)
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
  }, [bootstrapState, bridge, hosts, openPendingSession, setLocale, workspace])

  const activeSession = workspace.sessions.find((session) => session.id === workspace.activeSessionId)
  const activeHost = activeSession ? hosts.find((host) => host.id === activeSession.hostId) : undefined
  const activeConnectionId = activeSession && canUseConnection(activeSession.state)
    ? connectionIds.current.get(activeSession.id)
    : undefined
  const activeSearchController = activeSession ? searchControllers.current.get(activeSession.id) : undefined
  const activeTerminalSurface = activeSession ? terminalSurfaces.current.get(activeSession.id) : undefined
  activeSessionIdRef.current = workspace.activeSessionId
  activeNavigationRef.current = activeNav

  useEffect(() => {
    if (!activeSession || activeSession.state !== "connected") {
      setMonitor((current) => ({ ...current, metrics: undefined, error: undefined }))
      return
    }

    let cancelled = false
    const sample = (): void => {
      void bridge.monitor.sample(activeSession.id).then((metrics) => {
        if (!cancelled) setMonitor((current) => applyMetrics(current, metrics))
      }).catch((error) => {
        if (!cancelled) setMonitor((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }))
      })
    }
    sample()
    const interval = window.setInterval(sample, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeSession?.id, activeSession?.state, bridge])

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
    const next = clampSidebarWidth(width)
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

  const connectHost = (host: HostProfile): void => {
    if (!capabilities.sshAvailable) return
    queueSessionOpen(host, host.name)
  }

  const duplicateSession = (session: WorkspaceSession, forceNewConnection = false, split = false): void => {
    if (!capabilities.sshAvailable) return
    const host = hosts.find((candidate) => candidate.id === session.hostId)
    if (!host) return
    const sessionId = crypto.randomUUID()
    pendingOpens.current.set(sessionId, { hostId: host.id, forceNewConnection })
    setWorkspace((current) => {
      const opened = openSession(current, {
        id: sessionId,
        hostId: session.hostId,
        label: `${session.label}${split ? " split" : " copy"}`
      })
      if (!split) return opened
      const layout = current.layout && visibleSessionIds(current.layout).includes(session.id)
        ? current.layout
        : { kind: "leaf" as const, sessionId: session.id }
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

  const closeTerminalSession = (session: WorkspaceSession): void => {
    pendingOpens.current.delete(session.id)
    releaseRestoreAdmission(session.id)
    connectionIds.current.delete(session.id)
    controllers.current.delete(session.id)
    searchControllers.current.delete(session.id)
    terminalSurfaces.current.delete(session.id)
    void bridge.sessions.close(session.id).catch(() => undefined)
    setWorkspace((current) => closeSession(current, session.id))
    if (workspace.sessions.length <= 1) setActiveNav("hosts")
  }

  const focusCurrentTerminal = useCallback((): boolean => {
    if (activeNavigationRef.current !== "terminal") return false
    const sessionId = activeSessionIdRef.current
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

  const commandActions: CommandActions = {
    terminal: {
      search: () => {
        setActiveNav("terminal")
        setSearchOpen(true)
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
      activate: (session) => {
        setWorkspace((current) => activateSession(current, session.id))
        setActiveNav("terminal")
      },
      reconnect: (session) => capabilities.sshAvailable ? bridge.sessions.reconnect(session.id) : undefined,
      rename: renameTerminalSession,
      duplicate: (session) => duplicateSession(session),
      duplicateWindow: (session) => capabilities.sshAvailable ? bridge.sessions.duplicateInNewWindow(session.hostId) : undefined,
      splitHorizontal: (session) => duplicateSession(session, false, true),
      close: closeTerminalSession
    },
    navigation: {
      navigate: (destination) => setActiveNav(destination)
    },
    palette: { open: () => setPaletteOpen(true) }
  }
  const commandContext: CommandContext = {
    activeSession,
    connectionState: activeSession?.state,
    terminalBufferAvailable: activeSession !== undefined,
    terminal: activeTerminalSurface,
    selection: { hasSelection: activeTerminalSurface?.hasSelection() ?? false },
    clipboard: { canPaste: activeSession?.state === "connected" },
    activeNavigation: activeNav,
    settingsAvailable: true,
    settingsPersistenceAvailable: settingsMutationsAvailable,
    recentSessions: [],
    actions: commandActions
  }
  commandContextRef.current = commandContext

  const invokeCommand = (commandId: CommandId): void => {
    const context = commandContextRef.current
    if (!context || !isCommandEnabled(commandId, context)) return
    void executeCommand(commandId, context)
  }

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
    setSearchOpen(false)
  }, [activeSession?.id])

  const saveHost = async (profile: HostProfile, credentials: { password?: string; passphrase?: string }): Promise<void> => {
    if (!capabilities.hostMutationsAvailable) return
    await bridge.hosts.save({ profile, credentials })
    setHosts((current) => upsertHost(current, profile))
    setEditor({ open: false })
  }

  const favoriteHost = async (host: HostProfile): Promise<void> => {
    if (!capabilities.hostMutationsAvailable) return
    const updated = { ...host, favorite: !host.favorite }
    await bridge.hosts.save({ profile: updated })
    setHosts((current) => toggleFavorite(current, host.id))
  }

  const hostList = (
    <HostList
      hosts={hosts}
      disabled={!capabilities.hostMutationsAvailable}
      onConnect={connectHost}
      onAdd={() => setEditor({ open: true })}
      onEdit={(profile) => setEditor({ open: true, profile })}
      onImport={() => {
        if (!capabilities.hostMutationsAvailable) return
        void bridge.hosts.importSshConfig().then(() => bridge.hosts.list()).then(setHosts).catch(() => undefined)
      }}
      onFavorite={(host) => void favoriteHost(host)}
    />
  )

  return (
    <div className="app-shell" data-ui-style="modern-professional">
      <WindowChrome />
      <div className="app-content">
        <Sidebar
          width={sidebarWidth}
          activeNav={activeNav}
          sessions={workspace.sessions}
          activeSessionId={workspace.activeSessionId}
          onWidthChange={changeSidebarWidth}
          onNavigate={setActiveNav}
          onSessionActivate={(sessionId) => setWorkspace((current) => activateSession(current, sessionId))}
          onSessionDuplicate={(session) => duplicateSession(session)}
          onSessionDuplicateWindow={(session) => {
            if (capabilities.sshAvailable) void bridge.sessions.duplicateInNewWindow(session.hostId)
          }}
          onSessionRename={renameTerminalSession}
          onSessionSplit={(session) => duplicateSession(session, false, true)}
          onSessionClose={closeTerminalSession}
        />
        <main className="workspace">
          <RecoveryBanner state={bootstrapState} onRetry={retryBootstrap} onExportDiagnostics={() => bridge.diagnostics.export()} />
          <div className="workspace-stage" data-testid="workspace-stage" ref={workspaceStageRef} tabIndex={-1}>
          <div aria-label={t("commands.title")} className="workspace-command-affordances">
            <IconButton disabled={!isCommandEnabled("terminal.search", commandContext)} label={t("terminal.search")} onClick={() => invokeCommand("terminal.search")}>
              <Search size={15} />
            </IconButton>
            <IconButton label={t("commands.openPalette")} onClick={() => invokeCommand("palette.open")}>
              <Command size={15} />
            </IconButton>
          </div>
          {workspace.sessions.length > 0 && (
            <div className="terminal-workspace-host" hidden={activeNav !== "terminal"}>
              <TerminalWorkspace
                workspace={workspace}
                workspaceVisible={activeNav === "terminal"}
                overlay={<>
                  <TerminalConnectionOverlay
                    session={activeSession}
                    onCancel={() => { if (activeSession) void bridge.sessions.cancelReconnect(activeSession.id).catch(() => undefined) }}
                    reconnectDisabled={!capabilities.sshAvailable}
                    onReconnectNow={() => { if (activeSession && capabilities.sshAvailable) void bridge.sessions.reconnect(activeSession.id).catch(() => undefined) }}
                    onClose={() => { if (activeSession) closeTerminalSession(activeSession) }}
                  />
                  <TerminalSearchOverlay controller={activeSearchController} open={searchOpen} onClose={() => setSearchOpen(false)} onRestoreFocus={restoreCurrentFocus} />
                </>}
                monitor={monitor}
                monitorHostName={activeHost?.name}
                onMonitorToggle={() => setMonitor((current) => toggleMonitor(current))}
                preferences={terminalPreferences}
                confirmMultilinePaste={settings.confirmMultilinePaste}
                multilinePasteConfirmation={t("terminal.multilinePasteConfirmation")}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
                onAck={handleTerminalAck}
                onController={handleTerminalController}
                onSearchController={handleSearchController}
                onCommandSurface={handleTerminalCommandSurface}
              />
            </div>
          )}
          {activeNav === "settings" ? (
            <SettingsView locale={locale} settings={settings} disabled={!settingsMutationsAvailable} terminalAppearanceDisabled={false} persistenceUnavailable={!settingsMutationsAvailable || settingsPersistenceFailed} onLocaleChange={(next) => {
              if (!settingsMutationsAvailable) return
              setLocale(next)
              updateSettings({ locale: next })
            }} onUpdate={updateSettings} onExportDiagnostics={() => bridge.diagnostics.export()} />
          ) : activeNav === "terminal" ? (
            workspace.sessions.length === 0 ? hostList : null
          ) : activeNav === "hosts" ? (
            hostList
          ) : activeNav === "history" ? (
            <HistoryView items={history} hosts={hosts} disabled={!capabilities.historyWritable} reconnectDisabled={!capabilities.sshAvailable} onReconnect={connectHost} onClear={() => {
              if (!capabilities.historyWritable) return
              void bridge.history.clear().then(() => setHistory([])).catch(() => undefined)
            }} />
          ) : activeNav === "ports" ? (
            <PortsView bridge={bridge} connectionId={activeConnectionId} session={activeSession} username={activeHost?.username} bindAddress={settings.bindAddress} />
          ) : activeNav === "local-terminal" ? (
            <ComingSoonView feature="local-terminal" />
          ) : (
            <ComingSoonView feature={activeNav} />
          )}
          </div>
        </main>
        <HostEditor open={editor.open} profile={editor.profile} onClose={() => setEditor({ open: false })} onSave={(profile, credentials) => void saveHost(profile, credentials)} />
        <CommandPalette open={paletteOpen} context={commandContext} onClose={() => setPaletteOpen(false)} onRestoreFocus={restorePaletteFocus} />
      </div>
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
    workspace = openSession(workspace, {
      id: stored.sessionId,
      hostId: stored.hostId,
      label: stored.label,
      dimensions: validDimensions(stored.cols, stored.rows) ? { cols: stored.cols, rows: stored.rows } : undefined
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
  sessions: Array<{ sessionId: string; hostId: string; label: string; cols: number; rows: number }>
  layout?: TerminalLayout
} {
  const sessions = workspace.sessions
    .filter((session) => session.dimensions && validDimensions(session.dimensions.cols, session.dimensions.rows))
    .map((session) => ({
      sessionId: session.id,
      hostId: session.hostId,
      label: session.label,
      cols: session.dimensions!.cols,
      rows: session.dimensions!.rows
    }))
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

function validDimensions(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && cols >= 1 && cols <= 1_000 && Number.isInteger(rows) && rows >= 1 && rows <= 1_000
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
