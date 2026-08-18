import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import { PortsView } from "./PortsView"

describe("PortsView", () => {
  it("does not scan remote ports when the view mounts", () => {
    const scan = vi.fn(async () => [])
    const bridge = {
      ports: { scan, list: vi.fn(async () => []), start: vi.fn(), stop: vi.fn(), openAddress: vi.fn() }
    } as unknown as RockerBridge

    render(<I18nProvider><PortsView bridge={bridge} session={{ id: "local", hostId: "host", connectionId: "connection", label: "Server", state: "connected", output: "" }} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Scan remote services" })).toBeInTheDocument()
    expect(scan).not.toHaveBeenCalled()
  })
})
