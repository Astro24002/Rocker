import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
    render(<I18nProvider><SettingsView locale="en" settings={settings} onLocaleChange={vi.fn()} onUpdate={onUpdate} onExportDiagnostics={vi.fn(async () => ({ canceled: true }))} /></I18nProvider>)

    fireEvent.change(screen.getByRole("combobox", { name: "Reconnect mode" }), { target: { value: "continuous" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Restore previous workspace" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Confirm multi-line paste" }))

    expect(onUpdate).toHaveBeenCalledWith({ reconnectMode: "continuous" })
    expect(onUpdate).toHaveBeenCalledWith({ restorePreviousWorkspace: false })
    expect(onUpdate).toHaveBeenCalledWith({ confirmMultilinePaste: false })
    expect(screen.queryByText("Port recommendations")).not.toBeInTheDocument()
  })

  it("exports diagnostics through the bridge and disables the command while pending", async () => {
    let resolveExport: ((result: { canceled: boolean; path?: string }) => void) | undefined
    const onExportDiagnostics = vi.fn(() => new Promise<{ canceled: boolean; path?: string }>((resolve) => {
      resolveExport = resolve
    }))
    render(<I18nProvider><SettingsView
      locale="en"
      settings={settings}
      onLocaleChange={vi.fn()}
      onUpdate={vi.fn()}
      onExportDiagnostics={onExportDiagnostics}
    /></I18nProvider>)

    const button = screen.getByRole("button", { name: "Export diagnostics" })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    resolveExport?.({ canceled: false, path: "/tmp/rocker-diagnostics.json" })

    await waitFor(() => expect(screen.getByText("Diagnostics exported to /tmp/rocker-diagnostics.json")).toBeInTheDocument())
    expect(button).not.toBeDisabled()
  })

  it("reports cancelled and failed exports without exposing log contents", async () => {
    const onExportDiagnostics = vi.fn()
      .mockResolvedValueOnce({ canceled: true })
      .mockRejectedValueOnce(new Error("private key should never reach the renderer"))
    const view = () => <I18nProvider><SettingsView
      locale="en"
      settings={settings}
      onLocaleChange={vi.fn()}
      onUpdate={vi.fn()}
      onExportDiagnostics={onExportDiagnostics}
    /></I18nProvider>

    const { unmount } = render(view())
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }))
    await waitFor(() => expect(screen.getByText("Diagnostics export cancelled.")).toBeInTheDocument())
    unmount()

    render(view())
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }))
    await waitFor(() => expect(screen.getByText("Diagnostics export failed. Try again.")).toBeInTheDocument())
    expect(screen.queryByText(/private key/i)).not.toBeInTheDocument()
  })
})
