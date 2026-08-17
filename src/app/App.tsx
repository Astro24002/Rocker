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
import type { ConnectionHistoryItem, HostProfile, SessionEvent } from "./types"
import { getRockerBridge } from "./bridge"

export default function App() {
  return <I18nProvider><Workspace /></I18nProvider>
}

function Workspace() {
  const bridge = useMemo(() => getRockerBridge(), [])
  const { t, locale, setLocale } = useI18n()
  const [activeNav, setActiveNav] = useState<NavKey | "settings" | "terminal">("hosts")
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [history, setHistory] = useState<ConnectionHistoryItem[]>([])
  const [editor, setEditor] = useState<{ open: boolean; profile?: HostProfile }>({ open: false })
  const [sessions, setSessions] = useState(createSessionState)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? 220)
    return clampSidebarWidth(Number.isFinite(stored) ? stored : 220)
  })

  useEffect(() => {
    void bridge.hosts.list().then(setHosts)
    void bridge.history.list().then(setHistory)
    return bridge.events.onSessionEvent((event) => handleSessionEvent(event))
  }, [bridge])

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
        onWidthChange={changeSidebarWidth}
        onNavigate={setActiveNav}
        onSessionActivate={(id) => setSessions((current) => activateTab(current, id))}
      />
      <main className="workspace">
        {activeNav === "settings" ? (
          <section className="settings-view">
            <header className="view-header"><div><span className="view-eyebrow">Rocker</span><h1>{t("settings.title")}</h1></div></header>
            <div className="settings-section"><div className="setting-copy"><strong>{t("settings.language")}</strong><span>{t("settings.languageHint")}</span></div><div className="segmented-control" aria-label={t("settings.language")}><button data-active={locale === "en"} type="button" onClick={() => setLocale("en")}>{t("settings.english")}</button><button data-active={locale === "zh-CN"} type="button" onClick={() => setLocale("zh-CN")}>{t("settings.chinese")}</button></div></div>
          </section>
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
        ) : (
          <section className="placeholder-view"><span className="view-eyebrow">Rocker</span><h1>{t(activeNav === "ports" ? "ports.title" : activeNav === "sftp" ? "nav.sftp" : activeNav === "snippets" ? "nav.snippets" : "nav.hosts")}</h1><p>{t(activeNav === "sftp" ? "placeholder.sftp" : "placeholder.snippets")}</p></section>
        )}
      </main>
      <HostEditor open={editor.open} profile={editor.profile} onClose={() => setEditor({ open: false })} onSave={(profile, credentials) => void saveHost(profile, credentials)} />
    </div>
  )
}
