import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { I18nProvider } from "../../i18n"
import { ThemePreview } from "./ThemePreview"

describe("ThemePreview", () => {
  it("presents Rocker Dark as static default theme information", () => {
    render(<I18nProvider><ThemePreview /></I18nProvider>)

    expect(screen.getByText("Rocker Dark")).toBeInTheDocument()
    expect(screen.getByText("Default theme")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })
})
