import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle"

describe("WorkspaceResizeHandle", () => {
  afterEach(() => localStorage.clear())

  it("updates width from a captured pointer drag", () => {
    const onWidthChange = vi.fn()
    render(<I18nProvider><WorkspaceResizeHandle width={220} onWidthChange={onWidthChange} /></I18nProvider>)
    const handle = screen.getByRole("separator", { name: "Resize sidebar" })

    fireEvent.pointerDown(handle, { clientX: 400, pointerId: 7 })
    fireEvent.pointerMove(window, { clientX: 432, pointerId: 7 })
    fireEvent.pointerUp(window, { clientX: 432, pointerId: 7 })

    expect(onWidthChange).toHaveBeenCalledWith(252)
  })

  it("uses accessible separator values and keyboard snap steps", () => {
    const onWidthChange = vi.fn()
    const { rerender } = render(<I18nProvider><WorkspaceResizeHandle width={220} onWidthChange={onWidthChange} /></I18nProvider>)
    const handle = screen.getByRole("separator", { name: "Resize sidebar" })

    expect(handle).toHaveAttribute("aria-orientation", "vertical")
    expect(handle).toHaveAttribute("aria-valuemin", "58")
    expect(handle).toHaveAttribute("aria-valuemax", "320")
    expect(handle).toHaveAttribute("aria-valuenow", "220")

    fireEvent.keyDown(handle, { key: "ArrowLeft" })
    expect(onWidthChange).toHaveBeenLastCalledWith(208)

    rerender(<I18nProvider><WorkspaceResizeHandle width={180} onWidthChange={onWidthChange} /></I18nProvider>)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize sidebar" }), { key: "ArrowLeft" })
    expect(onWidthChange).toHaveBeenLastCalledWith(58)

    rerender(<I18nProvider><WorkspaceResizeHandle width={58} onWidthChange={onWidthChange} /></I18nProvider>)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize sidebar" }), { key: "ArrowRight" })
    expect(onWidthChange).toHaveBeenLastCalledWith(180)
  })

  it("localizes the resize separator name", () => {
    localStorage.setItem("rocker.locale", "zh-CN")
    render(<I18nProvider><WorkspaceResizeHandle width={220} onWidthChange={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("separator", { name: "调整侧边栏宽度" })).toBeInTheDocument()
  })
})
