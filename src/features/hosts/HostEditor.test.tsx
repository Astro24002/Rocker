import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { BootstrapHostProfile, HostSaveProfile } from "../../../electron/ipc/bridge-contract"
import type { HostProfile } from "../../app/types"
import { I18nProvider } from "../../i18n"
import { HostEditor } from "./HostEditor"

const baseProfile: HostProfile = {
  id: "host-a",
  name: "G11",
  host: "g11.example.test",
  port: 22,
  username: "root",
  authMethod: "password",
  group: "Personal",
  favorite: false,
  notes: ""
}

describe("HostEditor", () => {
  it("starts with SSH fields and UTF-8 defaults", () => {
    renderEditor()

    expect(screen.getByRole("heading", { name: "Add Host" })).toBeInTheDocument()
    expect(screen.getByLabelText("Label")).toHaveValue("")
    expect(screen.getByLabelText("Address")).toHaveValue("")
    expect(screen.getByLabelText("Charset")).toHaveValue("utf-8")
    expect(screen.getByLabelText("Theme color")).toHaveValue("rocker")
    expect(screen.getByRole("checkbox", { name: "Public key login" })).not.toBeChecked()
    expect(screen.queryByLabelText("Set a key")).not.toBeInTheDocument()
    expect(screen.queryByText("MOSH")).not.toBeInTheDocument()
    expect(screen.queryByText("Telnet")).not.toBeInTheDocument()
  })

  it("allows empty optional values while public-key login stays disabled", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)
    fillRequiredIdentity()

    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    const saved = onSave.mock.calls[0]?.[0] as HostSaveProfile
    expect(saved).toMatchObject({ publicKeyEnabled: false, charset: "utf-8", themeColor: "rocker" })
    expect(saved).not.toHaveProperty("identityFile")
  })

  it("drops retired metadata when editing a legacy Host record", () => {
    const onSave = vi.fn()
    const legacyProfile = { ...baseProfile, snippetsEnabled: true, snippetCollection: "Deployment" }
    renderEditor(legacyProfile, onSave)

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(screen.queryByRole("checkbox", { name: "Snippets" })).not.toBeInTheDocument()
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("snippetsEnabled")
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("snippetCollection")
  })

  it("blocks a duplicate local Host name regardless of case or surrounding spaces", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave, [baseProfile])
    fillRequiredIdentity()
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "  g11  " } })

    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    expect(screen.getByRole("alert")).toHaveTextContent("A Host with this name already exists on this device")
    expect(screen.getByRole("textbox", { name: "Label" })).toHaveAttribute("aria-invalid", "true")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("allows an existing Host to retain its own unique name", () => {
    const onSave = vi.fn()
    renderEditor(baseProfile, onSave, [baseProfile])

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "host-a", name: "G11" }), expect.anything())
  })

  it("does not expose or write retired organization metadata", () => {
    const onSave = vi.fn()
    renderEditor({ ...baseProfile, environment: "production", tags: ["core"] }, onSave)
    fillRequiredIdentity()

    expect(screen.queryByLabelText("Parent group")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Environment")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Tags")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("group")
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("environment")
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("tags")
  })

  it("shows and validates the public-key field only when public-key login is enabled", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    const key = screen.getByLabelText("Set a key")
    expect(key).toBeRequired()

    fillRequiredIdentity()
    fireEvent.change(key, { target: { value: "/keys/id_ed25519" } })
    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "privateKey",
      publicKeyEnabled: true,
      identityFile: "/keys/id_ed25519",
      charset: "utf-8",
      themeColor: "rocker"
    }), expect.anything())
  })

  it("fills and saves the private-key path selected from the native file picker", async () => {
    const onSave = vi.fn()
    const onChooseIdentityFile = vi.fn().mockResolvedValue("/keys/id_ed25519")
    renderEditor(undefined, onSave, [], onChooseIdentityFile)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    fireEvent.click(screen.getByRole("button", { name: "Choose file" }))

    const keyPath = screen.getByLabelText("Set a key")
    await waitFor(() => expect(keyPath).toHaveValue("/keys/id_ed25519"))
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    expect(onChooseIdentityFile).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "privateKey",
      publicKeyEnabled: true,
      identityFile: "/keys/id_ed25519"
    }), expect.anything())
  })

  it("keeps a manually entered private-key path when the native picker is cancelled", async () => {
    const onChooseIdentityFile = vi.fn().mockResolvedValue(undefined)
    renderEditor(undefined, vi.fn(), [], onChooseIdentityFile)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    const keyPath = screen.getByLabelText("Set a key")
    fireEvent.change(keyPath, { target: { value: "/keys/manual_ed25519" } })
    fireEvent.click(screen.getByRole("button", { name: "Choose file" }))

    await waitFor(() => expect(screen.getByRole("button", { name: "Choose file" })).toBeEnabled())
    expect(keyPath).toHaveValue("/keys/manual_ed25519")
    expect(onChooseIdentityFile).toHaveBeenCalledOnce()
  })

  it("announces native picker errors and associates them with the picker button", async () => {
    const onChooseIdentityFile = vi.fn().mockRejectedValue(new Error("dialog unavailable"))
    renderEditor(undefined, vi.fn(), [], onChooseIdentityFile)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    fireEvent.click(screen.getByRole("button", { name: "Choose file" }))

    const error = await screen.findByText("Could not open the file picker. Try again.")
    expect(error).toHaveAttribute("role", "status")
    expect(screen.getByRole("button", { name: "Choose file" })).toHaveAttribute("aria-describedby", "host-key-picker-error")
  })

  it("saves public-key preferences without exposing credentials", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    fireEvent.change(screen.getByLabelText("Set a key"), { target: { value: "/keys/deploy" } })
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "privateKey",
      publicKeyEnabled: true,
      identityFile: "/keys/deploy"
    }), expect.anything())
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("password")
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("passphrase")
  })

  it("does not carry credentials across an authentication-mode round trip", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)
    fillRequiredIdentity()

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "stale-password" } })
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "agent" } })
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "password" } })
    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    expect(onSave.mock.calls[0]?.[1]).toEqual({})
  })

  it("keeps the editor open and shows a safe error when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("internal storage detail"))
    renderEditor(undefined, onSave)
    fillRequiredIdentity()

    fireEvent.click(screen.getByRole("button", { name: "Save Host" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't save this Host"))
    expect(screen.getByLabelText("Label")).toHaveValue("Build host")
    expect(screen.queryByText("internal storage detail")).not.toBeInTheDocument()
  })

  it("preserves an existing redacted key when the editor key input is left empty", () => {
    const onSave = vi.fn()
    const redacted: BootstrapHostProfile = {
      ...baseProfile,
      authMethod: "privateKey",
      publicKeyEnabled: true,
      hasIdentityFile: true
    }
    renderEditor(redacted, onSave)

    const key = screen.getByLabelText("Set a key")
    expect(key).not.toBeRequired()
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    const saved = onSave.mock.calls[0]?.[0] as HostSaveProfile
    expect(saved).toMatchObject({ authMethod: "privateKey", publicKeyEnabled: true, hasIdentityFile: true })
    expect(saved).not.toHaveProperty("identityFile")
  })
})

function renderEditor(
  profile?: HostProfile,
  onSave = vi.fn(),
  hosts: readonly HostProfile[] = [],
  onChooseIdentityFile = vi.fn(async () => undefined)
): void {
  render(
    <I18nProvider>
      <HostEditor open profile={profile} hosts={hosts} onClose={vi.fn()} onSave={onSave} onChooseIdentityFile={onChooseIdentityFile} />
    </I18nProvider>
  )
}

function fillRequiredIdentity(): void {
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Build host" } })
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "server.example.test" } })
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "deploy" } })
}
