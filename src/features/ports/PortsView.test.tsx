import { fireEvent, render, screen } from "@testing-library/react"
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

    render(<I18nProvider><PortsView bridge={bridge} connectionId="connection" session={{ id: "local", hostId: "host", label: "Server", state: "connected", channelGeneration: 1 }} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "Scan remote services" })).toBeInTheDocument()
    expect(scan).not.toHaveBeenCalled()
  })

  it("shows Resume only for a suspended forward", async () => {
    const resume = vi.fn(async () => ({
      id: "forward-1",
      connectionId: "connection",
      localAddress: "127.0.0.1",
      localPort: 3000,
      remoteAddress: "127.0.0.1",
      remotePort: 3000,
      status: "forwarding" as const
    }))
    const bridge = {
      ports: {
        scan: vi.fn(async () => [{ id: "port-3000", remoteAddress: "127.0.0.1", remotePort: 3000, source: "ss", status: "discovered" as const }]),
        list: vi.fn(async () => [{
          id: "forward-1",
          connectionId: "connection",
          localAddress: "127.0.0.1",
          localPort: 3000,
          remoteAddress: "127.0.0.1",
          remotePort: 3000,
          status: "suspended" as const
        }]),
        start: vi.fn(),
        resume,
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge

    render(<I18nProvider><PortsView bridge={bridge} connectionId="connection" session={{ id: "local", hostId: "host", label: "Server", state: "connected", channelGeneration: 1 }} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Scan remote services" }))

    const resumeButton = await screen.findByRole("button", { name: "Resume forwarding" })
    fireEvent.click(resumeButton)

    expect(resume).toHaveBeenCalledWith("forward-1")
  })

  it("keeps a suspended forward visible after its last terminal closes", async () => {
    const resume = vi.fn(async () => ({
      id: "forward-1",
      connectionId: "connection",
      localAddress: "0.0.0.0",
      localPort: 3000,
      remoteAddress: "127.0.0.1",
      remotePort: 3000,
      status: "forwarding" as const
    }))
    const bridge = {
      ports: {
        scan: vi.fn(async () => []),
        list: vi.fn(async () => [{
          id: "forward-1",
          connectionId: "connection",
          localAddress: "0.0.0.0",
          localPort: 3000,
          remoteAddress: "127.0.0.1",
          remotePort: 3000,
          status: "suspended" as const
        }]),
        start: vi.fn(),
        resume,
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge

    render(<I18nProvider><PortsView bridge={bridge} /></I18nProvider>)

    fireEvent.click(await screen.findByRole("button", { name: "Resume forwarding" }))

    expect(resume).toHaveBeenCalledWith("forward-1")
    expect(bridge.ports.scan).not.toHaveBeenCalled()
  })
})
