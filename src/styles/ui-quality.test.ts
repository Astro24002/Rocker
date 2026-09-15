import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const layoutStyles = readFileSync(resolve(process.cwd(), "src/styles/layout.css"), "utf8")
const componentStyles = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8")
const tokenStyles = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8")

describe("UI quality stylesheet contract", () => {
  it("keeps view headers and action groups usable at the minimum desktop width", () => {
    expect(layoutStyles).toMatch(/\.view-header\s*\{[\s\S]*?flex-wrap:\s*wrap;/)
    expect(layoutStyles).toMatch(/\.view-header\s*\{[\s\S]*?min-width:\s*0;/)
    expect(componentStyles).toMatch(/\.header-actions,[\s\S]*?\.empty-actions\s*\{[\s\S]*?flex-wrap:\s*wrap;/)
    expect(componentStyles).toMatch(/\.header-actions,[\s\S]*?\.empty-actions\s*\{[\s\S]*?min-width:\s*0;/)
  })

  it("keeps inactive workspace destinations out of the flex layout", () => {
    expect(layoutStyles).toMatch(/\.workspace-stage\s*>\s*\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;/)
  })

  it("keeps workspace management views and sessions vertically scrollable", () => {
    expect(layoutStyles).toMatch(/\.ports-content,\s*\.settings-list\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow-y:\s*auto;/)
    expect(layoutStyles).toMatch(/\.host-content,\s*\.history-content,\s*\.trust-content\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow-y:\s*auto;/)
    expect(componentStyles).toMatch(/\.session-section\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?flex-direction:\s*column;/)
    expect(componentStyles).toMatch(/\.sidebar-session-list\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?flex:\s*1;[\s\S]*?overflow-y:\s*auto;/)
  })

  it("defines reduced-motion behavior for transitions and refresh indicators", () => {
    expect(componentStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition-duration:\s*0\.01ms/)
    expect(componentStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.is-spinning[\s\S]*?animation:\s*none/)
  })

  it("keeps renderer surfaces token-driven and free of negative tracking", () => {
    expect(tokenStyles).toMatch(/--scrim:/)
    expect(tokenStyles).toMatch(/--status-warning-surface:/)
    expect(tokenStyles).toMatch(/--platform-ubuntu:/)
    expect(`${layoutStyles}\n${componentStyles}`).not.toContain("rgba(")
    expect(`${layoutStyles}\n${componentStyles}`).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(`${layoutStyles}\n${componentStyles}`).not.toMatch(/letter-spacing:\s*-/)
  })
})
