import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import { I18nProvider } from "../../i18n"
import type { HostProfile } from "../../app/types"
import type { SftpWorkspaceSession } from "../terminal/session-state"
import { SftpWorkspaceView } from "./WorkspaceLandingViews"

const host: HostProfile = {
  id: "host-a",
  name: "G11",
  host: "example.test",
  port: 22,
  username: "root",
  authMethod: "agent",
  favorite: false,
  notes: ""
}

const session: SftpWorkspaceSession = {
  id: "session-sftp-a",
  hostId: host.id,
  label: host.name,
  kind: "sftp",
  state: "idle",
  browser: { path: "/", entries: [], loading: false }
}

describe("SftpWorkspaceView", () => {
  it("starts with Local on the left and a Hosts chooser on the right", () => {
    const onOpen = vi.fn()
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} bridge={bridge} onOpen={onOpen} onPatch={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("heading", { name: "Local" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
    expect(container.querySelectorAll(".sftp-file-pane")).toHaveLength(2)
    expect(container.querySelector(".view-header")).not.toBeInTheDocument()
    for (const pane of container.querySelectorAll(".sftp-file-pane")) {
      expect(pane.querySelector(":scope > .sftp-pane-titlebar")).toBeInTheDocument()
      expect(pane.querySelector(":scope > .sftp-pane-breadcrumb")).toBeInTheDocument()
      expect(pane.querySelector(":scope > .sftp-file-table-header")).toBeInTheDocument()
      expect(pane.querySelector(":scope > .sftp-file-table-body")).toBeInTheDocument()
    }
    const hostRow = screen.getByRole("row", { name: /G11/ })
    fireEvent.click(hostRow)
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.doubleClick(hostRow)
    expect(onOpen).toHaveBeenCalledWith(host)
  })

  it("renders the selected host as a matching four-column file pane", async () => {
    const bridge = createBridge()
    const selectedSession = { ...session, browser: { ...session.browser, path: "/home/deploy" } }
    const onPatch = vi.fn()
    const rendered = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={selectedSession} bridge={bridge} onOpen={vi.fn()} onPatch={onPatch} /></I18nProvider>)

    expect(screen.getByRole("heading", { name: "Local" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Hosts" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "G11" })).toBeInTheDocument()
    expect(screen.getAllByRole("columnheader", { name: "Name" })).toHaveLength(2)
    expect(screen.getAllByRole("columnheader", { name: "Date Modified" })).toHaveLength(2)
    expect(screen.getAllByRole("columnheader", { name: "Size" })).toHaveLength(2)
    expect(screen.getAllByRole("columnheader", { name: "Kind" })).toHaveLength(2)
    await waitFor(() => expect(bridge.sftp.open).toHaveBeenCalledWith(session.id, host.id))
    expect(bridge.sftp.list).toHaveBeenCalledWith(session.id, "/home/deploy")

    const directory = { name: "docs", path: "/home/deploy/docs", type: "directory" as const, modifiedAt: "2026-09-18T00:00:00.000Z" }
    rendered.rerender(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...selectedSession, browser: { path: "/home/deploy", entries: [directory], loading: false } }} bridge={bridge} onOpen={vi.fn()} onPatch={onPatch} /></I18nProvider>)
    const docsRow = screen.getByRole("row", { name: /docs/ })
    fireEvent.click(docsRow)
    expect(docsRow).toHaveAttribute("aria-selected", "true")
    fireEvent.doubleClick(docsRow)
    expect(onPatch).toHaveBeenCalledWith(session.id, expect.objectContaining({ kind: "sftp", browser: expect.objectContaining({ path: "/home/deploy/docs" }) }))

    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    fireEvent.click(within(remotePane).getByRole("button", { name: "home" }))
    expect(onPatch).toHaveBeenCalledWith(session.id, expect.objectContaining({ kind: "sftp", browser: expect.objectContaining({ path: "/home" }) }))
  })

  it("selects and opens real local directories without changing the remote session", async () => {
    const bridge = createBridge()
    vi.mocked(bridge.sftp.listLocal).mockImplementation(async (path) => ({
      path: path ?? "/Users/test",
      entries: !path || path === "/Users/test" ? [{ name: "Documents", path: "/Users/test/Documents", type: "directory" as const }] : []
    }))
    const onPatch = vi.fn()
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={session} bridge={bridge} onOpen={vi.fn()} onPatch={onPatch} /></I18nProvider>)

    const documents = await screen.findByRole("row", { name: /Documents/ })
    fireEvent.click(documents)
    await waitFor(() => expect(documents).toHaveAttribute("aria-selected", "true"))
    const localPane = screen.getByRole("heading", { name: "Local" }).closest(".sftp-file-pane") as HTMLElement
    fireEvent.click(within(localPane).getByRole("button", { name: "Actions" }))
    expect(within(localPane).getByRole("menuitem", { name: "Upload selected" })).toBeDisabled()
    fireEvent.doubleClick(documents)

    await waitFor(() => expect(bridge.sftp.listLocal).toHaveBeenLastCalledWith("/Users/test/Documents"))
    expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "location")
    expect(onPatch).not.toHaveBeenCalledWith(session.id, expect.objectContaining({ browser: expect.objectContaining({ path: "/Users/test/Documents" }) }))
  })

  it("keeps selected local files in the Local pane without inventing remote state", async () => {
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    const file = new File(["payload"], "payload.txt", { type: "text/plain" })
    const input = container.querySelector("input[type=\"file\"]") as HTMLInputElement

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByText("payload.txt")).toBeInTheDocument())
    expect(screen.getByRole("row", { name: /payload\.txt.*7 B.*File/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
    expect(bridge.sftp.open).not.toHaveBeenCalled()
  })

  it("opens compact Filter and Actions overlays without changing the pane layout", () => {
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={session} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement

    fireEvent.click(within(remotePane).getByRole("button", { name: "Filter" }))
    expect(within(remotePane).getByRole("search")).toBeInTheDocument()
    fireEvent.click(within(remotePane).getByRole("button", { name: "Filter" }))
    fireEvent.click(within(remotePane).getByRole("button", { name: "Actions" }))
    expect(within(remotePane).getByRole("menu")).toBeInTheDocument()
    expect(within(remotePane).getByRole("menuitem", { name: "Refresh directory" })).toBeInTheDocument()
    expect(container.querySelectorAll(".sftp-file-pane")).toHaveLength(2)
  })
})

function createBridge(): RockerBridge {
  return {
    sftp: {
      listLocal: vi.fn(async () => ({ path: "/home/test", entries: [] })),
      open: vi.fn(async (workspaceId: string, hostId: string) => ({ workspaceId, hostId, connectionId: "connection-a", state: "ready" as const })),
      close: vi.fn(async () => undefined),
      list: vi.fn(async (workspaceId: string, path: string) => ({ workspaceId, path, entries: [] })),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      chooseUpload: vi.fn(async () => undefined),
      chooseDownload: vi.fn(async () => undefined),
      upload: vi.fn(),
      download: vi.fn(),
      listTransfers: vi.fn(async () => []),
      cancelTransfer: vi.fn(async () => undefined),
      retryTransfer: vi.fn()
    },
    events: { onSftpEvent: vi.fn(() => () => undefined) }
  } as unknown as RockerBridge
}
