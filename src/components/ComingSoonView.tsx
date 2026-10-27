import { Construction } from "lucide-react"
import { useI18n } from "../i18n"

export function ComingSoonView({ feature }: { feature: "sftp" }) {
  const { t } = useI18n()
  const titleKey = "nav.sftp"
  const bodyKey = "placeholder.sftp"
  return <section className="placeholder-view"><div className="empty-symbol"><Construction size={24} /></div><span className="view-eyebrow">Rocker</span><h1>{t(titleKey)}</h1><strong>{t("placeholder.comingSoon")}</strong><p>{t(bodyKey)}</p></section>
}
