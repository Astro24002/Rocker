import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import { PortsView } from "./PortsView"

describe("PortsView", () => {
  it("connects a PF workspace without a terminal, retains scan results, and leaves release to explicit close", async () => {
    let connected!: () => void
    const ports = {
      openWorkspace: vi.fn().mockReturnValueOnce(new Promise<void>((resolve) => { connected = resolve })).mockResolvedValue(undefined),
      closeWorkspace: vi.fn(),
      listForHost: vi.fn(async () => []),
      scan: vi.fn(async () => [{ id: "node", remoteAddress: "127.0.0.1", remotePort: 3000, process: "node", source: "ss", status: "discovered" }])
    }
    const session = { id: "pf", hostId: "host-a", label: "G11", kind: "pf" as const, state: "disconnected" as const, forwardingStatus: "stopped" as const }
    const bridge = { ports } as unknown as RockerBridge
    const view = render(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" session={session} /></I18nProvider>)
    expect(screen.getByRole("button", { name: "Connecting SSH..." })).toBeDisabled()
    expect(ports.scan).not.toHaveBeenCalled()
    connected()
    const scan = await screen.findByRole("button", { name: "Scan remote services" })
    fireEvent.click(scan)
    expect(await screen.findByText("node")).toBeInTheDocument()
    expect(ports.scan).toHaveBeenCalledWith({ workspaceId: "pf" })
    view.rerender(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" session={{ ...session, label: "Renamed" }} /></I18nProvider>)
    expect(screen.getByText("node")).toBeInTheDocument()
    expect(ports.openWorkspace).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(ports.closeWorkspace).not.toHaveBeenCalled()
  })

  it("reports PF authentication failure and allows retry from Scan", async () => {
    const ports = {
      openWorkspace: vi.fn().mockRejectedValueOnce(new Error("Authentication failed")).mockResolvedValue(undefined),
      listForHost: vi.fn(async () => []),
      scan: vi.fn(async () => [])
    }
    const session = { id: "pf", hostId: "host-a", label: "G11", kind: "pf" as const, state: "disconnected" as const, forwardingStatus: "stopped" as const }
    render(<I18nProvider><PortsView bridge={{ ports } as unknown as RockerBridge} mode="host" hostId="host-a" session={session} /></I18nProvider>)
    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication failed")
    fireEvent.click(await screen.findByRole("button", { name: "Scan remote services" }))
    await waitFor(() => expect(ports.scan).toHaveBeenCalledWith({ workspaceId: "pf" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("opens and edits a legacy autoStart profile without starting it or resending the field", async () => {
    const profile = { ...profileFixture(), autoStart: true }
    const ports = {
      listForHost: vi.fn(async () => [{ profile }]),
      updateProfile: vi.fn(async (_id: string, _request: object) => profile),
      startProfile: vi.fn()
    }
    render(<I18nProvider><PortsView bridge={{ ports } as unknown as RockerBridge} mode="host" hostId="host-a" session={sessionFixture()} /></I18nProvider>)
    expect(await screen.findByText("Web console")).toBeInTheDocument()
    expect(screen.queryByText("Policy")).not.toBeInTheDocument()
    expect(ports.startProfile).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Edit forwarding profile" }))
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))
    await waitFor(() => expect(ports.updateProfile).toHaveBeenCalledOnce())
    expect(ports.updateProfile.mock.calls[0][1]).not.toHaveProperty("autoStart")
    expect(ports.startProfile).not.toHaveBeenCalled()
  })
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
    expect(startProfile).toHaveBeenCalledOnce()
    const pause = await screen.findByRole("button", { name: "Pause forwarding" })
    expect(onOpenSession).not.toHaveBeenCalled()
    fireEvent.click(pause)
    await waitFor(() => expect(bridge.ports.stop).toHaveBeenCalledWith("runtime-1"))
    expect(await screen.findByRole("button", { name: "Start forwarding" })).toBeInTheDocument()
    expect(screen.getByText("Stopped")).toBeInTheDocument()
    expect(onOpenSession).not.toHaveBeenCalled()
  })

  it("groups by Host, sorting ports numerically before independently collapsing each group", async () => {
    const profiles = [
      { ...profileFixture(), id: "a-old", name: "A old", localPort: 10000, createdAt: "2026-09-01T00:00:00Z" },
      { ...profileFixture(), id: "b-new", hostId: "host-b", name: "B new", localPort: 443, createdAt: "2026-09-06T00:00:00Z" },
      { ...profileFixture(), id: "a-new", name: "A new", localPort: 9000, createdAt: "2026-09-05T00:00:00Z" },
      { ...profileFixture(), id: "a-middle", name: "A middle", localPort: 80, createdAt: "2026-09-03T00:00:00Z" },
      { ...profileFixture(), id: "b-old", hostId: "host-b", name: "B old", localPort: 10000, createdAt: "2026-09-02T00:00:00Z" },
      { ...profileFixture(), id: "b-middle", hostId: "host-b", name: "B middle", localPort: 80, createdAt: "2026-09-04T00:00:00Z" }
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
    expect(within(first).getAllByRole("article")).toHaveLength(2)
    expect(within(first).getByRole("article", { name: "B new" })).toHaveTextContent("127.0.0.1:443")
    expect(within(first).getAllByText(/^B (new|middle)$/).map((element) => element.textContent)).toEqual(["B middle", "B new"])
    expect(within(second).getAllByText(/^A (new|middle)$/).map((element) => element.textContent)).toEqual(["A middle", "A new"])
    expect(screen.queryByText("A old")).not.toBeInTheDocument()
    expect(screen.queryByText("B old")).not.toBeInTheDocument()

    const showA = within(second).getByRole("button", { name: "Show 1 more" })
    expect(showA).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(showA)
    expect(within(second).getByText("A old")).toBeInTheDocument()
    expect(within(second).getAllByRole("article").map(element => element.getAttribute("aria-label"))).toEqual(["A middle", "A new", "A old"])
    expect(within(first).queryByText("B old")).not.toBeInTheDocument()
    expect(within(second).getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(within(second).getByRole("button", { name: "Show less" }))
    expect(within(second).queryByText("A old")).not.toBeInTheDocument()
    fireEvent.click(within(first).getByRole("button", { name: "Show 1 more" }))
    const oldB = within(first).getByRole("article", { name: "B old" })
    expect(oldB).not.toBeNull()
    fireEvent.click(within(oldB as HTMLElement).getByRole("button", { name: "View details" }))
    expect(onOpenSession).toHaveBeenCalledWith(profiles[4], undefined)
  })

  it("sorts Host rules by numeric local port, then remote port without mutating bridge data", async () => {
    const profiles = [
      { ...profileFixture(), id: "high", name: "High", localPort: 10000 },
      { ...profileFixture(), id: "same-high", name: "Same high", localPort: 443, remotePort: 9000 },
      { ...profileFixture(), id: "low", name: "Low", localPort: 80 },
      { ...profileFixture(), id: "same-low", name: "Same low", localPort: 443, remotePort: 80 }
    ]
    const rows = Object.freeze(profiles.map(profile => ({ profile })))
    const bridge = { ports: { listForHost: vi.fn(async () => rows) } } as unknown as RockerBridge
    render(<I18nProvider><PortsView bridge={bridge} mode="host" hostId="host-a" session={sessionFixture()} /></I18nProvider>)
    await screen.findByRole("article", { name: "Low" })
    expect(screen.getAllByRole("article").map(element => element.getAttribute("aria-label"))).toEqual(["Low", "Same low", "Same high", "High"])
    expect(rows.map(row => row.profile.name)).toEqual(["High", "Same high", "Low", "Same low"])
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
    const createProfile = vi.fn(async (_hostId: string, _request: Record<string, unknown>) => profileFixture())
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
    expect(screen.queryByLabelText("Start when requested")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Profile name"), { target: { value: "Web console" } })
    fireEvent.change(screen.getByLabelText("Remote address"), { target: { value: "127.0.0.1" } })
    fireEvent.change(screen.getByLabelText("Remote port"), { target: { value: "8080" } })
    fireEvent.change(screen.getByLabelText("Local port"), { target: { value: "18080" } })
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }))

    expect(await createProfile).toHaveBeenCalledWith("host-a", expect.objectContaining({ name: "Web console", remotePort: 8080 }))
    expect(createProfile.mock.calls[0]?.[1]).not.toHaveProperty("autoStart")
    expect(screen.queryByText("Policy")).not.toBeInTheDocument()
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
    expect(startProfile).toHaveBeenCalledOnce()
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
    expect(resume).toHaveBeenCalledOnce()
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
