import { Construction } from "lucide-react"
import { useI18n } from "../i18n"

export function ComingSoonView({ feature }: { feature: "sftp" | "snippets" }) {
  const { t } = useI18n()
  return <section className="placeholder-view"><div className="empty-symbol"><Construction size={24} /></div><span className="view-eyebrow">Rocker</span><h1>{t(feature === "sftp" ? "nav.sftp" : "nav.snippets")}</h1><strong>{t("placeholder.comingSoon")}</strong><p>{t(feature === "sftp" ? "placeholder.sftp" : "placeholder.snippets")}</p></section>
}
