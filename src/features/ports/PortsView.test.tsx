import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import { PortsView } from "./PortsView"

describe("PortsView", () => {
  it("opens details separately from starting and pausing a saved rule", async () => {
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
    expect(screen.getByRole("heading", { name: "host-a" })).toBeInTheDocument()
    expect(screen.getByText("Stopped")).toBeInTheDocument()
    expect(screen.queryByText("Ready to restart")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View details" }))
    expect(onOpenSession).toHaveBeenCalledWith(profileFixture(), undefined)
    onOpenSession.mockClear()
    fireEvent.click(screen.getByRole("button", { name: "Start forwarding" }))
    expect(startProfile).toHaveBeenCalledWith("profile-1")
    const pause = await screen.findByRole("button", { name: "Pause forwarding" })
    expect(onOpenSession).not.toHaveBeenCalled()
    fireEvent.click(pause)
    await waitFor(() => expect(bridge.ports.stop).toHaveBeenCalledWith("runtime-1"))
    expect(await screen.findByRole("button", { name: "Start forwarding" })).toBeInTheDocument()
    expect(screen.getByText("Stopped")).toBeInTheDocument()
    expect(onOpenSession).not.toHaveBeenCalled()
  })

  it("groups by Host, showing only each Host's two newest rules until independently expanded", async () => {
    const profiles = [
      { ...profileFixture(), id: "a-old", name: "A old", createdAt: "2026-09-01T00:00:00Z" },
      { ...profileFixture(), id: "b-new", hostId: "host-b", name: "B new", createdAt: "2026-09-06T00:00:00Z" },
      { ...profileFixture(), id: "a-new", name: "A new", createdAt: "2026-09-05T00:00:00Z" },
      { ...profileFixture(), id: "a-middle", name: "A middle", createdAt: "2026-09-03T00:00:00Z" },
      { ...profileFixture(), id: "b-old", hostId: "host-b", name: "B old", createdAt: "2026-09-02T00:00:00Z" },
      { ...profileFixture(), id: "b-middle", hostId: "host-b", name: "B middle", createdAt: "2026-09-04T00:00:00Z" }
    ]
    const bridge = { ports: { listOverview: vi.fn(async () => profiles.map((profile) => ({ profile }))) } } as unknown as RockerBridge
    const hosts = [
      { id: "host-a", name: "G11", host: "10.0.0.1", port: 22, username: "root", authMethod: "password" as const, favorite: false, notes: "" },
      { id: "host-b", name: "G12", host: "10.0.0.2", port: 22, username: "deploy", authMethod: "password" as const, favorite: false, notes: "" }
    ]
    const onOpenSession = vi.fn()
    render(<I18nProvider><PortsView bridge={bridge} mode="global" hosts={hosts} onOpenSession={onOpenSession} /></I18nProvider>)

    const first = await screen.findByRole("region", { name: "G12" })
    const second = screen.getByRole("region", { name: "G11" })
    expect(screen.getAllByRole("region")).toEqual([first, second])
    expect(within(first).getByRole("heading", { name: "G12" })).toBeInTheDocument()
    expect(within(first).queryByText("deploy@10.0.0.2:22")).not.toBeInTheDocument()
    expect(within(first).getByText("Rule")).toBeInTheDocument()
    expect(within(first).getByText("Route")).toBeInTheDocument()
    expect(within(first).getAllByText(/^B (new|middle)$/).map((element) => element.textContent)).toEqual(["B new", "B middle"])
    expect(within(second).getAllByText(/^A (new|middle)$/).map((element) => element.textContent)).toEqual(["A new", "A middle"])
    expect(screen.queryByText("A old")).not.toBeInTheDocument()
    expect(screen.queryByText("B old")).not.toBeInTheDocument()

    const showA = within(second).getByRole("button", { name: "Show 1 more" })
    expect(showA).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(showA)
    expect(within(second).getByText("A old")).toBeInTheDocument()
    expect(within(first).queryByText("B old")).not.toBeInTheDocument()
    expect(within(second).getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(within(second).getByRole("button", { name: "Show less" }))
    expect(within(second).queryByText("A old")).not.toBeInTheDocument()
    fireEvent.click(within(first).getByRole("button", { name: "Show 1 more" }))
    const oldB = within(first).getByText("B old").closest(".ports-overview-row")
    expect(oldB).not.toBeNull()
    fireEvent.click(within(oldB as HTMLElement).getByRole("button", { name: "View details" }))
    expect(onOpenSession).toHaveBeenCalledWith(profiles[4], undefined)
  })

  it("keeps a removed Host's rules accessible under its own group", async () => {
    const bridge = { ports: { listOverview: vi.fn(async () => [{ profile: profileFixture() }]), removeProfile: vi.fn(async () => undefined) } } as unknown as RockerBridge
    const onProfileRemoved = vi.fn()
    render(<I18nProvider><PortsView bridge={bridge} mode="global" hosts={[]} onProfileRemoved={onProfileRemoved} /></I18nProvider>)

    const group = await screen.findByRole("region", { name: "host-a" })
    expect(within(group).getByRole("heading", { name: "host-a" })).toBeInTheDocument()
    expect(within(group).getByText("Web console")).toBeInTheDocument()
    expect(within(group).getByRole("button", { name: "SSH command unavailable for this Host" })).toBeDisabled()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    try {
      fireEvent.click(within(group).getByRole("button", { name: "Remove forwarding profile" }))
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Web console"))
      expect(bridge.ports.removeProfile).not.toHaveBeenCalled()
      expect(onProfileRemoved).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      fireEvent.click(within(group).getByRole("button", { name: "Remove forwarding profile" }))
      await waitFor(() => expect(screen.queryByRole("region", { name: "host-a" })).not.toBeInTheDocument())
      expect(bridge.ports.removeProfile).toHaveBeenCalledWith("profile-1")
      expect(onProfileRemoved).toHaveBeenCalledWith("profile-1")
    } finally {
      confirm.mockRestore()
    }
  })

  it("copies a valid SSH forwarding command without starting or navigating", async () => {
    const writeText = vi.fn(async () => undefined)
    const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    try {
      const bridge = { ports: { listOverview: vi.fn(async () => [{ profile: profileFixture() }]), startProfile: vi.fn() } } as unknown as RockerBridge
      const hosts = [{ id: "host-a", name: "G11", host: "10.0.0.1", port: 2222, username: "root", authMethod: "agent" as const, favorite: false, notes: "" }]
      const onOpenSession = vi.fn()
      render(<I18nProvider><PortsView bridge={bridge} mode="global" hosts={hosts} onOpenSession={onOpenSession} /></I18nProvider>)
      fireEvent.click(await screen.findByRole("button", { name: "Copy SSH command" }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('ssh -N -L "127.0.0.1:18080:127.0.0.1:8080" -p 2222 "root@10.0.0.1"'))
      expect(screen.getByRole("button", { name: "SSH command copied" })).toBeInTheDocument()
      expect(bridge.ports.startProfile).not.toHaveBeenCalled()
      expect(onOpenSession).not.toHaveBeenCalled()
    } finally {
      if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard)
      else Reflect.deleteProperty(navigator, "clipboard")
    }
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
