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
  it("starts with SSH-only fields, optional capabilities off, and UTF-8 defaults", () => {
    renderEditor()

    expect(screen.getByRole("heading", { name: "Add host" })).toBeInTheDocument()
    expect(screen.getByLabelText("Label")).toHaveValue("")
    expect(screen.getByLabelText("Address")).toHaveValue("")
    expect(screen.getByLabelText("Charset")).toHaveValue("utf-8")
    expect(screen.getByLabelText("Theme color")).toHaveValue("rocker")
    expect(screen.getByRole("checkbox", { name: "Public key login" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Snippets" })).not.toBeChecked()
    expect(screen.queryByLabelText("Set a key")).not.toBeInTheDocument()
    expect(screen.queryByText("MOSH")).not.toBeInTheDocument()
    expect(screen.queryByText("Telnet")).not.toBeInTheDocument()
  })

  it("allows empty optional values while both capabilities stay disabled", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)
    fillRequiredIdentity()

    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    const saved = onSave.mock.calls[0]?.[0] as HostSaveProfile
    expect(saved).toMatchObject({ publicKeyEnabled: false, snippetsEnabled: false, charset: "utf-8", themeColor: "rocker" })
    expect(saved).not.toHaveProperty("identityFile")
    expect(saved).not.toHaveProperty("snippetCollection")
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
    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "privateKey",
      publicKeyEnabled: true,
      identityFile: "/keys/id_ed25519",
      charset: "utf-8",
      themeColor: "rocker"
    }), expect.anything())
  })

  it("requires a snippet collection only while Snippets is enabled", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)

    fireEvent.click(screen.getByRole("checkbox", { name: "Snippets" }))
    const collection = screen.getByLabelText("Snippet collection")
    expect(collection).toBeRequired()

    fillRequiredIdentity()
    fireEvent.change(collection, { target: { value: "Deployment" } })
    fireEvent.change(screen.getByLabelText("Charset"), { target: { value: "gb18030" } })
    fireEvent.change(screen.getByLabelText("Theme color"), { target: { value: "amber" } })
    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      snippetsEnabled: true,
      snippetCollection: "Deployment",
      charset: "gb18030",
      themeColor: "amber"
    }), expect.anything())
  })

  it("saves public-key and snippet preferences together without exposing credentials", () => {
    const onSave = vi.fn()
    renderEditor(undefined, onSave)

    fireEvent.click(screen.getByRole("checkbox", { name: "Public key login" }))
    fireEvent.change(screen.getByLabelText("Set a key"), { target: { value: "/keys/deploy" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Snippets" }))
    fireEvent.change(screen.getByLabelText("Snippet collection"), { target: { value: "Release" } })
    fillRequiredIdentity()
    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      authMethod: "privateKey",
      publicKeyEnabled: true,
      identityFile: "/keys/deploy",
      snippetsEnabled: true,
      snippetCollection: "Release"
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
    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    expect(onSave.mock.calls[0]?.[1]).toEqual({})
  })

  it("keeps the editor open and shows a safe error when saving fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("internal storage detail"))
    renderEditor(undefined, onSave)
    fillRequiredIdentity()

    fireEvent.click(screen.getByRole("button", { name: "Save host" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't save this host"))
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

function renderEditor(profile?: HostProfile, onSave = vi.fn()): void {
  render(
    <I18nProvider>
      <HostEditor open profile={profile} onClose={vi.fn()} onSave={onSave} />
    </I18nProvider>
  )
}

function fillRequiredIdentity(): void {
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Build host" } })
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "server.example.test" } })
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "deploy" } })
}
