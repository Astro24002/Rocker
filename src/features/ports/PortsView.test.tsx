import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import { PortsView } from "./PortsView"

describe("PortsView", () => {
  it("renders the global overview without a create action and can restart a stopped profile", async () => {
    const startProfile = vi.fn(async () => ({
      id: "runtime-1",
      profileId: "profile-1",
      hostId: "host-a",
      connectionId: "connection-1",
      localAddress: "127.0.0.1",
      localPort: 18080,
      remoteAddress: "127.0.0.1",
      remotePort: 8080,
      status: "forwarding" as const
    }))
    const bridge = {
      ports: {
        listOverview: vi.fn(async () => [{ profile: profileFixture(), runtime: undefined }]),
        startProfile,
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge
    const onOpenSession = vi.fn()

    render(<I18nProvider><PortsView bridge={bridge} mode="global" onOpenSession={onOpenSession} /></I18nProvider>)

    expect(screen.queryByRole("button", { name: /new forward/i })).not.toBeInTheDocument()
    expect(await screen.findByText("Web console")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Start forwarding" }))
    expect(startProfile).toHaveBeenCalledWith("profile-1")
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(profileFixture(), expect.objectContaining({ id: "runtime-1", status: "forwarding" })))
  })

  it("saves a Host-local profile without starting it", async () => {
    const createProfile = vi.fn(async () => profileFixture())
    const startProfile = vi.fn()
    const bridge = {
      ports: {
        listForHost: vi.fn(async () => []),
        createProfile,
        startProfile,
        list: vi.fn(async () => []),
        scan: vi.fn(async () => []),
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge
    const onOpenSession = vi.fn()

    render(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" session={sessionFixture()} onOpenSession={onOpenSession} /></I18nProvider>)
    expect(screen.getByText("Rocker / Port Forwarding / G11")).toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "New forwarding" }))
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Web console" } })
    fireEvent.change(screen.getByLabelText("Remote address"), { target: { value: "127.0.0.1" } })
    fireEvent.change(screen.getByLabelText("Remote port"), { target: { value: "8080" } })
    fireEvent.change(screen.getByLabelText("Local port"), { target: { value: "18080" } })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))

    expect(await createProfile).toHaveBeenCalledWith("host-a", expect.objectContaining({ name: "Web console", remotePort: 8080 }))
    expect(startProfile).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith(profileFixture(), undefined))
  })

  it("offers save and start for a Host-local profile and warns on public binds", async () => {
    const created = profileFixture()
    const createProfile = vi.fn(async () => created)
    const startProfile = vi.fn(async () => ({ ...created, id: "runtime-1", profileId: created.id, hostId: created.hostId, connectionId: "connection-1", status: "forwarding" as const }))
    const bridge = {
      ports: {
        listForHost: vi.fn(async () => []),
        createProfile,
        startProfile,
        list: vi.fn(async () => []),
        scan: vi.fn(async () => []),
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge

    render(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" session={sessionFixture()} /></I18nProvider>)
    fireEvent.click(await screen.findByRole("button", { name: "New forwarding" }))
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Public console" } })
    fireEvent.change(screen.getByLabelText("Local address"), { target: { value: "0.0.0.0" } })
    expect(screen.getByText("This exposes the port to your network.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save and start" }))

    expect(await createProfile).toHaveBeenCalled()
    expect(startProfile).toHaveBeenCalledWith(created.id)
  })

  it("does not expose profile creation without a Host session", async () => {
    const bridge = {
      ports: {
        listForHost: vi.fn(async () => []),
        createProfile: vi.fn(),
        list: vi.fn(async () => []),
        scan: vi.fn(async () => []),
        stop: vi.fn(),
        openAddress: vi.fn()
      }
    } as unknown as RockerBridge

    render(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" /></I18nProvider>)

    const newButton = await screen.findByRole("button", { name: "New forwarding" })
    expect(newButton).toBeDisabled()
    fireEvent.click(newButton)
    expect(screen.queryByRole("dialog", { name: "New forwarding" })).not.toBeInTheDocument()
  })

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

function profileFixture() {
  return {
    id: "profile-1",
    hostId: "host-a",
    name: "Web console",
    description: "Console",
    localAddress: "127.0.0.1" as const,
    localPort: 18080,
    remoteAddress: "127.0.0.1",
    remotePort: 8080,
    autoStart: false,
    createdAt: "2026-09-08T00:00:00.000Z",
    updatedAt: "2026-09-08T00:00:00.000Z"
  }
}

function sessionFixture() {
  return { id: "session-a", hostId: "host-a", label: "G11", state: "connected" as const, channelGeneration: 1 }
}
