import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ComingSoonView } from "../components/ComingSoonView"
import { Sidebar, clampSidebarWidth, type NavKey } from "../components/Sidebar"
import { WindowChrome } from "../components/WindowChrome"
import { HostEditor } from "../features/hosts/HostEditor"
import { HostList } from "../features/hosts/HostList"
import { toggleFavorite, upsertHost } from "../features/hosts/host-state"
import { HistoryView } from "../features/history/HistoryView"
import { applyMetrics, createMonitorState, toggleMonitor } from "../features/monitoring/monitor-state"
import { PortsView } from "../features/ports/PortsView"
import { SettingsView } from "../features/settings/SettingsView"
import { TerminalConnectionOverlay } from "../features/terminal/TerminalConnectionOverlay"
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
import { type TerminalController } from "../features/terminal/terminal-controller"
import { I18nProvider, useI18n } from "../i18n"
import { getRockerBridge } from "./bridge"
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

const defaultSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
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
  const [activeNav, setActiveNav] = useState<NavKey | "terminal">("hosts")
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [history, setHistory] = useState<ConnectionHistoryItem[]>([])
  const [editor, setEditor] = useState<{ open: boolean; profile?: HostProfile }>({ open: false })
  const [workspace, setWorkspace] = useState<TerminalWorkspaceState>(createTerminalWorkspaceState)
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false)
  const [monitor, setMonitor] = useState(createMonitorState)
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? defaultSettings.sidebarWidth)
    return clampSidebarWidth(Number.isFinite(stored) ? stored : defaultSettings.sidebarWidth)
  })

  const controllers = useRef(new Map<string, TerminalController>())
  const connectionIds = useRef(new Map<string, string>())
  const pendingOpens = useRef(new Map<string, PendingTerminalOpen>())
  const openingSessionIds = useRef(new Set<string>())
  const restoreAdmission = useRef<RestoreAdmission | undefined>(undefined)

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

  const openPendingSession = useCallback(async (sessionId: string, dimensions: TerminalDimensions): Promise<void> => {
    const pending = pendingOpens.current.get(sessionId)
    if (!pending || openingSessionIds.current.has(sessionId)) return

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
  }, [bridge, markSessionState, releaseRestoreAdmission])

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
    if (controller) controllers.current.set(sessionId, controller)
    else controllers.current.delete(sessionId)
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
    const sessionId = crypto.randomUUID()
    pendingOpens.current.set(sessionId, { hostId: host.id, forceNewConnection: options.forceNewConnection })
    setWorkspace((current) => openSession(current, { id: sessionId, hostId: host.id, label }))
    setActiveNav("terminal")
  }, [])

  useEffect(() => {
    const unsubscribeSession = bridge.events.onSessionEvent(handleSessionEvent)
    return unsubscribeSession
  }, [bridge, handleSessionEvent])

  useEffect(() => {
    const unsubscribeLaunch = bridge.events.onSessionLaunch(({ hostId }) => {
      void bridge.hosts.list().then((availableHosts) => {
        const host = availableHosts.find((candidate) => candidate.id === hostId)
        if (host) queueSessionOpen(host, host.name, { forceNewConnection: true })
      }).catch(() => undefined)
    })
    return unsubscribeLaunch
  }, [bridge, queueSessionOpen])

  useEffect(() => {
    let cancelled = false

    const initialize = async (): Promise<void> => {
      try {
        const [availableHosts, loadedHistory, storedSettings] = await Promise.all([
          bridge.hosts.list(),
          bridge.history.list(),
          bridge.settings.get()
        ])
        if (cancelled) return

        setHosts(availableHosts)
        setHistory(loadedHistory)
        setSettings(storedSettings)
        setLocale(storedSettings.locale)
        setSidebarWidth(clampSidebarWidth(storedSettings.sidebarWidth))

        if (storedSettings.restorePreviousWorkspace) {
          const snapshot = await bridge.workspace.load()
          if (cancelled) return
          if (snapshot) {
            const restored = restoreWorkspace(snapshot, availableHosts)
            if (restored.restoreActiveSessionId) {
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
              for (const pending of restored.pending) {
                pendingOpens.current.set(pending.sessionId, {
                  hostId: pending.hostId,
                  restorePriority: pending.restorePriority
                })
              }
            }
            setWorkspace(restored.workspace)
            if (restored.workspace.sessions.length > 0) setActiveNav("terminal")
          }
        }
      } finally {
        if (!cancelled) setWorkspaceHydrated(true)
      }
    }

    void initialize().catch(() => undefined)
    return () => { cancelled = true }
  }, [bridge])

  useEffect(() => {
    if (!workspaceHydrated) return
    void bridge.workspace.save(serializeWorkspace(workspace)).catch(() => undefined)
  }, [bridge, workspace, workspaceHydrated])

  const activeSession = workspace.sessions.find((session) => session.id === workspace.activeSessionId)
  const activeHost = activeSession ? hosts.find((host) => host.id === activeSession.hostId) : undefined
  const activeConnectionId = activeSession && canUseConnection(activeSession.state)
    ? connectionIds.current.get(activeSession.id)
    : undefined

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

  const changeSidebarWidth = (width: number): void => {
    const next = clampSidebarWidth(width)
    localStorage.setItem("rocker.sidebarWidth", String(next))
    setSidebarWidth(next)
    void bridge.settings.update({ sidebarWidth: next }).then(setSettings).catch(() => undefined)
  }

  const updateSettings = (update: Partial<AppSettings>): void => {
    setSettings((current) => ({ ...current, ...update }))
    void bridge.settings.update(update).then(setSettings).catch(() => undefined)
  }

  const connectHost = (host: HostProfile): void => queueSessionOpen(host, host.name)

  const duplicateSession = (session: WorkspaceSession, forceNewConnection = false, split = false): void => {
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
    void bridge.sessions.close(session.id).catch(() => undefined)
    setWorkspace((current) => closeSession(current, session.id))
    if (workspace.sessions.length <= 1) setActiveNav("hosts")
  }

  const saveHost = async (profile: HostProfile, credentials: { password?: string; passphrase?: string }): Promise<void> => {
    await bridge.hosts.save({ profile, credentials })
    setHosts((current) => upsertHost(current, profile))
    setEditor({ open: false })
  }

  const favoriteHost = async (host: HostProfile): Promise<void> => {
    const updated = { ...host, favorite: !host.favorite }
    await bridge.hosts.save({ profile: updated })
    setHosts((current) => toggleFavorite(current, host.id))
  }

  const hostList = (
    <HostList
      hosts={hosts}
      onConnect={connectHost}
      onAdd={() => setEditor({ open: true })}
      onEdit={(profile) => setEditor({ open: true, profile })}
      onImport={() => void bridge.hosts.importSshConfig().then(() => bridge.hosts.list()).then(setHosts).catch(() => undefined)}
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
          onSessionDuplicateWindow={(session) => void bridge.sessions.duplicateInNewWindow(session.hostId)}
          onSessionRename={renameTerminalSession}
          onSessionSplit={(session) => duplicateSession(session, false, true)}
          onSessionClose={closeTerminalSession}
        />
        <main className="workspace">
          {workspace.sessions.length > 0 && (
            <div className="terminal-workspace-host" hidden={activeNav !== "terminal"}>
              <TerminalWorkspace
                workspace={workspace}
                workspaceVisible={activeNav === "terminal"}
                overlay={<TerminalConnectionOverlay
                  session={activeSession}
                  onCancel={() => { if (activeSession) void bridge.sessions.cancelReconnect(activeSession.id).catch(() => undefined) }}
                  onReconnectNow={() => { if (activeSession) void bridge.sessions.reconnect(activeSession.id).catch(() => undefined) }}
                />}
                monitor={monitor}
                monitorHostName={activeHost?.name}
                onMonitorToggle={() => setMonitor((current) => toggleMonitor(current))}
                fontFamily={settings.terminalFont}
                fontSize={settings.terminalFontSize}
                confirmMultilinePaste={settings.confirmMultilinePaste}
                multilinePasteConfirmation={t("terminal.multilinePasteConfirmation")}
                onInput={handleTerminalInput}
                onResize={handleTerminalResize}
                onAck={handleTerminalAck}
                onController={handleTerminalController}
              />
            </div>
          )}
          {activeNav === "settings" ? (
            <SettingsView locale={locale} settings={settings} onLocaleChange={(next) => { setLocale(next); updateSettings({ locale: next }) }} onUpdate={updateSettings} />
          ) : activeNav === "terminal" ? (
            workspace.sessions.length === 0 ? hostList : null
          ) : activeNav === "hosts" ? (
            hostList
          ) : activeNav === "history" ? (
            <HistoryView items={history} hosts={hosts} onReconnect={connectHost} onClear={() => void bridge.history.clear().then(() => setHistory([])).catch(() => undefined)} />
          ) : activeNav === "ports" ? (
            <PortsView bridge={bridge} connectionId={activeConnectionId} session={activeSession} username={activeHost?.username} bindAddress={settings.bindAddress} />
          ) : (
            <ComingSoonView feature={activeNav} />
          )}
        </main>
        <HostEditor open={editor.open} profile={editor.profile} onClose={() => setEditor({ open: false })} onSave={(profile, credentials) => void saveHost(profile, credentials)} />
      </div>
    </div>
  )
}

function restoreWorkspace(snapshot: StoredWorkspaceWindow, hosts: HostProfile[]): RestoredWorkspace {
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
    const isAvailable = availableHostIds.has(stored.hostId)
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

function sameDimensions(left: TerminalDimensions | undefined, right: TerminalDimensions): boolean {
  return left?.cols === right.cols && left.rows === right.rows
}

function validDimensions(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && cols >= 1 && cols <= 1_000 && Number.isInteger(rows) && rows >= 1 && rows <= 1_000
}

function failureReasonFor(error: unknown): TerminalFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  if (message.includes("host key") && message.includes("changed")) return "host-key-changed"
  if (message.includes("host key")) return "host-key-rejected"
  if (message.includes("auth")) return "authentication"
  if (message.includes("credential") || message.includes("configuration") || message.includes("host profile")) return "configuration"
  if (message.includes("timeout")) return "timeout"
  if (message.includes("dns") || message.includes("enotfound")) return "dns"
  if (message.includes("cancel")) return "cancelled"
  return "unknown"
}
