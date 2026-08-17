import { describe, expect, it } from "vitest"
import { defaultLocale, dictionaries, translate } from "../src/i18n"

describe("Rocker localization", () => {
  it("uses English by default", () => {
    expect(defaultLocale).toBe("en")
    expect(translate("en", "nav.hosts")).toBe("Hosts")
  })

  it("keeps English and Simplified Chinese dictionaries complete", () => {
    expect(Object.keys(dictionaries["zh-CN"]).sort()).toEqual(Object.keys(dictionaries.en).sort())
    expect(translate("zh-CN", "nav.hosts")).toBe("主机")
  })
})
