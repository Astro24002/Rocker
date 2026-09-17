import { useId } from "react"
import { useI18n } from "../../i18n"

export function ThemePreview({ themeId = "forest" }: { themeId?: "forest" | "dracula" | "paper" }) {
  const { t } = useI18n()
  const titleId = useId()

  return (
    <section className="theme-preview" data-theme={themeId} aria-labelledby={titleId}>
      <div className="theme-preview-copy">
        <span className="view-eyebrow">{t("settings.themePreviewTitle")}</span>
        <h2 id={titleId}>{t(`settings.theme.${themeId}`)}</h2>
        <p>{t("settings.themePreviewBody")}</p>
      </div>
      <div className="theme-preview-swatches" aria-hidden="true">
        <span className="theme-preview-swatch theme-preview-swatch-canvas" />
        <span className="theme-preview-swatch theme-preview-swatch-surface" />
        <span className="theme-preview-swatch theme-preview-swatch-accent" />
        <span className="theme-preview-swatch theme-preview-swatch-text" />
      </div>
    </section>
  )
}
