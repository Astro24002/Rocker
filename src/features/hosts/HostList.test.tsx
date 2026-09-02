import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { HostList } from "./HostList"

const host = {
  id: "host-a",
  name: "Server A",
  host: "example.test",
  port: 22,
  username: "root",
  authMethod: "agent" as const,
  favorite: false,
  notes: ""
}

describe("HostList", () => {
  it("does not invoke SSH actions while security capabilities are blocked", () => {
    const onConnect = vi.fn()
    const onAdd = vi.fn()
    const onEdit = vi.fn()
    const onImport = vi.fn()
    const onFavorite = vi.fn()

    render(<I18nProvider><HostList
      hosts={[host]}
      disabled
      onConnect={onConnect}
      onAdd={onAdd}
      onEdit={onEdit}
      onImport={onImport}
      onFavorite={onFavorite}
    /></I18nProvider>)

    const connect = screen.getByRole("button", { name: /Server A/ })
    const favorite = screen.getByRole("button", { name: "Favorite" })
    const edit = screen.getByRole("button", { name: "More" })
    expect(screen.getByRole("button", { name: "Add host" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Import SSH config" })).toBeDisabled()
    expect(connect).toBeDisabled()
    expect(favorite).toBeDisabled()
    expect(edit).toBeDisabled()

    fireEvent.click(connect)
    fireEvent.click(screen.getByRole("button", { name: "Add host" }))
    fireEvent.click(screen.getByRole("button", { name: "Import SSH config" }))
    fireEvent.click(favorite)
    fireEvent.click(edit)

    expect(onConnect).not.toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
    expect(onFavorite).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })
})
