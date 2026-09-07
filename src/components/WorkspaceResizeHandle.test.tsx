import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle"

describe("WorkspaceResizeHandle", () => {
  it("updates width from a captured pointer drag", () => {
    const onWidthChange = vi.fn()
    render(<WorkspaceResizeHandle width={220} onWidthChange={onWidthChange} />)
    const handle = screen.getByRole("separator", { name: "Resize sidebar" })

    fireEvent.pointerDown(handle, { clientX: 400, pointerId: 7 })
    fireEvent.pointerMove(window, { clientX: 432, pointerId: 7 })
    fireEvent.pointerUp(window, { clientX: 432, pointerId: 7 })

    expect(onWidthChange).toHaveBeenCalledWith(252)
  })

  it("uses accessible separator values and keyboard snap steps", () => {
    const onWidthChange = vi.fn()
    const { rerender } = render(<WorkspaceResizeHandle width={220} onWidthChange={onWidthChange} />)
    const handle = screen.getByRole("separator", { name: "Resize sidebar" })

    expect(handle).toHaveAttribute("aria-orientation", "vertical")
    expect(handle).toHaveAttribute("aria-valuemin", "58")
    expect(handle).toHaveAttribute("aria-valuemax", "320")
    expect(handle).toHaveAttribute("aria-valuenow", "220")

    fireEvent.keyDown(handle, { key: "ArrowLeft" })
    expect(onWidthChange).toHaveBeenLastCalledWith(208)

    rerender(<WorkspaceResizeHandle width={180} onWidthChange={onWidthChange} />)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize sidebar" }), { key: "ArrowLeft" })
    expect(onWidthChange).toHaveBeenLastCalledWith(58)

    rerender(<WorkspaceResizeHandle width={58} onWidthChange={onWidthChange} />)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize sidebar" }), { key: "ArrowRight" })
    expect(onWidthChange).toHaveBeenLastCalledWith(180)
  })
})
