import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ConfigurationImportChooseResult, RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { CredentialProtectionStatus } from "../../../electron/storage/credentials"
import type { ImportPreview } from "../../../electron/storage/config-bundle"
import { I18nProvider } from "../../i18n"
import { DataProtectionSettings } from "./DataProtectionSettings"

function createBridge(): Pick<RockerBridge, "configuration" | "credentials"> {
  const keychainStatus = (): CredentialProtectionStatus => ({ mode: "keychain", keychainAvailable: true, vaultState: "not-configured" })
  const vaultStatus = (): CredentialProtectionStatus => ({ mode: "vault", keychainAvailable: true, vaultState: "unlocked" })
  const chooseResult: ConfigurationImportChooseResult = {
    canceled: false,
    importId: "11111111-1111-4111-8111-111111111111",
    preview: {
      format: "rocker-config",
      encrypted: false,
      requiresPassword: false,
      createdAt: "2026-09-08T00:00:00.000Z",
      hosts: { total: 1, new: 0, matching: 0, conflicts: 1 },
      hostKeys: { total: 1, new: 0, matching: 0, conflicts: 1 },
      hostConflicts: [{ id: "host-a", name: "Imported", host: "server.example", port: 22, username: "root" }],
      hostKeyConflicts: [{ id: "server.example:22", host: "server.example", port: 22, localFingerprint: "old", importedFingerprint: "new" }],
      credentials: { total: 1 },
      hasSettings: true
    }
  }
  return {
    credentials: {
      protectionStatus: vi.fn(async () => keychainStatus()),
      enableVault: vi.fn(async () => vaultStatus()),
      unlockVault: vi.fn(async () => vaultStatus()),
      lockVault: vi.fn(async () => ({ mode: "vault", keychainAvailable: true, vaultState: "locked" } satisfies CredentialProtectionStatus)),
      disableVault: vi.fn(async () => keychainStatus())
    },
    configuration: {
      exportTemplate: vi.fn(async () => ({ canceled: false, path: "/tmp/rocker-config.json" })),
      exportBundle: vi.fn(async () => ({ canceled: false, path: "/tmp/rocker-config.bundle" })),
      chooseImport: vi.fn(async () => chooseResult),
      previewImport: vi.fn(),
      applyImport: vi.fn(async () => ({
        importedHosts: 0,
        replacedHosts: 1,
        copiedHosts: 0,
        importedHostKeys: 0,
        replacedHostKeys: 1,
        skippedHostKeys: 0,
        importedCredentials: 0,
        skippedCredentials: 0,
        settingsApplied: false
      }))
    }
  }
}

describe("DataProtectionSettings", () => {
  it("requires matching Vault passwords and never renders the entered value", async () => {
    const bridge = createBridge()
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    await waitFor(() => expect(screen.getAllByText("System Keychain").length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText("Vault password"), { target: { value: "vault secret" } })
    fireEvent.change(screen.getByLabelText("Confirm Vault password"), { target: { value: "different" } })
    fireEvent.click(screen.getByRole("button", { name: "Enable Vault" }))
    expect(bridge.credentials.enableVault).not.toHaveBeenCalled()
    expect(screen.getByText("Vault passwords do not match.")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Confirm Vault password"), { target: { value: "vault secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Enable Vault" }))
    await waitFor(() => expect(bridge.credentials.enableVault).toHaveBeenCalledWith("vault secret"))
    expect(screen.queryByText("vault secret")).not.toBeInTheDocument()
  })

  it("associates visible labels with sensitive fields and announces pending work", async () => {
    let resolveEnable: ((status: CredentialProtectionStatus) => void) | undefined
    const bridge = createBridge()
    bridge.credentials.enableVault = vi.fn(() => new Promise<CredentialProtectionStatus>((resolve) => {
      resolveEnable = resolve
    }))
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    await waitFor(() => expect(screen.getAllByText("System Keychain").length).toBeGreaterThan(0))
    const password = screen.getByLabelText("Vault password")
    const confirmation = screen.getByLabelText("Confirm Vault password")
    expect(password).toHaveAttribute("id", "vault-password")
    expect(password).toHaveAttribute("aria-describedby", "vault-password-hint")
    expect(confirmation).toHaveAttribute("id", "vault-password-confirmation")
    expect(confirmation).toHaveAttribute("aria-describedby", "vault-password-hint")
    expect(screen.getByText("The Vault password is never stored by Rocker. Losing it prevents access to credentials saved in the Vault.")).toHaveAttribute("id", "vault-password-hint")
    expect(screen.getByLabelText("Migration password")).toHaveAttribute("aria-describedby", "migration-password-hint")
    expect(screen.getByLabelText("Confirm migration password")).toHaveAttribute("aria-describedby", "migration-password-hint")

    fireEvent.change(password, { target: { value: "vault secret" } })
    fireEvent.change(confirmation, { target: { value: "vault secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Enable Vault" }))

    expect(screen.getByRole("status")).toHaveTextContent("Working...")
    expect(screen.getByRole("status")).toHaveClass("data-protection-operation-status-pending")
    resolveEnable?.({ mode: "vault", keychainAvailable: true, vaultState: "unlocked" })
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Vault unlocked"))
  })

  it("reports a cancelled export without styling it as an error", async () => {
    const bridge = createBridge()
    bridge.configuration.exportTemplate = vi.fn(async () => ({ canceled: true }))
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Export template" }))
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Configuration export cancelled.")
    expect(status).toHaveClass("data-protection-operation-status-cancelled")
    expect(status).not.toHaveClass("data-protection-operation-status-error")
  })

  it("settles a cancelled import instead of leaving a pending status", async () => {
    const bridge = createBridge()
    bridge.configuration.chooseImport = vi.fn(async () => ({ canceled: true }))
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }))
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Configuration import cancelled.")
    expect(status).toHaveClass("data-protection-operation-status-cancelled")
    expect(status).not.toHaveTextContent("Working...")
  })

  it("exports a non-sensitive template without asking for a password", async () => {
    const bridge = createBridge()
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Export template" }))
    await waitFor(() => expect(bridge.configuration.exportTemplate).toHaveBeenCalledOnce())
    expect(bridge.configuration.exportBundle).not.toHaveBeenCalled()
    expect(screen.getByText("Exported to /tmp/rocker-config.json")).toBeInTheDocument()
  })

  it("reports the locked state after locking an unlocked Vault", async () => {
    const bridge = createBridge()
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.change(screen.getByLabelText("Vault password"), { target: { value: "vault secret" } })
    fireEvent.change(screen.getByLabelText("Confirm Vault password"), { target: { value: "vault secret" } })
    fireEvent.click(screen.getByRole("button", { name: "Enable Vault" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Lock Vault" })).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Lock Vault" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Vault locked"))
  })

  it("requires an explicit resolution for every imported host and Host Key conflict", async () => {
    const bridge = createBridge()
    const onImported = vi.fn()
    render(<I18nProvider><DataProtectionSettings bridge={bridge} onImported={onImported} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }))
    await waitFor(() => expect(screen.getByText("Imported")).toBeInTheDocument())
    const apply = screen.getByRole("button", { name: "Apply import" })
    expect(apply).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Imported conflict action"), { target: { value: "use-imported" } })
    fireEvent.change(screen.getByLabelText("server.example:22 Host Key action"), { target: { value: "replace-host-key" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Host Keys" }))
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(bridge.configuration.applyImport).toHaveBeenCalledWith({
      importId: "11111111-1111-4111-8111-111111111111",
      password: undefined,
      resolution: {
        hosts: { "host-a": "use-imported" },
        hostKeys: { "server.example:22": "replace-host-key" },
        importHostKeys: true,
        applySettings: false,
        importCredentials: false
      }
    }))
    expect(onImported).toHaveBeenCalledOnce()
  })

  it("does not require Host Key resolutions when Host Key import remains opted out", async () => {
    const bridge = createBridge()
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }))
    await waitFor(() => expect(screen.getByText("Imported")).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText("Imported conflict action"), { target: { value: "keep-local" } })

    const apply = screen.getByRole("button", { name: "Apply import" })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(bridge.configuration.applyImport).toHaveBeenCalledWith({
      importId: "11111111-1111-4111-8111-111111111111",
      password: undefined,
      resolution: {
        hosts: { "host-a": "keep-local" },
        hostKeys: {},
        importHostKeys: false,
        applySettings: false,
        importCredentials: false
      }
    }))
  })

  it("shows forwarding conflicts and sends the selected resolution", async () => {
    const bridge = createBridge()
    const preview: ImportPreview = {
      format: "rocker-config",
      encrypted: false,
      requiresPassword: false,
      createdAt: "2026-09-15T00:00:00.000Z",
      hosts: { total: 1, new: 0, matching: 1, conflicts: 0 },
      hostKeys: { total: 0, new: 0, matching: 0, conflicts: 0 },
      forwardings: { total: 1, new: 0, matching: 0, conflicts: 1 },
      hostConflicts: [],
      hostKeyConflicts: [],
      forwardingConflicts: [{
        id: "profile-a",
        name: "Web console",
        hostId: "host-a",
        localAddress: "127.0.0.1",
        localPort: 18080,
        remoteAddress: "127.0.0.1",
        remotePort: 8080
      }],
      credentials: { total: 0 },
      hasSettings: false
    }
    bridge.configuration.chooseImport = vi.fn(async () => ({
      canceled: false,
      importId: "22222222-2222-4222-8222-222222222222",
      preview
    }))
    render(<I18nProvider><DataProtectionSettings bridge={bridge} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }))
    await waitFor(() => expect(screen.getByText("Forwarding profile conflicts")).toBeInTheDocument())
    const apply = screen.getByRole("button", { name: "Apply import" })
    expect(apply).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Web console forwarding action"), { target: { value: "use-imported" } })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)

    await waitFor(() => expect(bridge.configuration.applyImport).toHaveBeenCalledWith({
      importId: "22222222-2222-4222-8222-222222222222",
      password: undefined,
      resolution: {
        hosts: {},
        hostKeys: {},
        forwardings: { "profile-a": "use-imported" },
        importHostKeys: false,
        applySettings: false,
        importCredentials: false
      }
    }))
  })
})
