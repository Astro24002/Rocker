import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import App from "./App"
import { clampSidebarWidth } from "../components/Sidebar"

beforeEach(() => localStorage.clear())

describe("desktop workspace shell", () => {
  it("uses the modern professional tool shell", () => {
    render(<App />)

    expect(document.querySelector(".app-shell")).toHaveAttribute("data-ui-style", "modern-professional")
  })

  it("renders peer navigation entries from the reference layout", () => {
    render(<App />)

    expect(screen.getByRole("button", { name: "Hosts" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "SFTP" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Port Forwarding" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Snippets" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument()
  })

  it("switches locale without reloading", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Settings" }))
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }))

    expect(screen.getByRole("button", { name: "主机" })).toBeInTheDocument()
  })

  it("clamps the resizable sidebar", () => {
    expect(clampSidebarWidth(120)).toBe(180)
    expect(clampSidebarWidth(240)).toBe(240)
    expect(clampSidebarWidth(520)).toBe(360)
  })
})
