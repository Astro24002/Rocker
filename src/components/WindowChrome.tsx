import { Copy, Minus, Square, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { getRockerBridge } from "../app/bridge"
import { useI18n } from "../i18n"

export function WindowChrome() {
  const bridge = useMemo(() => getRockerBridge(), [])
  const { t } = useI18n()
  const [maximized, setMaximized] = useState(false)
  const platform = bridge.app.platform
  const isMac = platform === "darwin"

  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => bridge.app.isMaximized?.() ?? false)
      .then((next) => {
        if (active) setMaximized(Boolean(next))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [bridge])

  const toggleMaximize = async (): Promise<void> => {
    try {
      await bridge.app.toggleMaximize()
      const next = await Promise.resolve(bridge.app.isMaximized?.() ?? !maximized)
      setMaximized(Boolean(next))
    } catch {
      setMaximized((current) => !current)
    }
  }

  const controls = (
    <div className="window-controls">
      <button aria-label={t("window.minimize")} title={t("window.minimize")} type="button" onClick={() => void bridge.app.minimize()}>
        <Minus size={14} />
      </button>
      <button
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        title={maximized ? t("window.restore") : t("window.maximize")}
        type="button"
        onClick={() => void toggleMaximize()}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button aria-label={t("window.close")} title={t("window.close")} className="window-close" type="button" onClick={() => void bridge.app.close()}>
        <X size={14} />
      </button>
    </div>
  )

  return (
    <header className="window-chrome" data-maximized={String(maximized)} data-platform={platform}>
      {isMac ? controls : null}
      <div aria-hidden="true" className="window-drag-region" />
      {isMac ? null : controls}
    </header>
  )
}
