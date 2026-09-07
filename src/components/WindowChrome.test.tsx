import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WindowChrome } from "./WindowChrome"

describe("WindowChrome", () => {
  it("keeps the native controls while leaving the drag region visually blank", () => {
    const { container } = render(<WindowChrome />)

    expect(container.querySelector(".window-drag-region")).toBeInTheDocument()
    expect(container.querySelector(".window-mark")).not.toBeInTheDocument()
    expect(screen.queryByText("Rocker")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })
})
