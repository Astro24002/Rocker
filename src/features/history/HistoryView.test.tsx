import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { HistoryView } from "./HistoryView"

const host = {
  id: "host-a", name: "Server A", host: "example.test", port: 22, username: "root",
  authMethod: "agent" as const, favorite: false, notes: ""
}

const item = {
  id: "history-a", hostId: host.id, connectedAt: "2026-01-01T00:00:00.000Z", durationMs: 1_000, outcome: "connected" as const
}

describe("HistoryView", () => {
  it("keeps history navigable but blocks clear and reconnect commands independently", () => {
    const onReconnect = vi.fn()
    const onClear = vi.fn()

    render(<I18nProvider><HistoryView items={[item]} hosts={[host]} disabled reconnectDisabled onReconnect={onReconnect} onClear={onClear} /></I18nProvider>)

    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear history" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }))
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(onClear).not.toHaveBeenCalled()
    expect(onReconnect).not.toHaveBeenCalled()
  })
})
