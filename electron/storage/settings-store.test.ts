import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { defaultSettings, normalizeSettings, SettingsStore } from "./settings-store"

const temporaryPaths: string[] = []

afterEach(async () => Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("SettingsStore", () => {
  it.each([1000, 5000, 10000, 25000, 50000] as const)("keeps approved scrollback value %s", (scrollback) => {
    const normalized = normalizeSettings({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      bindAddress: "127.0.0.1",
      scrollback
    })

    expect(normalized?.scrollback).toBe(scrollback)
  })

  it.each([
    ["unknown", "unknown"],
    ["non-integer", 1000.5],
    ["out-of-range", 999]
  ])("normalizes %s scrollback to the approved default", (_label, scrollback) => {
    const normalized = normalizeSettings({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      bindAddress: "127.0.0.1",
      scrollback
    })

    expect(normalized?.scrollback).toBe(defaultSettings.scrollback)
  })

  it.each(["block", "underline", "bar"] as const)("keeps approved cursor style %s", (cursorStyle) => {
    const normalized = normalizeSettings({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      bindAddress: "127.0.0.1",
      cursorStyle
    })

    expect(normalized?.cursorStyle).toBe(cursorStyle)
  })

  it("normalizes invalid cursor and bell preferences to safe defaults", () => {
    const normalized = normalizeSettings({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      bindAddress: "127.0.0.1",
      cursorStyle: "beam",
      cursorBlink: "yes",
      terminalBell: 1
    })

    expect(normalized).toMatchObject({ cursorStyle: "bar", cursorBlink: true, terminalBell: true })
  })

  it("materializes optional appearance defaults when reading a legacy snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const settingsPath = join(directory, "settings.json")
    await writeFile(settingsPath, JSON.stringify({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      bindAddress: "127.0.0.1"
    }), "utf8")

    const result = await new SettingsStore(settingsPath).loadWithStatus()

    expect(result).toMatchObject({
      status: "ok",
      value: {
        scrollback: 10000,
        cursorStyle: "bar",
        cursorBlink: true,
        terminalBell: true
      }
    })
  })

  it("reports corrupt top-level settings as a defaulted load", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const settingsPath = join(directory, "settings.json")
    await writeFile(settingsPath, JSON.stringify({ locale: "en" }), "utf8")

    const result = await new SettingsStore(settingsPath).loadWithStatus()

    expect(result).toEqual({
      status: "defaulted",
      value: expect.objectContaining({ locale: "en" }),
      reason: "corrupt"
    })
  })

  it("serializes concurrent partial updates without losing either setting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const store = new SettingsStore(join(directory, "settings.json"))

    await Promise.all([
      store.update({ terminalFontSize: 14 }),
      store.update({ sidebarWidth: 280 })
    ])

    expect(await store.get()).toMatchObject({ terminalFontSize: 14, sidebarWidth: 280 })
  })

  it("drops the obsolete scan interval while normalizing a legacy document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rocker-settings-"))
    temporaryPaths.push(directory)
    const settingsPath = join(directory, "settings.json")
    await writeFile(settingsPath, JSON.stringify({
      locale: "en",
      sidebarWidth: 220,
      terminalFont: "JetBrains Mono",
      terminalFontSize: 13,
      connectionTimeout: 15,
      autoReconnect: true,
      portScanInterval: 15,
      bindAddress: "127.0.0.1"
    }), "utf8")

    const store = new SettingsStore(settingsPath)
    const settings = await store.get()

    expect(settings).not.toHaveProperty("portScanInterval")
    await store.update({})
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).not.toHaveProperty("portScanInterval")
  })
})
