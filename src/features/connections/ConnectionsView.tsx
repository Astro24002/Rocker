import type { ReactElement, ReactNode } from "react"
import { useI18n } from "../../i18n"

export type ConnectionsTab = "history" | "trust"

interface ConnectionsViewProps {
  tab: ConnectionsTab
  onTabChange(tab: ConnectionsTab): void
  history: ReactNode
  trust: ReactNode
}

export function ConnectionsView({ tab, onTabChange, history, trust }: ConnectionsViewProps): ReactElement {
  const { t } = useI18n()
  return (
    <section className="connections-view" data-tab={tab}>
      <div className="connections-tabs" role="tablist" aria-label={t("nav.connections")}>
        <button aria-selected={tab === "history"} role="tab" type="button" onClick={() => onTabChange("history")}>{t("nav.history")}</button>
        <button aria-selected={tab === "trust"} role="tab" type="button" onClick={() => onTabChange("trust")}>{t("nav.trust")}</button>
      </div>
      <div className="connections-content" role="tabpanel">
        {tab === "history" ? history : trust}
      </div>
    </section>
  )
}
