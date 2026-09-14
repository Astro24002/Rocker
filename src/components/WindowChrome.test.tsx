import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { I18nProvider } from "../i18n"
import { WindowChrome } from "./WindowChrome"

describe("WindowChrome", () => {
  afterEach(() => {
    localStorage.clear()
    delete (window as unknown as { rocker?: unknown }).rocker
  })

  it("keeps the native controls while leaving the drag region visually blank", () => {
    const { container } = render(<I18nProvider><WindowChrome /></I18nProvider>)

    expect(container.querySelector(".window-drag-region")).toBeInTheDocument()
    expect(container.querySelector(".window-mark")).not.toBeInTheDocument()
    expect(screen.queryByText("Rocker")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  it("localizes native window control names", () => {
    localStorage.setItem("rocker.locale", "zh-CN")
    render(<I18nProvider><WindowChrome /></I18nProvider>)

    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "最大化" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
  })

  it("keeps Windows controls on the right and reflects the typed maximize state", async () => {
    let maximized = false
    installWindowBridge({
      platform: "win32",
      isMaximized: async () => maximized,
      minimize: async () => undefined,
      toggleMaximize: async () => { maximized = true },
      close: async () => undefined
    })
    const { container } = render(<I18nProvider><WindowChrome /></I18nProvider>)

    await waitFor(() => expect(container.querySelector(".window-chrome" )).toHaveAttribute("data-platform", "win32"))
    const header = container.querySelector(".window-chrome")
    expect([...header!.children].map((child) => child.className)).toEqual(["window-drag-region", "window-controls"])
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument()
    expect(container.querySelector(".window-chrome")).not.toHaveTextContent(/Session|Host|Search|Command Palette/)

    fireEvent.click(screen.getByRole("button", { name: "Maximize" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument())
    expect(container.querySelector(".window-chrome")).toHaveAttribute("data-maximized", "true")
    expect(screen.getByRole("button", { name: "Restore" }).querySelector(".lucide-copy")).toBeInTheDocument()
  })

  it("keeps macOS controls in a left traffic-light-compatible zone", async () => {
    installWindowBridge({
      platform: "darwin",
      isMaximized: async () => false,
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      close: async () => undefined
    })
    const { container } = render(<I18nProvider><WindowChrome /></I18nProvider>)

    await waitFor(() => expect(container.querySelector(".window-chrome")).toHaveAttribute("data-platform", "darwin"))
    const header = container.querySelector(".window-chrome")
    expect([...header!.children].map((child) => child.className)).toEqual(["window-controls", "window-drag-region"])
    expect(container.querySelector(".window-drag-region")).toHaveAttribute("aria-hidden", "true")
  })
})

function installWindowBridge(app: Record<string, unknown>): void {
  ;(window as unknown as { rocker?: unknown }).rocker = { app }
}
