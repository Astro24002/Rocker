import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { normalizeSidebarWidth, stepSidebarWidth, COMPACT_SIDEBAR_WIDTH, EXPANDED_SIDEBAR_MAX_WIDTH } from "../shared/sidebar-width"

export interface WorkspaceResizeHandleProps {
  width: number
  onWidthChange(width: number): void
}

export function WorkspaceResizeHandle({ width, onWidthChange }: WorkspaceResizeHandleProps) {
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined)

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      onWidthChange(normalizeSidebarWidth(drag.startWidth + event.clientX - drag.startX))
    }
    const stop = (): void => {
      dragRef.current = undefined
      setDragging(false)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [dragging, onWidthChange])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startWidth: width }
    setDragging(true)
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      onWidthChange(stepSidebarWidth(width, "decrease"))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      onWidthChange(stepSidebarWidth(width, "increase"))
    }
  }

  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      aria-valuemax={EXPANDED_SIDEBAR_MAX_WIDTH}
      aria-valuemin={COMPACT_SIDEBAR_WIDTH}
      aria-valuenow={normalizeSidebarWidth(width)}
      className="workspace-resize-handle"
      data-dragging={dragging}
      role="separator"
      tabIndex={0}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={startDrag}
    />
  )
}
