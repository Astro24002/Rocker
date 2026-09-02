import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { AppBootstrapSnapshot } from "../../electron/ipc/bridge-contract"
import { I18nProvider } from "../i18n"
import { bootstrapReducer, createBootstrapState } from "../app/bootstrap-state"
import { RecoveryBanner } from "./RecoveryBanner"

describe("RecoveryBanner", () => {
  it("shows a compact recoverable notice with retry and diagnostics", () => {
    const state = bootstrapReducer(createBootstrapState(), {
      type: "load-success",
      snapshot: snapshot({ hosts: { health: { store: "hosts", status: "recovered", source: "backup" }, value: [] } })
    })
    const onRetry = vi.fn()
    const onExportDiagnostics = vi.fn(async () => ({ canceled: true }))

    render(<I18nProvider><RecoveryBanner state={state} onRetry={onRetry} onExportDiagnostics={onExportDiagnostics} /></I18nProvider>)

    expect(screen.getByRole("status")).toHaveTextContent("Hosts")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    fireEvent.click(screen.getByRole("button", { name: "Export diagnostics" }))

    expect(onRetry).toHaveBeenCalledWith(["hosts"])
    expect(onExportDiagnostics).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: /reset|clear all/i })).not.toBeInTheDocument()
  })

  it("keeps blocked notices visible and uses an alert role", () => {
    const state = bootstrapReducer(createBootstrapState(), {
      type: "load-success",
      snapshot: snapshot({ credentials: { health: { store: "credentials", status: "blocked", reason: "corrupt", message: "hidden" } } })
    })
    const onRetry = vi.fn()

    render(<I18nProvider><RecoveryBanner state={state} onRetry={onRetry} onExportDiagnostics={vi.fn(async () => ({ canceled: true }))} /></I18nProvider>)

    expect(screen.getByRole("alert")).toHaveTextContent("Credentials")
    expect(screen.getByRole("alert")).toHaveTextContent(/data was not reset/i)
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledWith(["credentials"])
  })

  it("supports the translated recoverable notice", () => {
    const state = bootstrapReducer(createBootstrapState(), {
      type: "load-success",
      snapshot: snapshot({ history: { health: { store: "history", status: "defaulted", reason: "corrupt" }, value: [] } })
    })

    localStorage.setItem("rocker.locale", "zh-CN")
    render(<I18nProvider><RecoveryBanner state={state} onRetry={vi.fn()} onExportDiagnostics={vi.fn(async () => ({ canceled: true }))} /></I18nProvider>)

    expect(screen.getByRole("status")).toHaveTextContent("历史记录")
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument()
  })

  it("renders nothing when all resources are healthy", () => {
    const state = bootstrapReducer(createBootstrapState(), { type: "load-success", snapshot: snapshot() })

    const { container } = render(<I18nProvider><RecoveryBanner state={state} onRetry={vi.fn()} onExportDiagnostics={vi.fn(async () => ({ canceled: true }))} /></I18nProvider>)

    expect(container).toBeEmptyDOMElement()
  })

  it("keeps a rejected bootstrap recoverable without exposing the raw error", () => {
    const state = bootstrapReducer(createBootstrapState(), { type: "load-error" })

    localStorage.setItem("rocker.locale", "en")
    render(<I18nProvider><RecoveryBanner state={state} onRetry={vi.fn()} onExportDiagnostics={vi.fn(async () => ({ canceled: true }))} /></I18nProvider>)

    expect(screen.getByRole("alert")).toHaveTextContent("Local data unavailable")
    expect(screen.getByRole("alert")).toHaveTextContent("Data was not reset")
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Export diagnostics" })).toBeEnabled()
    expect(screen.getByRole("alert")).not.toHaveTextContent("Error")
  })
})

function snapshot(overrides: Partial<AppBootstrapSnapshot> = {}): AppBootstrapSnapshot {
  return {
    settings: { health: { store: "settings", status: "ok" }, value: {
      locale: "en", sidebarWidth: 220, terminalFont: "JetBrains Mono", terminalFontSize: 13,
      connectionTimeout: 15, autoReconnect: true, reconnectMode: "limited", restorePreviousWorkspace: true,
      confirmMultilinePaste: true, bindAddress: "127.0.0.1"
    } },
    history: { health: { store: "history", status: "ok" }, value: [] },
    workspace: { health: { store: "workspace", status: "ok" }, value: undefined },
    hosts: { health: { store: "hosts", status: "ok" }, value: [] },
    credentials: { health: { store: "credentials", status: "ok" } },
    hostKeys: { health: { store: "hostKeys", status: "ok" } },
    ...overrides
  }
}
