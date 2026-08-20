import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AppSettings } from "../../app/types"
import { I18nProvider } from "../../i18n"
import { SettingsView } from "./SettingsView"

const settings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

describe("SettingsView", () => {
  it("exposes controlled reconnect, restoration, and multi-line paste preferences", () => {
    const onUpdate = vi.fn()
    render(<I18nProvider><SettingsView locale="en" settings={settings} onLocaleChange={vi.fn()} onUpdate={onUpdate} /></I18nProvider>)

    fireEvent.change(screen.getByRole("combobox", { name: "Reconnect mode" }), { target: { value: "continuous" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Restore previous workspace" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm multi-line paste" }))

    expect(onUpdate).toHaveBeenCalledWith({ reconnectMode: "continuous" })
    expect(onUpdate).toHaveBeenCalledWith({ restorePreviousWorkspace: false })
    expect(onUpdate).toHaveBeenCalledWith({ confirmMultilinePaste: false })
    expect(screen.queryByText("Port recommendations")).not.toBeInTheDocument()
  })
})
