import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { SftpTransferTask } from "../../../electron/sftp/types"
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
    const route = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(Array.from(route.querySelectorAll("li"), (item) => item.textContent)).toEqual(["ROCKER", "SFTP", "G11"])
    expect(screen.queryByRole("heading", { name: "SFTP workspace" })).not.toBeInTheDocument()
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

  it("hides dotfiles by default and keeps the local and remote visibility controls independent", async () => {
    const bridge = createBridge()
    const localHidden = { name: ".local-secret", path: "/home/test/Desktop/.local-secret", type: "file" as const, size: 1 }
    const remoteHidden = { name: ".remote-secret", path: "/.remote-secret", type: "file" as const, size: 1 }
    vi.mocked(bridge.sftp.listLocal).mockResolvedValue({ path: "/home/test/Desktop", entries: [
      localHidden,
      { name: "local.txt", path: "/home/test/Desktop/local.txt", type: "file", size: 2 }
    ] })
    render(<I18nProvider><SftpWorkspaceView
      hosts={[host]}
      selectedSession={{ ...session, browser: { ...session.browser, entries: [
        remoteHidden,
        { name: "remote.txt", path: "/remote.txt", type: "file", size: 2 }
      ] } }}
      bridge={bridge}
      onOpen={vi.fn()}
      onPatch={vi.fn()}
    /></I18nProvider>)

    const localPane = screen.getByRole("heading", { name: "Local" }).closest(".sftp-file-pane") as HTMLElement
    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    await screen.findByRole("row", { name: /local\.txt/ })
    await screen.findByRole("row", { name: /remote\.txt/ })
    const localToggle = within(localPane).getByRole("checkbox", { name: "Show hidden files" })
    const remoteToggle = within(remotePane).getByRole("checkbox", { name: "Show hidden files" })

    expect(localToggle).not.toBeChecked()
    expect(remoteToggle).not.toBeChecked()
    expect(within(localPane).queryByRole("row", { name: /\.local-secret/ })).not.toBeInTheDocument()
    expect(within(remotePane).queryByRole("row", { name: /\.remote-secret/ })).not.toBeInTheDocument()
    expect(within(localPane).getByRole("row", { name: /local\.txt/ })).toBeInTheDocument()
    expect(within(remotePane).getByRole("row", { name: /remote\.txt/ })).toBeInTheDocument()

    fireEvent.click(remoteToggle)
    expect(remoteToggle).toBeChecked()
    expect(within(remotePane).getByRole("row", { name: /\.remote-secret/ })).toBeInTheDocument()
    expect(within(localPane).queryByRole("row", { name: /\.local-secret/ })).not.toBeInTheDocument()

    fireEvent.click(localToggle)
    expect(within(localPane).getByRole("row", { name: /\.local-secret/ })).toBeInTheDocument()
  })

  it("resets hidden-file visibility when an SFTP session closes and is opened again", async () => {
    const bridge = createBridge()
    const hiddenEntry = { name: ".ssh-config", path: "/.ssh-config", type: "file" as const, size: 1 }
    const selectedSession = { ...session, browser: { ...session.browser, entries: [hiddenEntry] } }
    const rendered = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={selectedSession} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    let remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    await waitFor(() => expect(bridge.sftp.list).toHaveBeenCalledWith(session.id, "/"))
    fireEvent.click(within(remotePane).getByRole("checkbox", { name: "Show hidden files" }))
    expect(within(remotePane).getByRole("row", { name: /\.ssh-config/ })).toBeInTheDocument()

    rendered.rerender(<I18nProvider><SftpWorkspaceView hosts={[host]} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    const hostsPane = screen.getByRole("heading", { name: "Hosts" }).closest(".sftp-file-pane") as HTMLElement
    expect(within(hostsPane).queryByRole("checkbox", { name: "Show hidden files" })).not.toBeInTheDocument()

    rendered.rerender(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={selectedSession} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    expect(within(remotePane).getByRole("checkbox", { name: "Show hidden files" })).not.toBeChecked()
    expect(within(remotePane).queryByRole("row", { name: /\.ssh-config/ })).not.toBeInTheDocument()
  })

  it("sorts by Name ascending by default and supports every column in both directions", async () => {
    const bridge = createBridge()
    const entries = [
      { name: "zeta.txt", path: "/zeta.txt", type: "file" as const, size: 200, modifiedAt: "2026-09-19T10:00:00.000Z" },
      { name: "Alpha.zip", path: "/Alpha.zip", type: "file" as const, size: 10, modifiedAt: "2026-09-20T10:00:00.000Z" },
      { name: "beta.log", path: "/beta.log", type: "file" as const, size: 100, modifiedAt: "2026-09-18T10:00:00.000Z" }
    ]
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries } }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    const column = (name: string): HTMLElement => within(remotePane).getByRole("columnheader", { name })

    expect(column("Name")).toHaveAttribute("aria-sort", "ascending")
    expect(rowNames(remotePane)).toEqual(["Alpha.zip", "beta.log", "zeta.txt"])

    fireEvent.click(within(column("Size")).getByRole("button", { name: "Size" }))
    expect(column("Size")).toHaveAttribute("aria-sort", "ascending")
    expect(rowNames(remotePane)).toEqual(["Alpha.zip", "beta.log", "zeta.txt"])
    fireEvent.click(within(column("Size")).getByRole("button", { name: "Size" }))
    expect(column("Size")).toHaveAttribute("aria-sort", "descending")
    expect(rowNames(remotePane)).toEqual(["zeta.txt", "beta.log", "Alpha.zip"])

    fireEvent.click(within(column("Date Modified")).getByRole("button", { name: "Date Modified" }))
    expect(column("Date Modified")).toHaveAttribute("aria-sort", "ascending")
    expect(rowNames(remotePane)).toEqual(["beta.log", "zeta.txt", "Alpha.zip"])

    fireEvent.click(within(column("Kind")).getByRole("button", { name: "Kind" }))
    expect(column("Kind")).toHaveAttribute("aria-sort", "ascending")
    expect(rowNames(remotePane)).toEqual(["Alpha.zip", "beta.log", "zeta.txt"])
    fireEvent.click(within(column("Kind")).getByRole("button", { name: "Kind" }))
    expect(column("Kind")).toHaveAttribute("aria-sort", "descending")
    expect(rowNames(remotePane)).toEqual(["zeta.txt", "beta.log", "Alpha.zip"])

    fireEvent.click(within(column("Name")).getByRole("button", { name: "Name" }))
    expect(column("Name")).toHaveAttribute("aria-sort", "ascending")
    fireEvent.click(within(column("Name")).getByRole("button", { name: "Name" }))
    expect(column("Name")).toHaveAttribute("aria-sort", "descending")
    expect(rowNames(remotePane)).toEqual(["zeta.txt", "beta.log", "Alpha.zip"])
  })

  it("shows a disconnected SFTP session as disconnected rather than connecting", async () => {
    const bridge = createBridge()
    const { container } = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, state: "disconnected" }} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const remotePane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane")
    expect(remotePane?.querySelector(".sftp-pane-copy > span")).toHaveTextContent("Disconnected")
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

    await screen.findByRole("row", { name: /Documents/ })
    fireEvent.click(screen.getByRole("row", { name: /Documents/ }))
    await waitFor(() => expect(screen.getByRole("row", { name: /Documents/ })).toHaveAttribute("aria-selected", "true"))
    fireEvent.contextMenu(screen.getByRole("row", { name: /Documents/ }))
    expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeEnabled()
    fireEvent.keyDown(window, { key: "Escape" })
    fireEvent.doubleClick(screen.getByRole("row", { name: /Documents/ }))

    await waitFor(() => expect(bridge.sftp.listLocal).toHaveBeenLastCalledWith("/Users/test/Documents"))
    expect(screen.getByRole("button", { name: "Documents" })).toHaveAttribute("aria-current", "location")
    expect(onPatch).not.toHaveBeenCalledWith(session.id, expect.objectContaining({ browser: expect.objectContaining({ path: "/Users/test/Documents" }) }))
  })

  it("copies a real Local file through the SFTP bridge and locks it while copying", async () => {
    const bridge = createBridge()
    const localFile = { name: "payload.txt", path: "/home/test/Desktop/payload.txt", type: "file" as const, size: 7 }
    const task: SftpTransferTask = {
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
      entryType: "file",
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
    vi.mocked(bridge.sftp.chooseUpload).mockResolvedValue({ selectionId: "selection-a", workspaceId: session.id, name: localFile.name, size: localFile.size, entryType: "file", remotePath: "/payload.txt" })
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

  it("copies a local folder to a remote folder as one transfer task", async () => {
    const bridge = createBridge()
    const localFolder = { name: "project", path: "/home/test/Desktop/project", type: "directory" as const }
    const remoteFolder = { name: "uploads", path: "/uploads", type: "directory" as const }
    vi.mocked(bridge.sftp.listLocal).mockResolvedValue({ path: "/home/test/Desktop", entries: [localFolder] })
    vi.mocked(bridge.sftp.chooseUpload).mockResolvedValue({ selectionId: "folder-upload", workspaceId: session.id, name: "project", entryType: "directory", remotePath: "/uploads/project" })
    vi.mocked(bridge.sftp.upload).mockResolvedValue({ kind: "started", task: {
      id: "folder-upload-task",
      workspaceId: session.id,
      hostId: host.id,
      direction: "upload",
      name: "project",
      remotePath: "/uploads/project",
      sourcePath: localFolder.path,
      entryType: "directory",
      status: "running",
      bytesTransferred: 0,
      totalBytes: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    } })
    const selectedSession = { ...session, browser: { ...session.browser, entries: [remoteFolder] } }
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={selectedSession} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const sourceRow = await screen.findByRole("row", { name: /project/ })
    expect(sourceRow).toHaveAttribute("draggable", "true")
    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(sourceRow, { dataTransfer })
    expect((dataTransfer as typeof dataTransfer & { types: string[] }).types).toContain("application/x-rocker-sftp-local-path")
    const targetRow = await screen.findByRole("row", { name: /uploads/ })
    fireEvent.dragOver(targetRow, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe("copy")
    fireEvent.drop(targetRow, { dataTransfer })

    await waitFor(() => expect(bridge.sftp.chooseUpload).toHaveBeenCalledWith(session.id, "/uploads", localFolder.path))
    expect(bridge.sftp.upload).toHaveBeenCalledWith("folder-upload")
    expect(bridge.sftp.move).not.toHaveBeenCalled()
    expect(await screen.findByText("Copy folder")).toBeInTheDocument()
    expect(sourceRow).toHaveAttribute("aria-disabled", "true")
  })

  it("copies a remote folder to a local folder and locks the remote source", async () => {
    const bridge = createBridge()
    const remoteFolder = { name: "release", path: "/release", type: "directory" as const }
    const localFolder = { name: "Downloads", path: "/home/test/Desktop/Downloads", type: "directory" as const }
    vi.mocked(bridge.sftp.listLocal).mockResolvedValue({ path: "/home/test/Desktop", entries: [localFolder] })
    vi.mocked(bridge.sftp.chooseDownload).mockResolvedValue({ selectionId: "folder-download", workspaceId: session.id, name: "release", entryType: "directory", remotePath: remoteFolder.path })
    const task: SftpTransferTask = {
      id: "folder-download-task",
      workspaceId: session.id,
      hostId: host.id,
      direction: "download",
      name: "release",
      remotePath: remoteFolder.path,
      localPath: "/home/test/Desktop/Downloads/release",
      entryType: "directory",
      status: "running",
      bytesTransferred: 0,
      totalBytes: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-18T00:00:00.000Z"
    }
    vi.mocked(bridge.sftp.download).mockResolvedValue({ kind: "started", task })
    const selectedSession = { ...session, browser: { ...session.browser, entries: [remoteFolder] } }
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={selectedSession} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const sourceRow = await screen.findByRole("row", { name: /release/ })
    const dataTransfer = createDataTransfer()
    fireEvent.dragStart(sourceRow, { dataTransfer })
    const targetRow = await screen.findByRole("row", { name: /Downloads/ })
    fireEvent.dragOver(targetRow, { dataTransfer })
    expect(dataTransfer.dropEffect).toBe("copy")
    fireEvent.drop(targetRow, { dataTransfer })

    await waitFor(() => expect(bridge.sftp.chooseDownload).toHaveBeenCalledWith(session.id, remoteFolder.path, "release", localFolder.path))
    expect(bridge.sftp.download).toHaveBeenCalledWith("folder-download")
    expect(bridge.sftp.move).not.toHaveBeenCalled()
    expect(await screen.findByText("Download folder")).toBeInTheDocument()
    expect(sourceRow).toHaveAttribute("aria-disabled", "true")

    const eventListener = vi.mocked(bridge.events.onSftpEvent).mock.calls[0]?.[0]
    expect(eventListener).toBeDefined()
    if (!eventListener) throw new Error("Expected SFTP transfer event listener")
    const localListCallsBeforeCompletion = vi.mocked(bridge.sftp.listLocal).mock.calls.length
    act(() => eventListener({ kind: "transfer", task: { ...task, status: "completed", bytesTransferred: 0, updatedAt: new Date().toISOString() } }))
    await waitFor(() => expect(bridge.sftp.listLocal).toHaveBeenCalledTimes(localListCallsBeforeCompletion + 1))
    expect(sourceRow).not.toHaveAttribute("aria-disabled", "true")
  })

  it("keeps Show hidden files enabled when a remote item is deleted and the listing refreshes", async () => {
    const bridge = createBridge()
    const hiddenEntry = { name: ".deploy-key", path: "/.deploy-key", type: "file" as const, size: 8 }
    const visibleEntry = { name: "notes.txt", path: "/notes.txt", type: "file" as const, size: 4 }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [visibleEntry] })
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<I18nProvider><SftpWorkspaceView
      hosts={[host]}
      selectedSession={{ ...session, browser: { ...session.browser, entries: [hiddenEntry, visibleEntry] } }}
      bridge={bridge}
      onOpen={vi.fn()}
      onPatch={vi.fn()}
    /></I18nProvider>)

    try {
      const pane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
      fireEvent.click(within(pane).getByRole("checkbox", { name: "Show hidden files" }))
      expect(within(pane).getByRole("row", { name: /\.deploy-key/ })).toBeInTheDocument()
      fireEvent.contextMenu(within(pane).getByRole("row", { name: /\.deploy-key/ }))
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }))

      await waitFor(() => expect(bridge.sftp.remove).toHaveBeenCalledWith(session.id, hiddenEntry.path, "file"))
      await waitFor(() => expect(bridge.sftp.list).toHaveBeenCalledTimes(2))
      expect(confirm).toHaveBeenCalledTimes(2)
      expect(within(pane).getByRole("checkbox", { name: "Show hidden files" })).toBeChecked()
      expect(within(pane).getByRole("row", { name: /\.deploy-key/ })).toBeInTheDocument()
    } finally {
      confirm.mockRestore()
    }
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

  it("lists concurrent tasks and exposes independent cancel and retry actions", async () => {
    const bridge = createBridge()
    const failedTask = {
      id: "failed-download",
      workspaceId: session.id,
      hostId: host.id,
      direction: "download" as const,
      name: "report.csv",
      remotePath: "/reports/report.csv",
      localPath: "/tmp/report.csv",
      status: "failed" as const,
      error: "Permission denied",
      bytesTransferred: 0,
      attempt: 1,
      createdAt: "2026-09-18T00:00:02.000Z",
      updatedAt: "2026-09-18T00:00:03.000Z"
    }
    const runningTask = {
      id: "running-upload",
      workspaceId: session.id,
      hostId: host.id,
      direction: "upload" as const,
      name: "payload.bin",
      remotePath: "/payload.bin",
      sourcePath: "/tmp/payload.bin",
      status: "running" as const,
      bytesTransferred: 4,
      totalBytes: 10,
      attempt: 1,
      createdAt: "2026-09-18T00:00:01.000Z",
      updatedAt: "2026-09-18T00:00:02.000Z"
    }
    vi.mocked(bridge.sftp.listTransfers).mockResolvedValue([runningTask, failedTask])
    vi.mocked(bridge.sftp.retryTransfer).mockResolvedValue({ kind: "started", task: { ...failedTask, status: "queued", error: undefined, attempt: 2 } })
    render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={session} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    expect(await screen.findByText("Permission denied")).toBeInTheDocument()
    const listToggle = await screen.findByRole("button", { name: "Show transfer tasks: 2" })
    fireEvent.click(listToggle)
    const taskList = screen.getByRole("region", { name: "Transfer tasks" })
    expect(within(taskList).getByText(/G11:\/reports\/report\.csv/)).toBeInTheDocument()
    expect(within(taskList).getByRole("alert")).toHaveTextContent("Permission denied")

    fireEvent.click(within(taskList).getByRole("button", { name: /Copy · payload\.bin/ }))
    expect(screen.queryByRole("region", { name: "Transfer tasks" })).not.toBeInTheDocument()
    expect(screen.getByText("/tmp/payload.bin → G11:/payload.bin")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show transfer tasks: 2" }))
    const reopenedTaskList = screen.getByRole("region", { name: "Transfer tasks" })

    fireEvent.click(within(reopenedTaskList).getByRole("button", { name: "Cancel transfer: payload.bin" }))
    expect(bridge.sftp.cancelTransfer).toHaveBeenCalledWith(runningTask.id)
    fireEvent.click(within(reopenedTaskList).getByRole("button", { name: "Retry transfer: report.csv" }))
    await waitFor(() => expect(bridge.sftp.retryTransfer).toHaveBeenCalledWith(failedTask.id))
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Transfer tasks" })).getByRole("button", { name: /Download · report\.csv/ })).toHaveTextContent("Queued"))
  })

  it("shows remote metadata without adding table columns or inventing missing values", async () => {
    const bridge = createBridge()
    const file = { name: "private.key", path: "/private.key", type: "file" as const, size: 128, permissions: 0o100600, uid: 1001, gid: 1002 }
    vi.mocked(bridge.sftp.list).mockResolvedValue({ path: "/", entries: [file] })
    const remotePane = { ...session, browser: { ...session.browser, entries: [file] } }
    const firstRender = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={remotePane} bridge={bridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)

    const pane = screen.getByRole("heading", { name: "G11" }).closest(".sftp-file-pane") as HTMLElement
    expect(within(pane).getAllByRole("columnheader")).toHaveLength(4)
    fireEvent.contextMenu(await screen.findByRole("row", { name: /private\.key/ }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Properties" }))
    const dialog = screen.getByRole("dialog", { name: "private.key" })
    expect(within(dialog).getByText("0600")).toBeInTheDocument()
    expect(within(dialog).getByText("1001")).toBeInTheDocument()
    expect(within(dialog).getByText("1002")).toBeInTheDocument()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    firstRender.unmount()

    const sparseBridge = createBridge()
    const sparseFile = { name: "plain.txt", path: "/plain.txt", type: "file" as const, size: 1 }
    vi.mocked(sparseBridge.sftp.list).mockResolvedValue({ path: "/", entries: [sparseFile] })
    const secondRender = render(<I18nProvider><SftpWorkspaceView hosts={[host]} selectedSession={{ ...session, browser: { ...session.browser, entries: [sparseFile] } }} bridge={sparseBridge} onOpen={vi.fn()} onPatch={vi.fn()} /></I18nProvider>)
    fireEvent.contextMenu(await screen.findByRole("row", { name: /plain\.txt/ }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Properties" }))
    const sparseDialog = screen.getByRole("dialog", { name: "plain.txt" })
    expect(within(sparseDialog).queryByText("Permissions")).not.toBeInTheDocument()
    expect(within(sparseDialog).queryByText("UID")).not.toBeInTheDocument()
    secondRender.unmount()
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
      "Download",
      "Properties"
    ])
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "G11 Actions" })).not.toBeInTheDocument()
    expect(row).toHaveFocus()
    fireEvent.keyDown(row, { key: "F10", shiftKey: true })
    await waitFor(() => expect(screen.getByRole("menu", { name: "G11 Actions" })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Refresh" })).toHaveFocus())
    fireEvent.keyDown(window, { key: "End" })
    expect(screen.getByRole("menuitem", { name: "Properties" })).toHaveFocus()
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
  const transfer = {
    files: [],
    effectAllowed: "none",
    dropEffect: "none",
    setData: (type: string, value: string) => { values.set(type, value) },
    getData: (type: string) => values.get(type) ?? ""
  }
  return Object.defineProperty(transfer, "types", { get: () => Array.from(values.keys()) })
}

function rowNames(pane: HTMLElement): string[] {
  return Array.from(pane.querySelectorAll<HTMLElement>(".sftp-file-row .sftp-file-name > span"), (name) => name.textContent ?? "")
}
