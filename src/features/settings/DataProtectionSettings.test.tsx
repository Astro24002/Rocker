import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ConfigurationImportChooseResult, RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { CredentialProtectionStatus } from "../../../electron/storage/credentials"
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
})
