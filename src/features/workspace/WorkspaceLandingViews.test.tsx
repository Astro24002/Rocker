import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  it("starts at the local desktop with a Hosts chooser on the right", async () => {
    const onOpen = vi.fn()
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} bridge={bridge} onOpen={onOpen} onPatch={vi.fn()} /></I18nProvider>)

    expect(screen.getByRole("heading", { name: "Local" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument()
    await waitFor(() => expect(bridge.sftp.listLocal).toHaveBeenCalledWith(undefined))
    expect(await screen.findByRole("button", { name: "Desktop" })).toHaveAttribute("aria-current", "location")
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

  it("shows a disconnected SFTP session as disconnected rather than connecting", async () => {
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, state: "disconnected" }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(container.querySelector(".sftp-page-meta")).toHaveTextContent("Disconnected")
  })

  it("resolves a new host workspace to its real home and retains the resolved path", async () => {
    const bridge = createBridge()
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/srv/users/root", entries: [] })
    const onPatch = vi.fn()
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, path: "." } }} bridge={bridge} onOpen={vi.fn()} onPatch={onPatch} /></I18nProvider>)

    expect(screen.getByRole("button", { name: "~" })).toHaveAttribute("aria-current", "location")
    await waitFor(() => expect(bridge.sftp.list).toHaveBeenCalledWith(session.id, "."))
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith(session.id, expect.objectContaining({ browser: expect.objectContaining({ path: "/srv/users/root" }) })))
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
    fireEvent.contextMenu(documents)
    expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeEnabled()
    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.doubleClick(documents)

    await waitFor(() => expect(bridge.sftp.listLocal).toHaveBeenLastCalledWith("/Users/test/Documents"))
    expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "location")
    expect(onPatch).not.toHaveBeenCalledWith(session.id, expect.objectContaining({ browser: expect.objectContaining({ path: "/Users/test/Documents" }) }))
  })

  it("copies a real Local file through the SFTP bridge and locks it while copying", async () => {
    const bridge = createBridge()
    const localFile = { name: "payload.txt", path: "/home/test/Desktop/payload.txt", type: "file" as const, size: 7 }
    const task = {
      id: "copy-a",
      workspaceId: session.id,
      hostId: host.id,
      direction: "upload" as const,
      name: localFile.name,
      remotePath: "/payload.txt",
      sourcePath: localFile.path,
      entryType: "file" as const,
      status: "running" as const,
      bytesTransferred: 0,
      totalBytes: localFile.size,
      attempt: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    vi.mocked(bridge.sftp.listLocal).mockResolvedValue({ path: "/home/test/Desktop", entries: [localFile] })
    vi.mocked(bridge.sftp.chooseUpload).mockResolvedValue({
      selectionId: "selection-a",
      workspaceId: session.id,
      name: localFile.name,
      size: localFile.size,
      remotePath: "/payload.txt"
    })
    vi.mocked(bridge.sftp.upload).mockResolvedValue({ kind: "started", task })
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={session} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const row = await screen.findByRole("row", { name: /payload\.txt/ })
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy to G11" }))
    await waitFor(() => expect(bridge.sftp.chooseUpload).toHaveBeenCalledWith(session.id, "/", "/home/test/Desktop/payload.txt"))
    await waitFor(() => expect(bridge.sftp.upload).toHaveBeenCalledWith("selection-a"))
    expect(await screen.findByRole("contentinfo", { name: "Transfers" })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: /payload\.txt Transferring/ })).toBeInTheDocument()
    expect(row).toHaveAttribute("aria-disabled", "true")
    expect(row).toHaveAttribute("aria-selected", "false")
    expect(row).toHaveAttribute("draggable", "false")
  })

  it("uploads a local file dragged from the left pane into the remote pane", async () => {
    const bridge = createBridge()
    const localFile = { name: "payload.txt", path: "/home/test/Desktop/payload.txt", type: "file" as const, size: 7, modifiedAt: "2026-09-18T00:00:00.000Z" }
    vi.mocked(bridge.sftp.listLocal).mockResolvedValue({ path: "/home/test/Desktop", entries: [localFile] })
    vi.mocked(bridge.sftp.chooseUpload).mockResolvedValue({ selectionId: "selection-a", workspaceId: session.id, name: localFile.name, size: localFile.size, remotePath: "/payload.txt" })
    vi.mocked(bridge.sftp.upload).mockResolvedValue({ kind: "started", task: {
      id: "transfer-a",
      workspaceId: session.id,
      hostId: host.id,
      direction: "upload",
      name: localFile.name,
      remotePath: "/payload.txt",
      sourcePath: localFile.path,
      entryType: "file",
      status: "queued",
      bytesTransferred: 0,
      totalBytes: localFile.size,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    } })
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={session} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const localRow = await screen.findByRole("row", { name: /payload\.txt/ })
    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(localRow, { dataTransfer })
    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    const remoteBody = remotePane.querySelector(".sftp-file-table-body") as HTMLElement
    fireEvent.dragOver(remoteBody, { dataTransfer })
    fireEvent.drop(remoteBody, { dataTransfer })

    await waitFor(() => expect(bridge.sftp.chooseUpload).toHaveBeenCalledWith(session.id, "/", localFile.path))
    expect(bridge.sftp.upload).toHaveBeenCalledWith("selection-a")
    expect(await screen.findByRole("contentinfo", { name: "Transfers" })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: /payload\.txt Queued/ })).toBeInTheDocument()
    expect(await screen.findByRole("row", { name: /payload\.txt/ })).toHaveAttribute("aria-disabled", "true")
  })

  it("moves a remote file into a folder and locks the source row while it runs", async () => {
    const bridge = createBridge()
    const source = { name: "payload.txt", path: "/payload.txt", type: "file" as const, size: 7 }
    const folder = { name: "docs", path: "/docs", type: "directory" as const }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [source, folder] })
    vi.mocked(bridge.sftp.move).mockResolvedValue({ kind: "started", task: {
      id: "move-a",
      workspaceId: session.id,
      hostId: host.id,
      direction: "move",
      name: source.name,
      remotePath: "/docs/payload.txt",
      sourcePath: source.path,
      entryType: "file",
      status: "running",
      bytesTransferred: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    } })
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [source, folder] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const sourceRow = await screen.findByRole("row", { name: /payload\.txt/ })
    const folderRow = await screen.findByRole("row", { name: /docs/ })
    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(sourceRow, { dataTransfer })
    dataTransfer.setData("application/x-rocker-sftp-remote-path", JSON.stringify({ path: source.path, name: source.name, kind: "file" }))
    const dropDataTransfer = { ...dataTransfer, types: ["application/x-rocker-sftp-remote-path"] }
    fireEvent.dragOver(folderRow, { dataTransfer: dropDataTransfer })
    fireEvent.drop(folderRow, { dataTransfer: dropDataTransfer })

    await waitFor(() => expect(bridge.sftp.move).toHaveBeenCalledWith(session.id, "/payload.txt", "/docs/payload.txt", "file"))
    expect(sourceRow).toHaveAttribute("aria-disabled", "true")
    expect(sourceRow).toHaveAttribute("draggable", "false")
    fireEvent.click(sourceRow)
    expect(sourceRow).toHaveAttribute("aria-selected", "false")
    fireEvent.contextMenu(sourceRow)
    expect(screen.queryByRole("menu", { name: "G11 Actions" })).not.toBeInTheDocument()
  })

  it("shows a move task as one non-blocking progress row at the bottom", async () => {
    const bridge = createBridge()
    const movingFolder = { name: "docs", path: "/docs", type: "directory" as const }
    const task = {
      id: "move-folder-a",
      workspaceId: session.id,
      hostId: host.id,
      direction: "move" as const,
      name: movingFolder.name,
      remotePath: "/archive/docs",
      sourcePath: movingFolder.path,
      entryType: "directory" as const,
      status: "running" as const,
      bytesTransferred: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [movingFolder] })
    vi.mocked(bridge.sftp.listTransfers).mockResolvedValue([task])
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [movingFolder] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    expect(await screen.findByRole("contentinfo", { name: "Transfers" })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: /docs Moving/ })).toBeInTheDocument()
    expect(container.querySelectorAll(".sftp-transfer-task")).toHaveLength(1)
    const row = await screen.findByRole("row", { name: /docs/ })
    expect(row).toHaveAttribute("aria-disabled", "true")
  })

  it("keeps a completed transfer visible for one minute, then removes its status row", async () => {
    const bridge = createBridge()
    vi.useFakeTimers({ now: Date.now() })
    const movedFolder = { name: "docs", path: "/docs", type: "directory" as const }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [movedFolder] })
    vi.mocked(bridge.sftp.listTransfers).mockResolvedValue([{
      id: "move-folder-completed",
      workspaceId: session.id,
      hostId: host.id,
      direction: "move",
      name: movedFolder.name,
      remotePath: "/archive/docs",
      sourcePath: movedFolder.path,
      entryType: "directory",
      status: "completed",
      bytesTransferred: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: new Date().toISOString()
    }])
    try {
      await act(async () => {
        render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [movedFolder] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
        await Promise.resolve()
      })

      expect(screen.getByRole("contentinfo", { name: "Transfers" })).toBeInTheDocument()
      expect(screen.getByRole("progressbar", { name: /docs Completed/ })).toBeInTheDocument()
      expect(screen.getByRole("row", { name: /docs/ })).not.toHaveAttribute("aria-disabled", "true")
      await act(async () => { await vi.advanceTimersByTimeAsync(60_001) })
      expect(screen.queryByRole("contentinfo", { name: "Transfers" })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it("opens the file actions from a row context menu in the requested order", async () => {
    const bridge = createBridge()
    const file = { name: "payload.txt", path: "/payload.txt", type: "file" as const, size: 7 }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [file] })
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [file] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement

    fireEvent.click(within(remotePane).getByRole("button", { name: "Filter" }))
    expect(within(remotePane).getByRole("search")).toBeInTheDocument()
    fireEvent.click(within(remotePane).getByRole("button", { name: "Filter" }))
    expect(within(remotePane).queryByRole("button", { name: "Actions" })).not.toBeInTheDocument()
    const row = await screen.findByRole("row", { name: /payload\.txt/ })
    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 })
    const menu = screen.getByRole("menu", { name: "G11 Actions" })
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Refresh",
      "New Folder",
      "Rename",
      "Delete",
      "Upload",
      "Download"
    ])
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "G11 Actions" })).not.toBeInTheDocument()
    expect(row).toHaveFocus()
    fireEvent.keyDown(row, { key: "F10", shiftKey: true })
    await waitFor(() => expect(screen.getByRole("menu", { name: "G11 Actions" })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Refresh" })).toHaveFocus())
    fireEvent.keyDown(window, { key: "End" })
    expect(screen.getByRole("menuitem", { name: "Download" })).toHaveFocus()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(row).toHaveFocus()
    expect(container.querySelectorAll(".sftp-file-pane")).toHaveLength(2)
  })

  it("requires two confirmations before deleting a remote item", async () => {
    const bridge = createBridge()
    const file = { name: "payload.txt", path: "/payload.txt", type: "file" as const, size: 7 }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [file] })
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValueOnce(false)
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [file] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const row = await screen.findByRole("row", { name: /payload\.txt/ })
    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenNthCalledWith(1, "Delete payload.txt?")
    expect(confirm).toHaveBeenNthCalledWith(2, "This cannot be undone. Delete payload.txt permanently?")
    expect(bridge.sftp.remove).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it("deletes only after both confirmations are accepted", async () => {
    const bridge = createBridge()
    const file = { name: "payload.txt", path: "/payload.txt", type: "file" as const, size: 7 }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [file] })
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [file] } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    fireEvent.contextMenu(await screen.findByRole("row", { name: /payload\.txt/ }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

    await waitFor(() => expect(bridge.sftp.remove).toHaveBeenCalledWith(session.id, file.path, "file"))
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })
})

function createBridge(): RockerBridge {
  return {
    sftp: {
      listLocal: vi.fn(async () => ({ path: "/home/test/Desktop", entries: [] })),
      open: vi.fn(async (workspaceId: string, hostId: string) => ({ workspaceId, hostId, connectionId: "connection-a", state: "ready" as const })),
      close: vi.fn(async () => undefined),
      list: vi.fn(async (workspaceId: string, path: string) => ({ workspaceId, path, entries: [] })),
      mkdir: vi.fn(async () => undefined),
      rename: vi.fn(async () => undefined),
      move: vi.fn(),
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

function createDataTransfer() {
  const values = new Map<string, string>()
  return {
    files: [],
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => { values.set(type, value) },
    getData: (type: string) => values.get(type) ?? ""
  }
}
