import { Plus, Search, Server, Upload } from "lucide-react"
import { useState } from "react"
import { Sidebar, clampSidebarWidth, type NavKey } from "../components/Sidebar"
import { I18nProvider, useI18n } from "../i18n"

export default function App() {
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  )
}

function Workspace() {
  const { t, locale, setLocale } = useI18n()
  const [activeNav, setActiveNav] = useState<NavKey | "settings">("hosts")
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem("rocker.sidebarWidth") ?? 220)
    return clampSidebarWidth(Number.isFinite(stored) ? stored : 220)
  })

  const changeSidebarWidth = (width: number): void => {
    const next = clampSidebarWidth(width)
    localStorage.setItem("rocker.sidebarWidth", String(next))
    setSidebarWidth(next)
  }

  return (
    <div className="app-shell">
      <Sidebar
        width={sidebarWidth}
        activeNav={activeNav}
        onWidthChange={changeSidebarWidth}
        onNavigate={setActiveNav}
      />
      <main className="workspace">
        {activeNav === "settings" ? (
          <section className="settings-view">
            <header className="view-header">
              <div>
                <span className="view-eyebrow">Rocker</span>
                <h1>{t("settings.title")}</h1>
              </div>
            </header>
            <div className="settings-section">
              <div className="setting-copy">
                <strong>{t("settings.language")}</strong>
                <span>{t("settings.languageHint")}</span>
              </div>
              <div className="segmented-control" aria-label={t("settings.language")}>
                <button data-active={locale === "en"} type="button" onClick={() => setLocale("en")}>{t("settings.english")}</button>
                <button data-active={locale === "zh-CN"} type="button" onClick={() => setLocale("zh-CN")}>{t("settings.chinese")}</button>
              </div>
            </div>
          </section>
        ) : activeNav === "hosts" ? (
          <section className="hosts-view">
            <header className="view-header">
              <div>
                <span className="view-eyebrow">Rocker / {t("workspace.personal")}</span>
                <h1>{t("hosts.title")}</h1>
                <p>{t("hosts.subtitle")}</p>
              </div>
              <div className="header-actions">
                <button className="icon-command" type="button" aria-label={t("common.search")} title={t("common.search")}>
                  <Search size={17} />
                </button>
                <button className="primary-command" type="button"><Plus size={16} />{t("hosts.add")}</button>
              </div>
            </header>
            <div className="empty-workspace">
              <div className="empty-symbol"><Server size={26} strokeWidth={1.5} /></div>
              <h2>{t("hosts.emptyTitle")}</h2>
              <p>{t("hosts.emptyBody")}</p>
              <div className="empty-actions">
                <button className="primary-command" type="button"><Plus size={16} />{t("hosts.add")}</button>
                <button className="secondary-command" type="button"><Upload size={16} />{t("hosts.import")}</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="placeholder-view">
            <span className="view-eyebrow">Rocker</span>
            <h1>{t(activeNav === "ports" ? "ports.title" : activeNav === "history" ? "history.title" : `nav.${activeNav}`)}</h1>
            <p>{t("placeholder.comingSoon")}</p>
          </section>
        )}
      </main>
    </div>
  )
}
