import { Minus, Square, X } from "lucide-react"
import { getRockerBridge } from "../app/bridge"

export function WindowChrome() {
  const bridge = getRockerBridge()
  return (
    <header className="window-chrome">
      <div className="window-drag-region"><span className="window-mark">R</span><span>Rocker</span></div>
      <div className="window-controls">
        <button aria-label="Minimize" type="button" onClick={() => void bridge.app.minimize()}><Minus size={14} /></button>
        <button aria-label="Maximize" type="button" onClick={() => void bridge.app.toggleMaximize()}><Square size={12} /></button>
        <button aria-label="Close" className="window-close" type="button" onClick={() => void bridge.app.close()}><X size={14} /></button>
      </div>
    </header>
  )
}
