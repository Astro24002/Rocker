import { Construction } from "lucide-react"
import { useI18n } from "../i18n"

export function ComingSoonView({ feature }: { feature: "sftp" | "snippets" }) {
  const { t } = useI18n()
  const titleKey = feature === "sftp" ? "nav.sftp" : "nav.snippets"
  const bodyKey = feature === "sftp" ? "placeholder.sftp" : "placeholder.snippets"
  return <section className="placeholder-view"><div className="empty-symbol"><Construction size={24} /></div><span className="view-eyebrow">Rocker</span><h1>{t(titleKey)}</h1><strong>{t("placeholder.comingSoon")}</strong><p>{t(bodyKey)}</p></section>
}
