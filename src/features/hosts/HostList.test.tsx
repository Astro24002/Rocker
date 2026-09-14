import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { HostList } from "./HostList"

const host = {
  id: "host-a",
  name: "Server A",
  host: "example.test",
  port: 22,
  username: "root",
  authMethod: "agent" as const,
  platform: "ubuntu" as const,
  favorite: false,
  notes: ""
}

describe("HostList", () => {
  afterEach(() => localStorage.clear())

  it("does not invoke SSH actions while security capabilities are blocked", () => {
    const onConnect = vi.fn()
    const onAdd = vi.fn()
    const onEdit = vi.fn()
    const onImport = vi.fn()
    const onDuplicate = vi.fn()
    const onToggleFavorite = vi.fn()
    const onRemove = vi.fn()

    render(<I18nProvider><HostList
      hosts={[host]}
      disabled
      onConnect={onConnect}
      onAdd={onAdd}
      onEdit={onEdit}
      onImport={onImport}
      onDuplicate={onDuplicate}
      onToggleFavorite={onToggleFavorite}
      onRemove={onRemove}
    /></I18nProvider>)

    const connect = screen.getByRole("button", { name: "Server A, SSH, root" })
    expect(screen.getByRole("button", { name: "Add host" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Import SSH config" })).toBeDisabled()
    expect(connect).toBeDisabled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    fireEvent.click(connect)
    fireEvent.click(screen.getByRole("button", { name: "Add host" }))
    fireEvent.click(screen.getByRole("button", { name: "Import SSH config" }))
    fireEvent.contextMenu(connect, { clientX: 120, clientY: 80 })

    expect(onConnect).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("selects on click and connects only on double click", () => {
    const onConnect = vi.fn()
    render(<I18nProvider><HostList hosts={[host]} onConnect={onConnect} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    fireEvent.click(card)
    expect(card).toHaveAttribute("aria-pressed", "true")
    expect(onConnect).not.toHaveBeenCalled()

    fireEvent.doubleClick(card)
    expect(onConnect).toHaveBeenCalledWith(host)
  })

  it("selects a focused card with Space without connecting", () => {
    const onConnect = vi.fn()
    render(<I18nProvider><HostList hosts={[host]} onConnect={onConnect} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    card.focus()
    fireEvent.keyDown(card, { key: " " })

    expect(card).toHaveFocus()
    expect(card).toHaveAttribute("aria-pressed", "true")
    expect(onConnect).not.toHaveBeenCalled()
  })

  it("connects a focused card with Enter", () => {
    const onConnect = vi.fn()
    render(<I18nProvider><HostList hosts={[host]} onConnect={onConnect} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    card.focus()
    fireEvent.keyDown(card, { key: "Enter" })

    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onConnect).toHaveBeenCalledWith(host)
  })

  it("exposes the selected Host filter state", () => {
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("button", { name: /All hosts/ })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Recent hosts" })).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(screen.getByRole("button", { name: "Recent hosts" }))
    expect(screen.getByRole("button", { name: "Recent hosts" })).toHaveAttribute("aria-pressed", "true")
  })

  it("shows compact card metadata, platform icon, and enables Connect for a complete SSH command", () => {
    const onCommandConnect = vi.fn()
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onConnectCommand={onCommandConnect} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    expect(screen.getByPlaceholderText("Find a host or ssh user@hostname")).toBeInTheDocument()
    expect(screen.getByText("Server A")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Server A, SSH, root" })).toHaveTextContent("SSH · root")
    expect(screen.getByLabelText("ubuntu platform")).toBeInTheDocument()
    expect(screen.queryByText("10.0.0.11")).not.toBeInTheDocument()

    const connect = screen.getByRole("button", { name: /Connect/ })
    expect(connect).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText("Find a host or ssh user@hostname"), { target: { value: "ssh root@127.0.0.1 -p 27001" } })
    expect(connect).toBeEnabled()
    fireEvent.click(connect)
    expect(onCommandConnect).toHaveBeenCalledWith("ssh root@127.0.0.1 -p 27001")
  })

  it("localizes the host command search affordance", () => {
    localStorage.setItem("rocker.locale", "zh-CN")
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("textbox", { name: "查找主机或 ssh user@hostname" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "连接" })).toBeDisabled()
  })

  it("opens host actions from the card context menu", () => {
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    expect(screen.queryByRole("button", { name: "Edit host" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Edit Server A" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Duplicate host" })).not.toBeInTheDocument()
    fireEvent.contextMenu(card, { clientX: 120, clientY: 80 })

    expect(card).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("menu", { name: "Server A actions" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Edit host" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Duplicate host" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Favorite host" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Delete host" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Test connection" })).not.toBeInTheDocument()
  })

  it("runs edit from the host context menu", () => {
    const onEdit = vi.fn()
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={onEdit} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit host" }))

    expect(onEdit).toHaveBeenCalledWith(host)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it.each(["ContextMenu", "F10"] as const)("opens host actions with %s keyboard input", (key) => {
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    card.focus()
    fireEvent.keyDown(card, { key, shiftKey: key === "F10" })

    expect(screen.getByRole("menu", { name: "Server A actions" })).toBeInTheDocument()
    expect(screen.getByRole("menu")).toHaveFocus()
  })

  it("closes the host context menu and restores card focus", () => {
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    const card = screen.getByRole("button", { name: "Server A, SSH, root" })
    fireEvent.contextMenu(card, { clientX: 120, clientY: 80 })
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(card).toHaveFocus()
  })

  it("filters cards by environment and tag selectors", () => {
    const production = { ...host, id: "host-prod", name: "Production", environment: "production" as const, tags: ["core", "linux"] }
    const staging = { ...host, id: "host-stage", name: "Staging", environment: "staging" as const, tags: ["database"] }
    render(<I18nProvider><HostList hosts={[production, staging]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "production" } })
    expect(screen.getByRole("button", { name: "Production, SSH, root" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Staging, SSH, root" })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "all" } })
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "database" } })
    expect(screen.getByRole("button", { name: "Staging, SSH, root" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Production, SSH, root" })).not.toBeInTheDocument()
  })

  it("calls favorite and duplicate actions for the selected Host", async () => {
    const onDuplicate = vi.fn().mockResolvedValue({ ...host, id: "host-copy", name: "Server A copy" })
    const onToggleFavorite = vi.fn().mockResolvedValue({ ...host, favorite: true })
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={onDuplicate} onToggleFavorite={onToggleFavorite} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })

    fireEvent.click(screen.getByRole("menuitem", { name: "Favorite host" }))
    await waitFor(() => expect(onToggleFavorite).toHaveBeenCalledWith(host))
    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate host" }))
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(host))
  })

  it("requires confirmation before deleting a selected Host", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={onRemove} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete host" }))

    expect(confirmation).toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    confirmation.mockRestore()
  })

  it("identifies production risk in the delete confirmation", () => {
    const production = { ...host, environment: "production" as const }
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<I18nProvider><HostList hosts={[production]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete host" }))

    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining("production"))
    confirmation.mockRestore()
  })

  it("shows a safe error when a selected Host action fails", async () => {
    const onToggleFavorite = vi.fn().mockRejectedValue(new Error("storage details"))
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={onToggleFavorite} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(screen.getByRole("button", { name: "Server A, SSH, root" }), { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "Favorite host" }))

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Couldn't update this host"))
    expect(screen.queryByText("storage details")).not.toBeInTheDocument()
  })

  it("filters cards by the derived Recent Host IDs", () => {
    const other = { ...host, id: "host-b", name: "Server B" }
    render(<I18nProvider><HostList hosts={[host, other]} recentHostIds={new Set([other.id])} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    fireEvent.click(screen.getByRole("button", { name: /Recent hosts/ }))
    expect(screen.queryByText("Server A")).not.toBeInTheDocument()
    expect(screen.getByText("Server B")).toBeInTheDocument()
  })
})
