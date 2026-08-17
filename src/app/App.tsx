import { useEffect, useMemo, useState } from "react"
import { Sidebar, clampSidebarWidth, type NavKey } from "../components/Sidebar"
import { HostEditor } from "../features/hosts/HostEditor"
import { HostList } from "../features/hosts/HostList"
import { toggleFavorite, upsertHost } from "../features/hosts/host-state"
import { HistoryView } from "../features/history/HistoryView"
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace"
import {
  activateTab,
  appendOutput,
  attachSession,
  clearTabOutput,
  closeTab,
  createSessionState,
  openTab,
  setLocalTabState,
  setTabState,
  type TerminalTab
} from "../features/terminal/session-state"
import { I18nProvider, useI18n } from "../i18n"
import type { AppSettings, ConnectionHistoryItem, HostProfile, SessionEvent } from "./types"
import { getRockerBridge } from "./bridge"
import { ComingSoonView } from "../components/ComingSoonView"
import { MonitorSummary } from "../features/monitoring/MonitorSummary"
import { applyMetrics, createMonitorState, toggleMonitor } from "../features/monitoring/monitor-state"
import { PortsView } from "../features/ports/PortsView"
import { SettingsView } from "../features/settings/SettingsView"

export default function App() {
  return <I18nProvider><Workspace /></I18nProvider>
}

function Workspace() {
  const bridge = useMemo(() => getRockerBridge(), [])
  const { locale, setLocale } = useI18n()
  const [activeNav, setActiveNav] = useState<NavKey | "settings" | "terminal">("hosts")
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [history, setHistory] = useState<ConnectionHistoryItem[]>([])
  const [editor, setEditor] = useState<{ open: boolean; profile?: HostProfile }>({ open: false })
  const [sessions, setSessions] = useState(createSessionState)
  const [monitor, setMonitor] = useState(createMonitorState)
  const [settings, setSettings] = useState<AppSettings>({ locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13, connectionTimeout: 15, autoReconnect: true, portScanInterval: 15, bindAddress: "127.0.0.1" })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? 220)
    return clampSidebarWidth(Number.isFinite(stored) ? stored : 220)
  })

  useEffect(() => {
    void bridge.hosts.list().then(setHosts)
    void bridge.history.list().then(setHistory)
    void bridge.settings.get().then((stored) => {
      setSettings(stored)
      setLocale(stored.locale)
      setSidebarWidth(clampSidebarWidth(stored.sidebarWidth))
    })
    return bridge.events.onSessionEvent((event) => handleSessionEvent(event))
  }, [bridge])

  const activeTab = sessions.tabs.find((tab) => tab.id === sessions.activeId)
  const activeHost = activeTab ? hosts.find((host) => host.id === activeTab.hostId) : undefined

  useEffect(() => {
    if (!activeTab?.sessionId || activeTab.state !== "connected") return
    let cancelled = false
    const sample = (): void => {
      void bridge.monitor.sample(activeTab.sessionId!).then((metrics) => {
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
  }, [activeTab?.sessionId, activeTab?.state, bridge])

  const handleSessionEvent = (event: SessionEvent): void => {
    setSessions((current) => {
      if (event.kind === "data") return appendOutput(current, event.sessionId, event.data)
      if (event.kind === "error") return setTabState(current, event.sessionId, "error", event.message)
      if (event.kind === "state" && event.state === "closed") return setTabState(current, event.sessionId, "disconnected")
      if (event.kind === "state" && event.state === "connected") return setTabState(current, event.sessionId, "connected")
      return current
    })
  }

  const changeSidebarWidth = (width: number): void => {
    const next = clampSidebarWidth(width)
    localStorage.setItem("rocker.sidebarWidth", String(next))
    setSidebarWidth(next)
    void bridge.settings.update({ sidebarWidth: next }).then(setSettings)
  }

  const updateSettings = (update: Partial<AppSettings>): void => {
    setSettings((current) => ({ ...current, ...update }))
    void bridge.settings.update(update).then(setSettings)
  }

  const connectHost = async (host: HostProfile): Promise<void> => {
    const localId = crypto.randomUUID()
    setSessions((current) => openTab(current, { id: localId, hostId: host.id, label: host.name }))
    setActiveNav("terminal")
    try {
      const session = await bridge.sessions.open({ hostId: host.id, cols: 100, rows: 30 })
      setSessions((current) => attachSession(current, localId, session.sessionId))
      void bridge.history.list().then(setHistory)
    } catch (error) {
      setSessions((current) => setLocalTabState(current, localId, "error", error instanceof Error ? error.message : String(error)))
    }
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

  const closeTerminalTab = async (tab: TerminalTab): Promise<void> => {
    if (tab.sessionId && tab.state !== "disconnected") await bridge.sessions.close(tab.sessionId).catch(() => undefined)
    setSessions((current) => closeTab(current, tab.id))
    if (sessions.tabs.length <= 1) setActiveNav("hosts")
  }

  const reconnectTerminal = async (tab: TerminalTab): Promise<void> => {
    if (!tab.sessionId) return
    setSessions((current) => setLocalTabState(current, tab.id, "reconnecting"))
    try {
      const next = await bridge.sessions.reconnect(tab.sessionId)
      setSessions((current) => attachSession(current, tab.id, next.sessionId))
    } catch (error) {
      setSessions((current) => setLocalTabState(current, tab.id, "error", error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        width={sidebarWidth}
        activeNav={activeNav}
        sessions={sessions.tabs}
        activeSessionId={sessions.activeId}
        monitor={<MonitorSummary state={monitor} hostName={activeHost?.name} onToggle={() => setMonitor((current) => toggleMonitor(current))} />}
        onWidthChange={changeSidebarWidth}
        onNavigate={setActiveNav}
        onSessionActivate={(id) => setSessions((current) => activateTab(current, id))}
      />
      <main className="workspace">
        {activeNav === "settings" ? (
          <SettingsView locale={locale} settings={settings} onLocaleChange={(next) => { setLocale(next); updateSettings({ locale: next }) }} onUpdate={updateSettings} />
        ) : activeNav === "terminal" && sessions.tabs.length > 0 ? (
          <TerminalWorkspace
            tabs={sessions.tabs}
            activeId={sessions.activeId}
            onActivate={(id) => setSessions((current) => activateTab(current, id))}
            onClose={(tab) => void closeTerminalTab(tab)}
            onNew={() => setActiveNav("hosts")}
            onReconnect={(tab) => void reconnectTerminal(tab)}
            onDisconnect={(tab) => tab.sessionId && void bridge.sessions.close(tab.sessionId)}
            onClear={(tab) => setSessions((current) => clearTabOutput(current, tab.id))}
            onInput={(tab, data) => tab.sessionId && void bridge.sessions.write(tab.sessionId, data)}
            onResize={(tab, cols, rows) => tab.sessionId && void bridge.sessions.resize(tab.sessionId, cols, rows)}
          />
        ) : activeNav === "hosts" ? (
          <HostList
            hosts={hosts}
            onConnect={(host) => void connectHost(host)}
            onAdd={() => setEditor({ open: true })}
            onEdit={(profile) => setEditor({ open: true, profile })}
            onImport={() => void bridge.hosts.importSshConfig().then(() => bridge.hosts.list()).then(setHosts)}
            onFavorite={(host) => void favoriteHost(host)}
          />
        ) : activeNav === "history" ? (
          <HistoryView items={history} hosts={hosts} onReconnect={(host) => void connectHost(host)} onClear={() => void bridge.history.clear().then(() => setHistory([]))} />
        ) : activeNav === "ports" ? (
          <PortsView bridge={bridge} session={activeTab} username={activeHost?.username} />
        ) : activeNav === "sftp" || activeNav === "snippets" ? (
          <ComingSoonView feature={activeNav} />
        ) : (
          <HostList hosts={hosts} onConnect={(host) => void connectHost(host)} onAdd={() => setEditor({ open: true })} onEdit={(profile) => setEditor({ open: true, profile })} onImport={() => void bridge.hosts.importSshConfig().then(() => bridge.hosts.list()).then(setHosts)} onFavorite={(host) => void favoriteHost(host)} />
        )}
      </main>
      <HostEditor open={editor.open} profile={editor.profile} onClose={() => setEditor({ open: false })} onSave={(profile, credentials) => void saveHost(profile, credentials)} />
    </div>
  )
}
