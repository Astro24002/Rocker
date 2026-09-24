import {
  ArrowLeft,
  ArrowRightLeft,
  Archive,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  Laptop,
  ListFilter,
  RefreshCw,
  Search,
  Server,
  Square,
  Trash2,
  Upload,
  X
} from "lucide-react"
import { createPortal } from "react-dom"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from "react"
import type { RockerBridge } from "../../../electron/ipc/bridge-contract"
import type { SftpTransferTask } from "../../../electron/sftp/types"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import type { SftpDirectoryEntry, SftpWorkspaceSession, WorkspaceSessionPatch } from "../terminal/session-state"

interface SftpWorkspacePageProps {
  hosts: readonly HostProfile[]
  selectedSession?: SftpWorkspaceSession
  bridge: RockerBridge
  onOpen(host: HostProfile): void
  onPatch(sessionId: string, patch: WorkspaceSessionPatch): void
  samplePreview?: boolean
}

interface FilePaneEntry {
  id: string
  name: string
  path?: string
  modifiedAt?: string
  size?: number
  kind: "folder" | "file" | "symlink" | "host" | "other"
}

interface PaneBreadcrumbItem {
  id: string
  label: string
}

interface SftpContextMenuPosition {
  x: number
  y: number
}

interface PaneAction {
  id: string
  label: string
  icon: ReactNode
  disabled?: boolean
  separator?: boolean
  onSelect(): void
}

const localFileDragType = "application/x-rocker-sftp-local-path"
const remoteFileDragType = "application/x-rocker-sftp-remote-path"

interface RemoteDragPayload {
  path: string
  name: string
  kind: "file" | "directory"
}

function SftpWorkspaceHeader({ hosts, selectedSession, samplePreview }: {
  hosts: readonly HostProfile[]
  selectedSession?: SftpWorkspaceSession
  samplePreview: boolean
}): ReactElement {
  const { t } = useI18n()
  const host = hosts.find((item) => item.id === selectedSession?.hostId)
  const connectionState = selectedSession?.state === "connected"
    ? t("workspace.sftp.state.connected")
    : selectedSession?.state === "error"
      ? t("workspace.sftp.state.error")
      : selectedSession?.state === "disconnected"
        ? t("workspace.sftp.state.disconnected")
        : t("workspace.sftp.state.connecting")

  return (
    <header className="sftp-page-topbar">
      <div className="sftp-page-heading">
        <div aria-hidden="true" className="sftp-page-mark">R</div>
        <div>
          <p className="sftp-page-kicker">Rocker / SFTP</p>
          <h1>{t("workspace.sftp.title")}</h1>
        </div>
      </div>
      <div className="sftp-page-meta" aria-label={t("workspace.sftp.status")}>
        <span aria-hidden="true" className="sftp-page-status-dot" data-state={samplePreview ? "connected" : selectedSession?.state ?? "idle"} />
        {samplePreview ? <>
          <span>{t("workspace.sftp.preview")}</span>
          <span>{t("workspace.sftp.sampleData")}</span>
        </> : selectedSession ? <>
          <span>{`${host?.name ?? selectedSession.label} · ${host?.username ?? ""}`.trim()}</span>
          <span>{connectionState}</span>
        </> : <span>{t("workspace.sftp.selectHostSubtitle")}</span>}
      </div>
    </header>
  )
}

interface FilePaneProps {
  id: string
  title: string
  subtitle: string
  titleIcon: ReactNode
  breadcrumbs: readonly PaneBreadcrumbItem[]
  entries: readonly FilePaneEntry[]
  selectedEntryId?: string
  actions: readonly PaneAction[]
  loading?: boolean
  error?: string
  emptyMessage: string
  filterPlaceholder: string
  onBack?(): void
  onBreadcrumbSelect?(item: PaneBreadcrumbItem): void
  onEntrySelect(entry: FilePaneEntry): void
  onEntryOpen(entry: FilePaneEntry): void
  onPaneContextMenu?(): void
  contextMenuEnabled?: boolean
  onBlankContextMenu?(event: ReactMouseEvent<HTMLDivElement>): void
  onEntryContextMenu?(entry: FilePaneEntry, trigger: HTMLDivElement, point?: { x: number; y: number }): void
  onEntryDragStart?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  onEntryDrop?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  canDragFolders?: boolean
  movingEntryIds?: ReadonlySet<string>
  onDragEnter?(event: DragEvent<HTMLDivElement>): void
  onDragOver?(event: DragEvent<HTMLDivElement>): void
  onDragLeave?(event: DragEvent<HTMLDivElement>): void
  onDrop?(event: DragEvent<HTMLDivElement>): void
  dropActive?: boolean
}

export function SftpWorkspacePage({ hosts, selectedSession, bridge, onOpen, onPatch, samplePreview = false }: SftpWorkspacePageProps): ReactElement {
  const { t } = useI18n()
  const localRootPath = useRef<string | undefined>(undefined)
  const [localDirectory, setLocalDirectory] = useState<{ path: string; entries: SftpDirectoryEntry[]; loading: boolean; error?: string }>({ path: "", entries: [], loading: true })
  const [selectedLocalId, setSelectedLocalId] = useState<string>()
  const [selectedRemoteId, setSelectedRemoteId] = useState<string>()
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const [dropActive, setDropActive] = useState(false)
  const [transfers, setTransfers] = useState<SftpTransferTask[]>([])

  const remotePath = selectedSession?.browser.path || "."
  const selectedHost = hosts.find((host) => host.id === selectedSession?.hostId)
  const remoteTitle = selectedSession ? selectedHost?.name ?? selectedSession.label : t("workspace.sftp.hosts")
  const remoteSubtitle = selectedSession
    ? `${t("workspace.sftp.protocolSsh")} · ${selectedHost?.username ?? ""}`.trim()
    : t("workspace.sftp.selectHostSubtitle")
  const selectedRemoteEntry = selectedSession?.browser.entries.find((entry) => entry.path === selectedRemoteId)
  const selectedLocalEntry = localDirectory.entries.find((entry) => entry.path === selectedLocalId)
  const activeTransfers = useMemo(
    () => transfers.filter((task) => task.status === "queued" || task.status === "running"),
    [transfers]
  )
  const movingRemoteIds = useMemo(() => new Set(
    activeTransfers
      .filter((task) => task.direction === "move")
      .map((task) => task.sourcePath)
      .filter((path): path is string => path !== undefined)
  ), [activeTransfers])
  const copyingLocalIds = useMemo(() => new Set(
    activeTransfers
      .filter((task) => task.direction === "upload")
      .map((task) => task.sourcePath)
      .filter((path): path is string => path !== undefined)
  ), [activeTransfers])

  const rememberTransfer = (task: SftpTransferTask): void => {
    setTransfers((current) => {
      const index = current.findIndex((candidate) => candidate.id === task.id)
      if (index < 0) return [...current, task]
      const next = [...current]
      next[index] = task
      return next
    })
  }

  useEffect(() => {
    let active = true
    setLocalDirectory((current) => ({ ...current, loading: true, error: undefined }))
    void bridge.sftp.listLocal(localDirectory.path || undefined).then((directory) => {
      if (!active) return
      if (!localRootPath.current) localRootPath.current = directory.path
      setLocalDirectory({ path: directory.path, entries: directory.entries, loading: false })
    }).catch((reason: unknown) => {
      if (!active) return
      setLocalDirectory((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : String(reason) }))
    })
    return () => { active = false }
  }, [bridge, localDirectory.path, localRefreshNonce])

  const refreshRemote = useCallback(async (): Promise<void> => {
    if (!selectedSession) return
    onPatch(selectedSession.id, { kind: "sftp", browser: { path: remotePath, loading: true, error: undefined } })
    try {
      await bridge.sftp.open(selectedSession.id, selectedSession.hostId)
      const directory = await bridge.sftp.list(selectedSession.id, remotePath)
      onPatch(selectedSession.id, {
        kind: "sftp",
        state: "connected",
        browser: { path: directory.path, entries: directory.entries, loading: false, error: undefined }
      })
      setActionError(undefined)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      onPatch(selectedSession.id, { kind: "sftp", state: "error", browser: { loading: false, error: message } })
      setActionError(message)
    }
  }, [bridge, onPatch, remotePath, selectedSession?.hostId, selectedSession?.id])

  useEffect(() => {
    void refreshRemote()
  }, [refreshNonce, refreshRemote])

  useEffect(() => {
    let active = true
    if (!selectedSession) {
      setTransfers([])
      return () => { active = false }
    }
    void bridge.sftp.listTransfers(selectedSession.id).then((tasks) => {
      if (!active) return
      setTransfers((current) => {
        const merged = new Map(current.map((task) => [task.id, task]))
        for (const task of tasks) merged.set(task.id, task)
        return [...merged.values()]
      })
    }).catch(() => {
      if (active) setTransfers([])
    })
    return () => { active = false }
  }, [bridge, selectedSession?.id])

  useEffect(() => {
    if (!selectedSession) return
    return bridge.events.onSftpEvent((event) => {
      if (event.kind === "workspace" && event.workspace.workspaceId === selectedSession.id) {
        onPatch(selectedSession.id, { kind: "sftp", state: event.workspace.state === "ready" ? "connected" : "disconnected" })
        return
      }
      if (event.kind !== "transfer" || event.task.workspaceId !== selectedSession.id) return
      rememberTransfer(event.task)
      if ((event.task.direction === "move" || event.task.direction === "upload") && (event.task.status === "completed" || event.task.status === "failed" || event.task.status === "cancelled")) {
        setRefreshNonce((current) => current + 1)
      }
    })
  }, [bridge, onPatch, selectedSession?.id])

  useEffect(() => {
    setSelectedRemoteId(undefined)
  }, [remotePath, selectedSession?.id])

  useEffect(() => {
    const completedTransfers = transfers.filter((task) => task.status === "completed")
    if (completedTransfers.length === 0) return
    const nextExpiry = Math.min(...completedTransfers.map((task) => Date.parse(task.updatedAt) + 60_000))
    const timeout = window.setTimeout(() => {
      const now = Date.now()
      setTransfers((current) => current.filter((task) => task.status !== "completed" || now - Date.parse(task.updatedAt) < 60_000))
    }, Math.max(0, nextExpiry - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [transfers])

  useEffect(() => {
    if (selectedRemoteId && movingRemoteIds.has(selectedRemoteId)) setSelectedRemoteId(undefined)
  }, [movingRemoteIds, selectedRemoteId])

  useEffect(() => {
    if (selectedLocalId && copyingLocalIds.has(selectedLocalId)) setSelectedLocalId(undefined)
  }, [copyingLocalIds, selectedLocalId])

  const uploadLocalPath = async (localPath: string): Promise<void> => {
    if (!selectedSession) return
    const selection = await bridge.sftp.chooseUpload(selectedSession.id, remotePath, localPath)
    if (!selection) return
    let result = await bridge.sftp.upload(selection.selectionId)
    if (result.kind === "overwrite-required") {
      if (!window.confirm(t("session.sftp.overwritePrompt"))) return
      result = await bridge.sftp.upload(selection.selectionId, true)
    }
    if (result.kind === "started") rememberTransfer({ ...result.task, sourcePath: result.task.sourcePath ?? localPath })
  }

  const startUpload = async (): Promise<void> => {
    if (!selectedSession) return
    try {
      const selection = await bridge.sftp.chooseUpload(selectedSession.id, remotePath)
      if (!selection) return
      let result = await bridge.sftp.upload(selection.selectionId)
      if (result.kind === "overwrite-required") {
        if (!window.confirm(t("session.sftp.overwritePrompt"))) return
        result = await bridge.sftp.upload(selection.selectionId, true)
      }
      if (result.kind === "started") rememberTransfer(result.task)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const createDirectory = async (): Promise<void> => {
    if (!selectedSession) return
    const name = window.prompt(t("session.sftp.newFolderPrompt"))?.trim()
    if (!name) return
    try {
      await bridge.sftp.mkdir(selectedSession.id, joinSftpPath(remotePath, name))
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const downloadEntry = async (entry: SftpDirectoryEntry | undefined): Promise<void> => {
    if (!selectedSession || !entry || entry.type !== "file") return
    try {
      const selection = await bridge.sftp.chooseDownload(selectedSession.id, entry.path, entry.name)
      if (!selection) return
      let result = await bridge.sftp.download(selection.selectionId)
      if (result.kind === "overwrite-required") {
        if (!window.confirm(t("session.sftp.overwritePrompt"))) return
        result = await bridge.sftp.download(selection.selectionId, true)
      }
      if (result.kind === "started") rememberTransfer(result.task)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const renameEntry = async (entry: SftpDirectoryEntry | undefined): Promise<void> => {
    if (!selectedSession || !entry) return
    const nextName = window.prompt(t("session.sftp.renamePrompt"), entry.name)?.trim()
    if (!nextName || nextName === entry.name) return
    if (nextName.includes("/") || nextName.includes("\u0000")) {
      setActionError(t("session.sftp.invalidName"))
      return
    }
    try {
      await bridge.sftp.rename(selectedSession.id, entry.path, joinSftpPath(remotePath, nextName))
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const removeEntry = async (entry: SftpDirectoryEntry | undefined): Promise<void> => {
    if (!selectedSession || !entry || (entry.type !== "file" && entry.type !== "directory")) return
    const firstConfirmation = t("session.sftp.removePrompt").replace("{name}", entry.name)
    const secondConfirmation = t("session.sftp.removeConfirmAgain").replace("{name}", entry.name)
    if (!window.confirm(firstConfirmation) || !window.confirm(secondConfirmation)) return
    try {
      await bridge.sftp.remove(selectedSession.id, entry.path, entry.type)
      setSelectedRemoteId(undefined)
      setRefreshNonce((current) => current + 1)
      setActionError(undefined)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const navigateRemote = (path: string): void => {
    if (!selectedSession || path === remotePath) return
    onPatch(selectedSession.id, { kind: "sftp", browser: { path, error: undefined } })
  }

  const navigateLocal = (path: string): void => {
    if (path === localDirectory.path) return
    setLocalDirectory((current) => ({ ...current, path, entries: [], loading: true, error: undefined }))
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetDirectory = remotePath): void => {
    event.preventDefault()
    setDropActive(false)
    const remotePayload = readRemoteDragPayload(event)
    if (remotePayload) {
      if (!selectedSession) {
        setActionError(t("session.sftp.dropUnsupported"))
        return
      }
      const destination = joinSftpPath(targetDirectory, remotePayload.name)
      if (destination === remotePayload.path || destination.startsWith(`${remotePayload.path}/`)) {
        setActionError(t("session.sftp.moveInvalidTarget"))
        return
      }
      void bridge.sftp.move(selectedSession.id, remotePayload.path, destination, remotePayload.kind)
        .then((result) => {
          if (result.kind !== "started") return
          rememberTransfer(result.task)
          setSelectedRemoteId(undefined)
          setActionError(undefined)
        })
        .catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : String(reason)))
      return
    }
    const internalPath = event.dataTransfer.getData(localFileDragType)
    const paths = [internalPath, ...Array.from(event.dataTransfer.files)
      .map(localFilePath)
      .filter((value): value is string => value !== undefined)]
      .filter((value, index, values): value is string => value.length > 0 && values.indexOf(value) === index)
    if (!selectedSession || paths.length === 0) {
      setActionError(t("session.sftp.dropUnsupported"))
      return
    }
    void (async (): Promise<void> => {
      for (const path of paths) await uploadLocalPath(path)
      setActionError(undefined)
    })().catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : String(reason)))
  }

  const handleLocalDragStart = (entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void => {
    if (entry.kind !== "file" || !entry.path) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData(localFileDragType, entry.path)
    event.dataTransfer.setData("text/plain", entry.name)
  }

  const handleRemoteDragStart = (entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void => {
    if (!selectedSession || !entry.path || (entry.kind !== "file" && entry.kind !== "folder") || movingRemoteIds.has(entry.path)) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(remoteFileDragType, JSON.stringify({
      path: entry.path,
      name: entry.name,
      kind: entry.kind === "folder" ? "directory" : "file"
    } satisfies RemoteDragPayload))
    event.dataTransfer.setData("text/plain", entry.name)
  }

  const handleRemoteEntryDrop = (entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void => {
    if (entry.kind !== "folder" || !entry.path) {
      event.preventDefault()
      setActionError(t("session.sftp.moveFolderTarget"))
      return
    }
    handleDrop(event, entry.path)
  }

  const handleRemotePaneDrop = (event: DragEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-entry-kind]") : null
    const targetDirectory = target?.dataset.entryKind === "folder" && target.dataset.entryPath ? target.dataset.entryPath : remotePath
    handleDrop(event, targetDirectory)
  }

  const localEntries = useMemo<FilePaneEntry[]>(() => [
    ...localDirectory.entries.map((entry) => ({
      id: entry.path,
      name: entry.name,
      path: entry.path,
      modifiedAt: entry.modifiedAt,
      size: entry.type === "directory" ? undefined : entry.size,
      kind: entry.type === "directory" ? "folder" as const : entry.type
    }))
  ], [localDirectory.entries])

  const remoteEntries = useMemo<FilePaneEntry[]>(() => selectedSession
    ? selectedSession.browser.entries.map((entry) => ({
        id: entry.path,
        name: entry.name,
        path: entry.path,
        modifiedAt: entry.modifiedAt,
        size: entry.type === "directory" ? undefined : entry.size,
        kind: entry.type === "directory" ? "folder" : entry.type
      }))
    : hosts.map((host) => ({ id: host.id, name: host.name, kind: "host" as const })), [hosts, selectedSession])

  const localActions = useMemo<PaneAction[]>(() => [
    ...(selectedSession && selectedLocalEntry ? [{
      id: "copy-to-host",
      label: t("workspace.sftp.copyToHost").replace("{host}", remoteTitle),
      icon: <Copy aria-hidden="true" size={14} />,
      disabled: !selectedSession || selectedLocalEntry.type !== "file" || copyingLocalIds.has(selectedLocalEntry.path),
      onSelect: () => {
        if (selectedLocalEntry.type !== "file") return
        void uploadLocalPath(selectedLocalEntry.path).catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : String(reason)))
      }
    }] : []),
    {
      id: "refresh-local",
      label: t("session.sftp.refresh"),
      icon: <RefreshCw aria-hidden="true" size={14} />,
      onSelect: () => setLocalRefreshNonce((current) => current + 1)
    }
  ], [copyingLocalIds, remoteTitle, selectedLocalEntry, selectedSession, t])

  const remoteActions = useMemo<PaneAction[]>(() => selectedSession ? [
    {
      id: "refresh",
      label: t("session.sftp.refresh"),
      icon: <RefreshCw aria-hidden="true" size={14} />,
      onSelect: () => setRefreshNonce((current) => current + 1)
    },
    {
      id: "new-folder",
      label: t("session.sftp.newFolder"),
      icon: <FolderPlus aria-hidden="true" size={14} />,
      onSelect: () => void createDirectory()
    },
    ...(selectedRemoteEntry ? [{
      id: "rename",
      label: t("session.sftp.rename"),
      icon: <File aria-hidden="true" size={14} />,
      disabled: !selectedRemoteEntry,
      onSelect: () => void renameEntry(selectedRemoteEntry)
    }, {
      id: "remove",
      label: t("session.sftp.remove"),
      icon: <Trash2 aria-hidden="true" size={14} />,
      disabled: !selectedRemoteEntry || (selectedRemoteEntry.type !== "file" && selectedRemoteEntry.type !== "directory"),
      onSelect: () => void removeEntry(selectedRemoteEntry)
    }] : []),
    {
      id: "upload",
      label: t("session.sftp.upload"),
      icon: <Upload aria-hidden="true" size={14} />,
      separator: true,
      onSelect: () => void startUpload()
    },
    {
      id: "download",
      label: t("session.sftp.download"),
      icon: <Download aria-hidden="true" size={14} />,
      disabled: selectedRemoteEntry?.type !== "file",
      onSelect: () => void downloadEntry(selectedRemoteEntry)
    }
  ] : [], [selectedRemoteEntry, selectedSession, t])

  const remoteBreadcrumbs = selectedSession
    ? remotePath === "." ? [{ id: ".", label: "~" }] : pathBreadcrumbs(remotePath)
    : [{ id: "hosts", label: t("workspace.sftp.hosts") }]

  return (
    <section className="sftp-workspace-shell" aria-label={t("session.sftp.title")}>
      <SftpWorkspaceHeader hosts={hosts} selectedSession={selectedSession} samplePreview={samplePreview} />
      <div className="sftp-workspace-stage">
        <div className="sftp-workspace-page">
      <FilePane
        id="local"
        title={t("workspace.sftp.local")}
        subtitle={t("workspace.sftp.localSubtitle")}
        titleIcon={<span className="sftp-local-mark"><Laptop aria-hidden="true" size={15} /></span>}
        breadcrumbs={localDirectory.path ? localPathBreadcrumbs(localDirectory.path, localRootPath.current, t("workspace.sftp.desktop")) : [{ id: "local", label: t("workspace.sftp.local") }]}
        entries={localEntries}
        selectedEntryId={selectedLocalId}
        actions={localActions}
        emptyMessage={t("workspace.sftp.noLocalFiles")}
        filterPlaceholder={t("workspace.sftp.filterPlaceholder")}
        loading={localDirectory.loading}
        error={localDirectory.error}
        onBack={localDirectory.path && localRootPath.current && !sameLocalPath(localDirectory.path, localRootPath.current) ? () => navigateLocal(parentLocalPath(localDirectory.path)) : undefined}
        onBreadcrumbSelect={(item) => navigateLocal(item.id)}
        onEntrySelect={(entry) => setSelectedLocalId(entry.id)}
        onPaneContextMenu={() => setSelectedLocalId(undefined)}
        contextMenuEnabled
        onEntryDragStart={handleLocalDragStart}
        movingEntryIds={copyingLocalIds}
        onEntryOpen={(entry) => {
          if (entry.kind === "folder" && entry.path) navigateLocal(entry.path)
        }}
      />
      <FilePane
        id="remote"
        title={remoteTitle}
        subtitle={remoteSubtitle}
        titleIcon={<span className="sftp-remote-mark"><Server aria-hidden="true" size={14} /></span>}
        breadcrumbs={remoteBreadcrumbs}
        entries={remoteEntries}
        selectedEntryId={selectedRemoteId}
        actions={remoteActions}
        loading={selectedSession?.browser.loading}
        error={selectedSession?.browser.error ?? actionError}
        emptyMessage={selectedSession ? t("session.sftp.emptyTitle") : t("workspace.sftp.selectHost")}
        filterPlaceholder={t("workspace.sftp.filterPlaceholder")}
        onBack={selectedSession && remotePath !== "/" && remotePath !== "." ? () => navigateRemote(parentSftpPath(remotePath)) : undefined}
        onBreadcrumbSelect={(item) => { if (selectedSession) navigateRemote(item.id) }}
        onEntrySelect={(entry) => setSelectedRemoteId(entry.id)}
        onPaneContextMenu={() => setSelectedRemoteId(undefined)}
        contextMenuEnabled={Boolean(selectedSession)}
        onEntryOpen={(entry) => {
          if (!selectedSession) {
            const host = hosts.find((candidate) => candidate.id === entry.id)
            if (host) onOpen(host)
            return
          }
          const directory = selectedSession.browser.entries.find((candidate) => candidate.path === entry.id)
          if (directory?.type === "directory") navigateRemote(directory.path)
        }}
        onEntryDragStart={selectedSession ? handleRemoteDragStart : undefined}
        onEntryDrop={selectedSession ? handleRemoteEntryDrop : undefined}
        canDragFolders={Boolean(selectedSession)}
        movingEntryIds={movingRemoteIds}
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = readRemoteDragPayload(event) ? "move" : "copy" }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false) }}
        onDrop={handleRemotePaneDrop}
        dropActive={dropActive}
      />
        </div>
        <SftpTransferFooter
          transfers={transfers.filter(isTransferVisible)}
          bridge={bridge}
          remoteTitle={remoteTitle}
          onDismiss={(taskId) => setTransfers((current) => current.filter((task) => task.id !== taskId))}
        />
      </div>
    </section>
  )
}

export function FilePane({
  id,
  title,
  subtitle,
  titleIcon,
  breadcrumbs,
  entries,
  selectedEntryId,
  actions,
  onPaneContextMenu,
  contextMenuEnabled = true,
  loading = false,
  error,
  emptyMessage,
  filterPlaceholder,
  onBack,
  onBreadcrumbSelect,
  onEntrySelect,
  onEntryOpen,
  onEntryDragStart,
  onEntryDrop,
  canDragFolders,
  movingEntryIds,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  dropActive = false
}: FilePaneProps): ReactElement {
  const { t } = useI18n()
  const [filter, setFilter] = useState("")
  const [contextMenu, setContextMenu] = useState<SftpContextMenuPosition>()
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuTriggerRef = useRef<HTMLElement | null>(null)
  const closeContextMenu = useCallback((restoreFocus = true): void => {
    setContextMenu(undefined)
    if (restoreFocus) contextMenuTriggerRef.current?.focus()
  }, [])
  const openContextMenu = useCallback((trigger: HTMLElement, point?: { x: number; y: number }, entry?: FilePaneEntry): void => {
    if (!contextMenuEnabled) return
    if (entry) onEntrySelect(entry)
    else onPaneContextMenu?.()
    contextMenuTriggerRef.current = trigger
    const width = 224
    const height = Math.max(52, actions.length * 32 + 16)
    const bounds = trigger.getBoundingClientRect()
    const x = point?.x ?? bounds.left + 12
    const y = point?.y ?? bounds.bottom
    setContextMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    })
  }, [actions.length, contextMenuEnabled, onEntrySelect, onPaneContextMenu])
  const deferredFilter = useDeferredValue(filter.trim().toLocaleLowerCase())
  const visibleEntries = deferredFilter
    ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(deferredFilter))
    : entries

  useEffect(() => {
    if (!contextMenu) return
    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    })
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return
      closeContextMenu(false)
    }
    const handleMenuKeys = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeContextMenu()
        return
      }
      const items = Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
      if (items.length === 0) return
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
      let nextIndex: number | undefined
      if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
      else if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
      else if (event.key === "Home") nextIndex = 0
      else if (event.key === "End") nextIndex = items.length - 1
      if (nextIndex === undefined) return
      event.preventDefault()
      items[nextIndex]?.focus()
    }
    window.addEventListener("pointerdown", dismissOutside)
    window.addEventListener("keydown", handleMenuKeys)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener("pointerdown", dismissOutside)
      window.removeEventListener("keydown", handleMenuKeys)
    }
  }, [closeContextMenu, contextMenu])

  return (
    <section className="sftp-file-pane" aria-labelledby={`sftp-${id}-title`} data-pane={id}>
      <PaneHeader id={`sftp-${id}-title`} title={title} subtitle={subtitle} icon={titleIcon} filter={filter} filterPlaceholder={filterPlaceholder} onFilterChange={setFilter} />
      <PaneBreadcrumb items={breadcrumbs} onBack={onBack} onSelect={onBreadcrumbSelect} />
      <FileTableHeader />
      <FileTableBody
        entries={visibleEntries}
        selectedEntryId={selectedEntryId}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        onEntrySelect={onEntrySelect}
        onEntryOpen={onEntryOpen}
        onEntryDragStart={onEntryDragStart}
        onEntryDrop={onEntryDrop}
        canDragFolders={canDragFolders}
        movingEntryIds={movingEntryIds}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        dropActive={dropActive}
        contextMenuEnabled={contextMenuEnabled}
        onBlankContextMenu={(event) => openContextMenu(event.currentTarget, { x: event.clientX, y: event.clientY })}
        onEntryContextMenu={(entry, trigger, point) => openContextMenu(trigger, point, entry)}
      />
      {contextMenu ? createPortal(
        <div
          aria-label={`${title} ${t("workspace.sftp.actions")}`}
          className="terminal-context-menu sftp-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => { if (event.key === "Tab") closeContextMenu() }}
          ref={contextMenuRef}
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          tabIndex={-1}
        >
          {actions.map((action) => (
            <button
              className={`${action.separator ? "has-separator " : ""}${action.id === "remove" ? "sftp-context-danger" : ""}`.trim() || undefined}
              disabled={action.disabled}
              key={action.id}
              onClick={() => { closeContextMenu(false); action.onSelect() }}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              {action.icon}<span>{action.label}</span>
            </button>
          ))}
        </div>,
        document.body
      ) : null}
    </section>
  )
}

function PaneHeader({
  id,
  title,
  subtitle,
  icon,
  filter,
  filterPlaceholder,
  onFilterChange
}: {
  id: string
  title: string
  subtitle: string
  icon: ReactNode
  filter: string
  filterPlaceholder: string
  onFilterChange(value: string): void
}): ReactElement {
  const { t } = useI18n()
  const headerRef = useRef<HTMLElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  useEffect(() => {
    if (!filterOpen) return
    const close = (event: PointerEvent): void => {
      if (!headerRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [filterOpen])

  return (
    <header className="sftp-pane-titlebar" ref={headerRef}>
      <div className="sftp-pane-title">
        {icon}
        <div className="sftp-pane-copy">
          <h2 id={id}>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="sftp-pane-controls">
        <button aria-expanded={filterOpen} className="sftp-pane-control" type="button" onClick={() => setFilterOpen((current) => !current)}>
          <ListFilter aria-hidden="true" size={15} />
          <span>{t("workspace.sftp.filter")}</span>
        </button>
      </div>
      {filterOpen ? (
        <div className="sftp-pane-popover sftp-filter-popover" role="search">
          <Search aria-hidden="true" size={14} />
          <input autoFocus aria-label={t("workspace.sftp.filter")} value={filter} placeholder={filterPlaceholder} onChange={(event) => onFilterChange(event.target.value)} />
        </div>
      ) : null}
    </header>
  )
}

function PaneBreadcrumb({ items, onBack, onSelect }: { items: readonly PaneBreadcrumbItem[]; onBack?(): void; onSelect?(item: PaneBreadcrumbItem): void }): ReactElement {
  const { t } = useI18n()
  return (
    <nav className="sftp-pane-breadcrumb" aria-label={t("workspace.sftp.pathNavigation")}>
      <button aria-label={t("workspace.sftp.back")} disabled={!onBack} type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={15} />
      </button>
      <ol>
        {items.map((item, index) => <li key={item.id}>
          {index > 0 ? <ChevronRight aria-hidden="true" size={12} /> : null}
          <button aria-current={index === items.length - 1 ? "location" : undefined} disabled={!onSelect || index === items.length - 1} type="button" onClick={() => onSelect?.(item)}>{item.label}</button>
        </li>)}
      </ol>
    </nav>
  )
}

function FileTableHeader(): ReactElement {
  const { t } = useI18n()
  const columns = [t("session.sftp.column.name"), t("session.sftp.column.dateModified"), t("session.sftp.column.size"), t("session.sftp.column.kind")]
  return (
    <div className="sftp-file-table-header" role="row">
      {columns.map((label) => <span key={label} role="columnheader" title={label}>{label}</span>)}
    </div>
  )
}

function FileTableBody({
  entries,
  selectedEntryId,
  loading,
  error,
  emptyMessage,
  onEntrySelect,
  onEntryOpen,
  onEntryDragStart,
  onEntryDrop,
  canDragFolders,
  movingEntryIds,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  dropActive,
  contextMenuEnabled,
  onBlankContextMenu,
  onEntryContextMenu
}: Omit<FilePaneProps, "id" | "title" | "subtitle" | "titleIcon" | "breadcrumbs" | "actions" | "filterPlaceholder" | "onBack" | "onBreadcrumbSelect">): ReactElement {
  const { t } = useI18n()
  return (
    <div
      className="sftp-file-table-body"
      data-drop-active={dropActive || undefined}
      role="rowgroup"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(event) => {
        if (!contextMenuEnabled) return
        event.preventDefault()
        onBlankContextMenu?.(event)
      }}
    >
      {error ? <div className="sftp-pane-message" role="alert">{error}</div> : null}
      {loading ? <div className="sftp-pane-message" role="status">{t("session.sftp.loading")}</div> : null}
      {!loading && entries.length === 0 ? <div className="sftp-pane-message">{emptyMessage}</div> : null}
      {!loading && entries.map((entry) => (
        <FileRow
          entry={entry}
          key={entry.id}
          selected={entry.id === selectedEntryId}
          onSelect={() => onEntrySelect(entry)}
          onOpen={() => onEntryOpen(entry)}
          onDragStart={onEntryDragStart}
          onDrop={onEntryDrop}
          onContextMenuRequest={contextMenuEnabled ? onEntryContextMenu : undefined}
          canDragFolders={canDragFolders}
          moving={movingEntryIds?.has(entry.path ?? entry.id) ?? false}
        />
      ))}
    </div>
  )
}

function FileRow({ entry, selected, onSelect, onOpen, onDragStart, onDrop, onContextMenuRequest, canDragFolders = false, moving = false }: {
  entry: FilePaneEntry
  selected: boolean
  onSelect(): void
  onOpen(): void
  onDragStart?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  onDrop?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  onContextMenuRequest?(entry: FilePaneEntry, trigger: HTMLDivElement, point?: { x: number; y: number }): void
  canDragFolders?: boolean
  moving?: boolean
}): ReactElement {
  const { t } = useI18n()
  const kindLabel = entry.kind === "folder"
    ? t("session.sftp.kind.folder")
    : entry.kind === "file"
      ? fileKindLabel(entry.name, t("session.sftp.kind.file"))
      : entry.kind === "symlink"
        ? t("session.sftp.kind.symlink")
        : entry.kind === "host"
          ? t("session.sftp.kind.host")
          : t("session.sftp.kind.other")
  const isFolder = entry.kind === "folder" || entry.kind === "host"
  const isArchive = entry.kind === "file" && kindLabel === "Archive"
  const canDrop = onDrop !== undefined && entry.kind === "folder"
  const canDrag = !moving && onDragStart !== undefined && entry.path !== undefined && (entry.kind === "file" || (canDragFolders && entry.kind === "folder"))
  return (
    <div
      aria-selected={selected}
      aria-disabled={moving || undefined}
      className="sftp-file-row"
      data-kind={entry.kind}
      data-entry-kind={entry.kind}
      data-entry-path={entry.path}
      data-moving={moving || undefined}
      draggable={canDrag}
      role="row"
      tabIndex={moving ? -1 : 0}
      aria-haspopup={onContextMenuRequest ? "menu" : undefined}
      onContextMenu={(event) => {
        if (!onContextMenuRequest) return
        event.preventDefault()
        event.stopPropagation()
        if (moving) return
        onContextMenuRequest(entry, event.currentTarget, { x: event.clientX, y: event.clientY })
      }}
      onClick={() => { if (!moving) onSelect() }}
      onDoubleClick={() => { if (!moving) onOpen() }}
      onDragStart={(event) => { if (moving) event.preventDefault(); else onDragStart?.(entry, event) }}
      onDragOver={(event) => {
        if (!canDrop || moving || !event.dataTransfer.types.includes(remoteFileDragType)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }}
      onDrop={(event) => {
        if (!canDrop || moving) return
        event.preventDefault()
        event.stopPropagation()
        onDrop?.(entry, event)
      }}
      onKeyDown={(event) => {
        if (moving) return
        const opensContextMenu = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)
        if (opensContextMenu && onContextMenuRequest) {
          event.preventDefault()
          onContextMenuRequest(entry, event.currentTarget)
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="sftp-file-name" role="cell">{isFolder ? <Folder aria-hidden="true" size={17} /> : isArchive ? <Archive aria-hidden="true" size={16} /> : <File aria-hidden="true" size={16} />}<span>{entry.name}</span></span>
      <span className="sftp-file-meta" role="cell">{formatModifiedAt(entry.modifiedAt, t("workspace.sftp.today"), t("workspace.sftp.yesterday"))}</span>
      <span className="sftp-file-meta" role="cell">{isFolder ? "-" : formatFileSize(entry.size)}</span>
      <span className="sftp-file-meta" role="cell">{kindLabel}</span>
    </div>
  )
}

function SftpTransferFooter({ transfers, bridge, remoteTitle, onDismiss }: {
  transfers: readonly SftpTransferTask[]
  bridge: RockerBridge
  remoteTitle: string
  onDismiss(taskId: string): void
}): ReactElement | null {
  const { t } = useI18n()
  if (transfers.length === 0) return null
  const orderedTransfers = [...transfers].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const primaryTask = orderedTransfers[0]
  const statusLabel = primaryTask.status === "queued"
    ? t("session.sftp.transferStatus.queued")
    : primaryTask.status === "completed"
      ? t("session.sftp.transferStatus.completed")
      : primaryTask.status === "failed"
        ? t("session.sftp.transferStatus.failed")
        : primaryTask.status === "cancelled"
          ? t("session.sftp.transferStatus.cancelled")
          : primaryTask.direction === "move"
            ? t("session.sftp.transferStatus.moving")
            : t("session.sftp.transferStatus.running")
  const operationLabel = primaryTask.direction === "upload"
    ? t("session.sftp.copy")
    : primaryTask.direction === "move"
      ? t("session.sftp.move")
      : t("session.sftp.download")
  const itemKind = primaryTask.entryType === "directory" ? t("session.sftp.kind.folder") : t("session.sftp.kind.file")
  const progress = primaryTask.totalBytes && primaryTask.totalBytes > 0 ? Math.min(100, Math.round(primaryTask.bytesTransferred / primaryTask.totalBytes * 100)) : undefined
  const terminal = primaryTask.status === "completed" || primaryTask.status === "failed" || primaryTask.status === "cancelled"
  const description = primaryTask.direction === "download"
    ? `${itemKind}: ${primaryTask.name} · ${remoteTitle}:${primaryTask.remotePath}`
    : `${itemKind}: ${primaryTask.name} → ${remoteTitle}:${primaryTask.remotePath}`
  return (
    <footer className="sftp-transfer-footer" aria-label={t("session.sftp.transfers")}>
      <div className="sftp-transfer-task" data-direction={primaryTask.direction} data-status={primaryTask.status}>
        <span aria-hidden="true" className="sftp-transfer-status-dot" />
        {primaryTask.direction === "upload" ? <Copy aria-hidden="true" size={15} /> : primaryTask.direction === "move" ? <ArrowRightLeft aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}
        <strong>{operationLabel}</strong>
        <span className="sftp-transfer-description" title={primaryTask.sourcePath ? `${primaryTask.sourcePath} → ${primaryTask.remotePath}` : description}>{description}</span>
        <span className="sftp-transfer-progress-track" role="progressbar" aria-label={`${primaryTask.name} ${statusLabel}`} aria-valuemin={0} aria-valuemax={100} {...(progress === undefined ? {} : { "aria-valuenow": progress })}>
          <span className={terminal ? undefined : progress === undefined ? "is-indeterminate" : undefined} style={terminal ? { width: "100%" } : progress === undefined ? undefined : { width: `${progress}%` }} />
        </span>
        <span className="sftp-transfer-task-status">{orderedTransfers.length > 1 ? `${orderedTransfers.length} ${t("session.sftp.active")}` : terminal ? statusLabel : progress === undefined ? statusLabel : `${progress}%`}</span>
        <button aria-label={terminal ? t("session.sftp.dismissTransfer") : t("session.sftp.cancelTransfer")} className="sftp-transfer-task-action" title={terminal ? t("session.sftp.dismissTransfer") : t("session.sftp.cancelTransfer")} type="button" onClick={() => terminal ? onDismiss(primaryTask.id) : void bridge.sftp.cancelTransfer(primaryTask.id)}>
          {terminal ? <X aria-hidden="true" size={15} /> : <Square aria-hidden="true" size={13} />}
        </button>
      </div>
    </footer>
  )
}

function isTransferVisible(task: SftpTransferTask): boolean {
  if (task.status === "queued" || task.status === "running" || task.status === "failed") return true
  if (task.status !== "completed") return false
  return Date.now() - Date.parse(task.updatedAt) < 60_000
}

function readRemoteDragPayload(event: DragEvent<HTMLDivElement>): RemoteDragPayload | undefined {
  const raw = event.dataTransfer.getData(remoteFileDragType)
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRemoteDragPayload(value)) return undefined
    return value
  } catch {
    return undefined
  }
}

function isRemoteDragPayload(value: unknown): value is RemoteDragPayload {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.path === "string" && typeof candidate.name === "string" && (candidate.kind === "file" || candidate.kind === "directory")
}

function pathBreadcrumbs(path: string): PaneBreadcrumbItem[] {
  const normalized = normalizeSftpPath(path)
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0) return [{ id: "/", label: "/" }]
  const breadcrumbs: PaneBreadcrumbItem[] = []
  let current = ""
  for (const part of parts) {
    current += `/${part}`
    breadcrumbs.push({ id: current, label: part })
  }
  return breadcrumbs
}

function localPathBreadcrumbs(path: string, rootPath: string | undefined, rootLabel: string): PaneBreadcrumbItem[] {
  if (rootPath && !sameLocalPath(path, rootPath)) {
    const separator = path.includes("\\") ? "\\" : "/"
    const normalizedRoot = rootPath.replace(/[\\/]+$/, "")
    const normalizedPath = path.replace(/[\\/]+$/, "")
    const prefix = `${normalizedRoot}${separator}`
    const comparablePath = separator === "\\" ? normalizedPath.toLowerCase() : normalizedPath
    const comparablePrefix = separator === "\\" ? prefix.toLowerCase() : prefix
    if (comparablePath.startsWith(comparablePrefix)) {
      const tail = normalizedPath.slice(normalizedRoot.length + 1).split(/[\\/]+/).filter(Boolean)
      const breadcrumbs: PaneBreadcrumbItem[] = [{ id: rootPath, label: rootLabel }]
      let current = rootPath
      for (const part of tail) {
        current = `${current.replace(/[\\/]+$/, "")}${separator}${part}`
        breadcrumbs.push({ id: current, label: part })
      }
      return breadcrumbs
    }
  }
  if (rootPath && sameLocalPath(path, rootPath)) return [{ id: rootPath, label: rootLabel }]
  if (!path.includes("\\")) return pathBreadcrumbs(path)
  const normalized = path.replace(/[\\/]+$/, "")
  const drive = normalized.match(/^[A-Za-z]:/)?.[0]
  const parts = normalized.slice(drive?.length ?? 0).split(/[\\/]+/).filter(Boolean)
  const separator = "\\"
  const root = drive ? `${drive}${separator}` : separator
  const breadcrumbs: PaneBreadcrumbItem[] = [{ id: root, label: drive ?? separator }]
  let current = root
  for (const part of parts) {
    current = `${current.replace(/[\\/]+$/, "")}${separator}${part}`
    breadcrumbs.push({ id: current, label: part })
  }
  return breadcrumbs
}

function sameLocalPath(left: string, right: string): boolean {
  const normalize = (path: string): string => path.replace(/[\\/]+$/, "").toLowerCase()
  return normalize(left) === normalize(right)
}

function parentLocalPath(path: string): string {
  if (!path.includes("\\")) return parentSftpPath(path)
  const normalized = path.replace(/[\\/]+$/, "")
  if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}\\`
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"))
  if (index <= 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}\\`
  return normalized.slice(0, index) || "\\"
}

function normalizeSftpPath(value: string): string {
  const trimmed = value.trim() || "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function parentSftpPath(value: string): string {
  const normalized = normalizeSftpPath(value)
  if (normalized === "/") return "/"
  const parent = normalized.slice(0, normalized.lastIndexOf("/"))
  return parent || "/"
}

function joinSftpPath(directory: string, name: string): string {
  const base = directory.replace(/\/$/, "")
  return `${base || "/"}/${name}`.replace(/^\/\//, "/")
}

function localFilePath(file: File): string | undefined {
  const candidate = file as File & { path?: unknown }
  return typeof candidate.path === "string" && candidate.path.trim().length > 0 ? candidate.path : undefined
}

function formatModifiedAt(value: string | undefined, todayLabel: string, yesterdayLabel: string): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const now = new Date()
  const dateKey = (candidate: Date): string => `${candidate.getFullYear()}-${candidate.getMonth()}-${candidate.getDate()}`
  const dayOffset = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000)
  const relativeDay = dateKey(date) === dateKey(now)
    ? todayLabel
    : dayOffset === 1
      ? yesterdayLabel
      : date.toLocaleDateString("en-GB", { weekday: "short" })
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return `${relativeDay}${todayLabel === "Today" ? ", " : " "}${time}`
}

function formatFileSize(size: number | undefined): string {
  if (size === undefined) return "-"
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KB`
  if (size < 1_024 * 1_024 * 1_024) return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
  return `${(size / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`
}

function fileKindLabel(name: string, fallback: string): string {
  const normalized = name.toLowerCase()
  if (normalized.startsWith(".")) return "Document"
  if (/\.(zip|tar|gz|tgz|7z|rar)$/.test(normalized) || normalized.endsWith(".tar.gz")) return "Archive"
  if (/\.(md|markdown)$/.test(normalized)) return "Markdown"
  if (/\.(ya?ml)$/.test(normalized)) return "YAML"
  if (/\.json$/.test(normalized)) return "JSON"
  if (/\.html?$/.test(normalized)) return "HTML"
  if (/\.(m?js|cjs)$/.test(normalized)) return "JavaScript"
  if (/\.css$/.test(normalized)) return "CSS"
  if (/\.(png|jpe?g|gif|svg|webp|bmp)$/.test(normalized)) return "Image"
  if (/\.log$/.test(normalized)) return "Log"
  if (/\.(conf|ini|toml)$/.test(normalized)) return "Configuration"
  if (/\.txt$/.test(normalized)) return "Text"
  return fallback
}
