import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { en, type TranslationKey } from "./en"
import { zhCN } from "./zh-CN"

export type Locale = "en" | "zh-CN"
export const defaultLocale: Locale = "en"
export const dictionaries = { en, "zh-CN": zhCN } as const

interface I18nValue {
  locale: Locale
  setLocale(locale: Locale): void
  t(key: TranslationKey): string
}

const I18nContext = createContext<I18nValue | undefined>(undefined)

export function translate(locale: Locale, key: TranslationKey): string {
  return dictionaries[locale][key]
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale(nextLocale) {
      localStorage.setItem("rocker.locale", nextLocale)
      setLocaleState(nextLocale)
    },
    t: (key) => translate(locale, key)
  }), [locale])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error("useI18n must be used within I18nProvider")
  return value
}

function readStoredLocale(): Locale {
  const stored = localStorage.getItem("rocker.locale")
  return stored === "zh-CN" ? "zh-CN" : defaultLocale
}
