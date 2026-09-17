import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { I18nProvider } from "../../i18n"
import { ThemePreview } from "./ThemePreview"

describe("ThemePreview", () => {
  it("presents the selected theme as preview-only information", () => {
    render(<I18nProvider><ThemePreview /></I18nProvider>)

    expect(screen.getByText("Rocker Forest")).toBeInTheDocument()
    expect(screen.getByText("Default theme")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("reflects an explicitly selected theme", () => {
    render(<I18nProvider><ThemePreview themeId="paper" /></I18nProvider>)

    expect(screen.getByText("Paper Light")).toBeInTheDocument()
  })
})
