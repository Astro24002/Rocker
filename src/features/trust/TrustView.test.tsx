import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { HostKeyAuditRecord, HostKeyInventoryEntry } from "../../../electron/ipc/bridge-contract"
import type { HostProfile } from "../../app/types"
import { I18nProvider } from "../../i18n"
import { TrustView } from "./TrustView"

const host: HostProfile = {
  id: "host-a",
  name: "Server A",
  host: "server.example",
  port: 22,
  username: "root",
  authMethod: "agent",
  favorite: false,
  notes: ""
}

const entry: HostKeyInventoryEntry = {
  host: "server.example",
  port: 22,
  fingerprint: "fingerprint-a"
}

const audit: HostKeyAuditRecord = {
  at: "2026-09-11T00:00:00.000Z",
  action: "trusted",
  host: "server.example",
  port: 22,
  fingerprint: "fingerprint-a"
}

describe("TrustView", () => {
  it("shows trusted endpoint metadata and audit activity without credentials", () => {
    render(<I18nProvider><TrustView entries={[entry]} history={[audit]} hosts={[host]} onRemove={vi.fn(async () => undefined)} /></I18nProvider>)

    expect(screen.getByRole("heading", { name: "Trust" })).toBeInTheDocument()
    expect(screen.getByText("Server A")).toBeInTheDocument()
    expect(screen.getAllByText("server.example:22")).toHaveLength(2)
    expect(screen.getAllByText("SHA256:fingerprint-a")).toHaveLength(2)
    expect(screen.getByText("Trusted")).toBeInTheDocument()
    expect(screen.queryByText("root")).not.toBeInTheDocument()
    expect(screen.queryByText(/password|private key/i)).not.toBeInTheDocument()
  })

  it("removes a trusted key only after explicit confirmation", async () => {
    const onRemove = vi.fn(async () => undefined)
    const confirm = window.confirm
    window.confirm = vi.fn(() => true)
    try {
      render(<I18nProvider><TrustView entries={[entry]} history={[]} hosts={[host]} onRemove={onRemove} /></I18nProvider>)

      fireEvent.click(screen.getByRole("button", { name: "Remove trust for Server A" }))

      await waitFor(() => expect(onRemove).toHaveBeenCalledWith(entry))
      expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Server A"))
    } finally {
      window.confirm = confirm
    }
  })

  it("keeps removal disabled when Host Key storage is unavailable", () => {
    render(<I18nProvider><TrustView entries={[entry]} history={[]} hosts={[host]} disabled onRemove={vi.fn(async () => undefined)} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Remove trust for Server A" })).toBeDisabled()
  })
})
