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
    const edit = screen.getByRole("button", { name: "Edit Server A" })
    expect(screen.getByRole("button", { name: "Add host" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Import SSH config" })).toBeDisabled()
    expect(connect).toBeDisabled()
    expect(edit).toBeDisabled()

    fireEvent.click(connect)
    fireEvent.click(screen.getByRole("button", { name: "Add host" }))
    fireEvent.click(screen.getByRole("button", { name: "Import SSH config" }))
    fireEvent.click(edit)

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

  it("shows contextual host actions only after selecting a card", () => {
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)

    expect(screen.queryByRole("button", { name: "Duplicate host" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))

    expect(screen.getByRole("button", { name: "Duplicate host" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Favorite host" })).toBeInTheDocument()
    expect(screen.queryByText("⋯")).not.toBeInTheDocument()
  })

  it("tests the selected Host and reports a safe reachable result", async () => {
    const onTestConnection = vi.fn().mockResolvedValue({ status: "reachable", latencyMs: 18 })
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onTestConnection={onTestConnection} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    await waitFor(() => expect(onTestConnection).toHaveBeenCalledWith(host))
    expect(screen.getByRole("status")).toHaveTextContent("Reachable in 18 ms")
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
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))

    fireEvent.click(screen.getByRole("button", { name: "Favorite host" }))
    await waitFor(() => expect(onToggleFavorite).toHaveBeenCalledWith(host))
    fireEvent.click(screen.getByRole("button", { name: "Duplicate host" }))
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(host))
  })

  it("requires confirmation before deleting a selected Host", () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={onRemove} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete host" }))

    expect(confirmation).toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    confirmation.mockRestore()
  })

  it("identifies production risk in the delete confirmation", () => {
    const production = { ...host, environment: "production" as const }
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<I18nProvider><HostList hosts={[production]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={vi.fn()} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete host" }))

    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining("production"))
    confirmation.mockRestore()
  })

  it("shows a safe error when a selected Host action fails", async () => {
    const onToggleFavorite = vi.fn().mockRejectedValue(new Error("storage details"))
    render(<I18nProvider><HostList hosts={[host]} onConnect={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} onImport={vi.fn()} onDuplicate={vi.fn()} onToggleFavorite={onToggleFavorite} onRemove={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Server A, SSH, root" }))
    fireEvent.click(screen.getByRole("button", { name: "Favorite host" }))

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
