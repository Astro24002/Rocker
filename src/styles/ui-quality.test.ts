import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const layoutStyles = readFileSync(resolve(process.cwd(), "src/styles/layout.css"), "utf8")
const componentStyles = readFileSync(resolve(process.cwd(), "src/styles/components.css"), "utf8")
const tokenStyles = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8")
const baseStyles = readFileSync(resolve(process.cwd(), "src/styles/base.css"), "utf8")

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

  it("positions the session context menu above the scrolling list", () => {
    expect(componentStyles).toMatch(/\.session-menu\s*\{[^}]*position:\s*fixed;/)
  })

  it("joins the selected sidebar destination to the stage without a leading accent stripe", () => {
    const navActive = componentStyles.match(/\.nav-item\[data-active="true"\]\s*\{([^}]*)\}/)?.[1]
    const sessionActive = componentStyles.match(/\.sidebar-session-row\s*>\s*button\[aria-current="page"\]\s*\{([^}]*)\}/)?.[1]
    for (const style of [navActive, sessionActive]) {
      expect(style).toMatch(/width:\s*100%;/)
      expect(style).toMatch(/border-radius:\s*14px 0 0 14px;/)
      expect(style).toMatch(/background:\s*var\(--workspace-bg\);/)
      expect(style).not.toMatch(/inset\s+2px\s+0\s+0\s+var\(--accent\)/)
      expect(style).not.toMatch(/box-shadow:/)
    }
    expect(componentStyles).toMatch(/\.nav-item:focus-visible,[\s\S]*?\.sidebar-session-list button:focus-visible,[\s\S]*?outline:\s*2px solid var\(--focus\);/)
    expect(componentStyles).toMatch(/\.nav-item\[data-active="true"\]:focus-visible,[\s\S]*?\.sidebar-session-row > button\[aria-current="page"\]:focus-visible\s*\{\s*outline:\s*none;/)
    expect(componentStyles).toMatch(/\.nav-item\[data-active="true"\]:focus-visible > svg,[\s\S]*?\.sidebar-session-row > button\[aria-current="page"\]:focus-visible \.session-type-icon\s*\{[^}]*outline:\s*2px solid var\(--focus\);/)
  })

  it("rounds both concave openings into the stage without blocking sidebar interaction", () => {
    expect(componentStyles).toMatch(/\.nav-item\[data-active="true"\]::before,[\s\S]*?\.sidebar-session-row > button\[aria-current="page"\]::before\s*\{[\s\S]*?top:\s*-12px;[\s\S]*?var\(--workspace-bg\)/)
    expect(componentStyles).toMatch(/\.nav-item\[data-active="true"\]::after,[\s\S]*?\.sidebar-session-row > button\[aria-current="page"\]::after\s*\{[\s\S]*?bottom:\s*-12px;[\s\S]*?var\(--workspace-bg\)/)
    expect(componentStyles).toMatch(/\.nav-item\[data-active="true"\]::before,[\s\S]*?\.sidebar-session-row > button\[aria-current="page"\]::after\s*\{[\s\S]*?pointer-events:\s*none;/)
    expect(componentStyles).toMatch(/@supports\s*\(corner-shape:\s*scoop\)/)
    expect(componentStyles).toMatch(/\.sidebar-session-list\s*\{[^}]*padding-block:\s*12px;/)
  })

  it("aligns navigation and session icons, labels, and text sizes", () => {
    const nav = componentStyles.match(/\.nav-item\s*\{([^}]*)\}/)?.[1]
    const session = componentStyles.match(/^\.sidebar-session-list button\s*\{([^}]*)\}/m)?.[1]
    expect(nav).toMatch(/grid-template-columns:\s*22px minmax\(0, 1fr\);/)
    expect(nav).toMatch(/column-gap:\s*15px;/)
    expect(nav).toMatch(/padding:\s*0 12px;/)
    expect(nav).toMatch(/font-size:\s*15px;/)
    expect(session).toMatch(/grid-template-columns:\s*22px minmax\(0, 1fr\);/)
    expect(session).toMatch(/column-gap:\s*15px;/)
    expect(session).toMatch(/padding:\s*0 12px;/)
    expect(componentStyles).toMatch(/\.session-name\s*\{[^}]*font-size:\s*15px;/)
    expect(componentStyles).toMatch(/\.session-type-icon\s*\{[^}]*width:\s*22px;[^}]*height:\s*22px;/)
    expect(componentStyles).toMatch(/\.primary-nav\s*\{[^}]*gap:\s*5px;/)
    expect(componentStyles).toMatch(/\.nav-item > svg\s*\{[^}]*justify-self:\s*center;/)
  })

  it("uses continuous corners on rounded app surfaces with circular indicator exceptions", () => {
    expect(baseStyles).toMatch(/@supports\s*\(corner-shape:\s*squircle\)/)
    expect(baseStyles).toMatch(/\.app-shell \*\s*\{\s*corner-shape:\s*squircle;/)
    expect(baseStyles).toMatch(/\.app-shell \.session-state-dot,[\s\S]*?\.app-shell \.theme-swatch,[\s\S]*?\.app-shell \.editor-switch > span::after\s*\{\s*corner-shape:\s*round;/)
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
