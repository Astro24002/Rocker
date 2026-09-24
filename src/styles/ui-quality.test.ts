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

  it("fits up to seven Host cards across the available workspace width", () => {
    expect(layoutStyles).toMatch(/\.host-card-content\s*\{[^}]*container-type:\s*inline-size;/)
    expect(componentStyles).toMatch(/\.host-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\);/)
    for (const [width, columns] of [[1600, 6], [1380, 5], [1140, 4], [920, 3], [680, 2]]) {
      expect(componentStyles).toContain(`@container (max-width: ${width}px) {\n  .host-card-grid { grid-template-columns: repeat(${columns}, minmax(0, 1fr)); }`)
    }
    expect(componentStyles).toContain("@container (max-width: 460px) {\n  .host-card-grid { grid-template-columns: 1fr; }")
    expect(componentStyles).toMatch(/\.host-card-copy small\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/)
    expect(componentStyles).toMatch(/\.host-card\s*\{[^}]*min-height:\s*76px;[^}]*align-items:\s*center;[^}]*gap:\s*14px;[^}]*padding:\s*10px 66px 10px 10px;/)
    expect(componentStyles).toMatch(/\.host-card-inline-actions\s*\{[^}]*position:\s*absolute;[^}]*right:\s*8px;[^}]*top:\s*50%;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/)
    expect(componentStyles).toMatch(/\.host-card-shell:hover \.host-card-inline-actions,[\s\S]*?\.host-card-shell:focus-within \.host-card-inline-actions\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/)
  })

  it("enlarges Port Forwarding text while allowing narrow rule tables to scroll", () => {
    expect(componentStyles).toMatch(/\.ports-view\s*\{\s*font-size:\s*15px;/)
    expect(componentStyles).toMatch(/\.ports-view \.view-header h1\s*\{\s*font-size:\s*22px;/)
    expect(componentStyles).toMatch(/\.ports-heading\s*\{[^}]*font-size:\s*12px;/)
    expect(componentStyles).toMatch(/\.port-row code\s*\{[^}]*font-size:\s*13px;/)
    expect(componentStyles).toMatch(/\.forwarding-form label\s*\{[^}]*font-size:\s*12px;/)
    expect(layoutStyles).toMatch(/\.ports-overview-table,\s*\.ports-host-table\s*\{\s*overflow-x:\s*auto;/)
    expect(layoutStyles).toMatch(/\.ports-overview-row,[\s\S]*?\.ports-profile-row\s*\{\s*min-width:\s*880px;/)
    expect(layoutStyles).toMatch(/\.ports-overview-table \.ports-heading,\s*\.ports-overview-row\s*\{\s*min-width:\s*700px;/)
  })

  it("locks the SFTP workspace to the reference split-pane table geometry", () => {
    expect(layoutStyles).toMatch(/\.sftp-workspace-shell\s*\{[^}]*grid-template-rows:\s*42px minmax\(0, 1fr\);[^}]*overflow:\s*hidden;/)
    expect(layoutStyles).toMatch(/\.sftp-workspace-stage\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/)
    expect(layoutStyles).toMatch(/\.sftp-workspace-page\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*gap:\s*1px;[^}]*overflow:\s*hidden;/)
    expect(layoutStyles).toMatch(/\.sftp-file-pane\s*\{[^}]*grid-template-rows:\s*58px 42px 38px minmax\(0, 1fr\);[^}]*overflow:\s*hidden;/)
    expect(componentStyles).toMatch(/\.sftp-file-table-header,[\s\S]*?\.sftp-file-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 43fr\) minmax\(0, 24fr\) minmax\(0, 16fr\) minmax\(0, 17fr\);/)
    expect(componentStyles).toMatch(/\.sftp-file-row\s*\{[^}]*min-height:\s*44px;[^}]*font-size:\s*14px;/)
    expect(componentStyles).toMatch(/\.sftp-file-table-body\s*\{[^}]*overflow-y:\s*auto;/)
    expect(componentStyles).toMatch(/\.sftp-pane-titlebar\s*\{[^}]*padding:\s*0 14px;[^}]*background:\s*var\(--sftp-header\);/)
    expect(componentStyles).toMatch(/\.sftp-transfer-footer\s*\{[^}]*min-height:\s*46px;/)
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
    const brand = componentStyles.match(/\.sidebar-brand\s*\{([^}]*)\}/)?.[1]
    const nav = componentStyles.match(/\.nav-item\s*\{([^}]*)\}/)?.[1]
    const session = componentStyles.match(/^\.session-activate-button\s*\{([^}]*)\}/m)?.[1]
    expect(brand).toMatch(/gap:\s*15px;/)
    expect(brand).toMatch(/padding:\s*0 24px;/)
    expect(brand).toMatch(/font-size:\s*17px;/)
    expect(componentStyles).toMatch(/\.sidebar-brand img\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/)
    expect(24 + 24 / 2).toBe(12 + 12 + 24 / 2)
    expect(24 + 24 + 15).toBe(12 + 12 + 24 + 15)
    expect(nav).toMatch(/grid-template-columns:\s*24px minmax\(0, 1fr\);/)
    expect(nav).toMatch(/column-gap:\s*15px;/)
    expect(nav).toMatch(/padding:\s*0 12px;/)
    expect(nav).toMatch(/font-size:\s*14px;/)
    expect(nav).toMatch(/font-weight:\s*600;/)
    expect(session).toMatch(/grid-template-columns:\s*24px minmax\(0, 1fr\);/)
    expect(session).toMatch(/column-gap:\s*15px;/)
    expect(session).toMatch(/padding:\s*0 40px 0 12px;/)
    expect(componentStyles).toMatch(/\.session-name\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*600;/)
    expect(componentStyles).toMatch(/\.session-type-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*place-self:\s*center;/)
    expect(componentStyles).toMatch(/\.session-type-icon\[data-label-length="2"\]\s*\{[^}]*font-size:\s*9\.5px;/)
    expect(componentStyles).toMatch(/\.session-type-icon\[data-label-length="4"\]\s*\{[^}]*font-size:\s*7px;/)
    expect(componentStyles).toMatch(/\.primary-nav\s*\{[^}]*gap:\s*5px;/)
    expect(componentStyles).toMatch(/\.nav-item > svg\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*justify-self:\s*center;/)
    expect(componentStyles).toMatch(/\.session-activity-dot\s*\{[^}]*position:\s*absolute;[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*background:\s*var\(--success\);[^}]*pointer-events:\s*none;/)
  })

  it("keeps the session close control stable and reveals it without shifting the row", () => {
    const close = componentStyles.match(/\.session-close-button\s*\{([^}]*)\}/)?.[1]
    expect(close).toMatch(/position:\s*absolute;/)
    expect(close).toMatch(/width:\s*26px;/)
    expect(close).toMatch(/height:\s*26px;/)
    expect(close).toMatch(/opacity:\s*0;/)
    expect(close).toMatch(/pointer-events:\s*none;/)
    expect(componentStyles).toMatch(/\.sidebar-session-row:hover \.session-close-button,[\s\S]*?\.session-close-button:focus-visible\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/)
    expect(componentStyles).not.toMatch(/\.sidebar\[data-compact="true"\] \.sidebar-session-row:hover \.session-type-icon/)
  })

  it("uses continuous corners on rounded app surfaces with circular indicator exceptions", () => {
    expect(baseStyles).toMatch(/@supports\s*\(corner-shape:\s*squircle\)/)
    expect(baseStyles).toMatch(/\.app-shell \*\s*\{\s*corner-shape:\s*squircle;/)
    expect(baseStyles).toMatch(/\.app-shell \.session-state-dot,[\s\S]*?\.app-shell \.session-activity-dot,[\s\S]*?\.app-shell \.theme-swatch,[\s\S]*?\.app-shell \.editor-switch > span::after\s*\{\s*corner-shape:\s*round;/)
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
