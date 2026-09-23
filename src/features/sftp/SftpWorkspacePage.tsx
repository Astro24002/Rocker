import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
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
  Upload
} from "lucide-react"
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
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
}

interface LocalFileEntry {
  id: string
  name: string
  size: number
  modifiedAt: string
  path?: string
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

interface FilePaneProps {
  id: string
  title: string
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

export function SftpWorkspacePage({ hosts, selectedSession, bridge, onOpen, onPatch }: SftpWorkspacePageProps): ReactElement {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>([])
  const [localDirectory, setLocalDirectory] = useState<{ path: string; entries: SftpDirectoryEntry[]; loading: boolean; error?: string }>({ path: "", entries: [], loading: true })
  const [localError, setLocalError] = useState<string>()
  const [selectedLocalId, setSelectedLocalId] = useState<string>()
  const [selectedRemoteId, setSelectedRemoteId] = useState<string>()
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0)
  const [actionError, setActionError] = useState<string>()
  const [dropActive, setDropActive] = useState(false)
  const [transfers, setTransfers] = useState<SftpTransferTask[]>([])

  const remotePath = selectedSession?.browser.path ?? "/"
  const selectedRemoteEntry = selectedSession?.browser.entries.find((entry) => entry.path === selectedRemoteId)
  const selectedLocalEntry = [...localDirectory.entries, ...localFiles.map((file) => ({ name: file.name, path: file.path ?? file.name, type: "file" as const, size: file.size, modifiedAt: file.modifiedAt }))]
    .find((entry) => entry.path === selectedLocalId)
  const activeMoveTransfers = useMemo(
    () => transfers.filter((task) => task.direction === "move" && (task.status === "queued" || task.status === "running")),
    [transfers]
  )
  const movingRemoteIds = useMemo(() => new Set(
    activeMoveTransfers
      .map((task) => task.sourcePath)
      .filter((path): path is string => path !== undefined)
  ), [activeMoveTransfers])

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
      if (event.task.direction === "move" && (event.task.status === "completed" || event.task.status === "failed" || event.task.status === "cancelled")) {
        setRefreshNonce((current) => current + 1)
      }
    })
  }, [bridge, onPatch, selectedSession?.id])

  useEffect(() => {
    setSelectedRemoteId(undefined)
  }, [remotePath, selectedSession?.id])

  useEffect(() => {
    if (selectedRemoteId && movingRemoteIds.has(selectedRemoteId)) setSelectedRemoteId(undefined)
  }, [movingRemoteIds, selectedRemoteId])

  const selectLocalFiles = (files: FileList | null): void => {
    if (!files) return
    const nextFiles = Array.from(files).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
      path: localFilePath(file)
    }))
    setLocalFiles(nextFiles)
    setSelectedLocalId(nextFiles[0]?.id)
    setLocalError(undefined)
  }

  const uploadLocalPath = async (localPath: string): Promise<void> => {
    if (!selectedSession) return
    const selection = await bridge.sftp.chooseUpload(selectedSession.id, remotePath, localPath)
    if (!selection) return
    let result = await bridge.sftp.upload(selection.selectionId)
    if (result.kind === "overwrite-required") {
      if (!window.confirm(t("session.sftp.overwritePrompt"))) return
      result = await bridge.sftp.upload(selection.selectionId, true)
    }
    if (result.kind === "started") rememberTransfer(result.task)
  }

  const uploadLocalFile = async (file: { path?: string } | undefined): Promise<void> => {
    if (!file?.path) return
    try {
      await uploadLocalPath(file.path)
      setLocalError(undefined)
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason))
    }
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
    if (!window.confirm(t("session.sftp.removePrompt"))) return
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
    })),
    ...localFiles
      .filter((file) => !localDirectory.entries.some((entry) => entry.path === file.path))
      .map((file) => ({ id: file.id, name: file.name, path: file.path, modifiedAt: file.modifiedAt, size: file.size, kind: "file" as const }))
  ], [localDirectory.entries, localFiles])

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
    {
      id: "refresh-local",
      label: t("session.sftp.refresh"),
      icon: <RefreshCw aria-hidden="true" size={14} />,
      onSelect: () => setLocalRefreshNonce((current) => current + 1)
    },
    {
      id: "choose-files",
      label: t("workspace.sftp.chooseLocalFiles"),
      icon: <FolderPlus aria-hidden="true" size={14} />,
      onSelect: () => fileInputRef.current?.click()
    },
    {
      id: "upload-selected",
      label: t("workspace.sftp.uploadSelected"),
      icon: <Upload aria-hidden="true" size={14} />,
      disabled: !selectedSession || selectedLocalEntry?.type !== "file" || !selectedLocalEntry.path,
      onSelect: () => void uploadLocalFile(selectedLocalEntry)
    }
  ], [selectedLocalEntry, selectedSession, t])

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
    {
      id: "upload",
      label: t("session.sftp.upload"),
      icon: <Upload aria-hidden="true" size={14} />,
      onSelect: () => void startUpload()
    },
    {
      id: "download",
      label: t("session.sftp.download"),
      icon: <Download aria-hidden="true" size={14} />,
      disabled: selectedRemoteEntry?.type !== "file",
      separator: true,
      onSelect: () => void downloadEntry(selectedRemoteEntry)
    },
    {
      id: "rename",
      label: t("session.sftp.rename"),
      icon: <File aria-hidden="true" size={14} />,
      disabled: !selectedRemoteEntry,
      onSelect: () => void renameEntry(selectedRemoteEntry)
    },
    {
      id: "remove",
      label: t("session.sftp.remove"),
      icon: <Trash2 aria-hidden="true" size={14} />,
      disabled: !selectedRemoteEntry || (selectedRemoteEntry.type !== "file" && selectedRemoteEntry.type !== "directory"),
      onSelect: () => void removeEntry(selectedRemoteEntry)
    }
  ] : [], [selectedRemoteEntry, selectedSession, t])

  const remoteBreadcrumbs = selectedSession
    ? remotePath === "." ? [{ id: ".", label: "~" }] : pathBreadcrumbs(remotePath)
    : [{ id: "hosts", label: t("workspace.sftp.hosts") }]

  return (
    <section className="sftp-workspace-shell" aria-label={t("session.sftp.title")}>
      <input
        className="sftp-hidden-file-input"
        multiple
        onChange={(event) => selectLocalFiles(event.target.files)}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <div className="sftp-workspace-page">
      <FilePane
        id="local"
        title={t("workspace.sftp.local")}
        titleIcon={<span className="sftp-local-mark"><Laptop aria-hidden="true" size={15} /></span>}
        breadcrumbs={localDirectory.path ? localPathBreadcrumbs(localDirectory.path) : [{ id: "local", label: t("workspace.sftp.local") }]}
        entries={localEntries}
        selectedEntryId={selectedLocalId}
        actions={localActions}
        emptyMessage={t("workspace.sftp.noLocalFiles")}
        filterPlaceholder={t("workspace.sftp.filterPlaceholder")}
        loading={localDirectory.loading}
        error={localDirectory.error ?? localError}
        onBack={localDirectory.path && !isLocalRoot(localDirectory.path) ? () => navigateLocal(parentLocalPath(localDirectory.path)) : undefined}
        onBreadcrumbSelect={(item) => navigateLocal(item.id)}
        onEntrySelect={(entry) => setSelectedLocalId(entry.id)}
        onEntryDragStart={handleLocalDragStart}
        onEntryOpen={(entry) => {
          if (entry.kind === "folder" && entry.path) navigateLocal(entry.path)
        }}
      />
      <FilePane
        id="remote"
        title={selectedSession?.label ?? t("workspace.sftp.hosts")}
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
      <SftpTransferFooter transfers={activeMoveTransfers} bridge={bridge} />
    </section>
  )
}

export function FilePane({
  id,
  title,
  titleIcon,
  breadcrumbs,
  entries,
  selectedEntryId,
  actions,
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
  const [filter, setFilter] = useState("")
  const deferredFilter = useDeferredValue(filter.trim().toLocaleLowerCase())
  const visibleEntries = deferredFilter
    ? entries.filter((entry) => entry.name.toLocaleLowerCase().includes(deferredFilter))
    : entries

  return (
    <section className="sftp-file-pane" aria-labelledby={`sftp-${id}-title`} data-pane={id}>
      <PaneHeader id={`sftp-${id}-title`} title={title} icon={titleIcon} filter={filter} filterPlaceholder={filterPlaceholder} actions={actions} onFilterChange={setFilter} />
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
      />
    </section>
  )
}

function PaneHeader({
  id,
  title,
  icon,
  filter,
  filterPlaceholder,
  actions,
  onFilterChange
}: {
  id: string
  title: string
  icon: ReactNode
  filter: string
  filterPlaceholder: string
  actions: readonly PaneAction[]
  onFilterChange(value: string): void
}): ReactElement {
  const { t } = useI18n()
  const headerRef = useRef<HTMLElement>(null)
  const [openMenu, setOpenMenu] = useState<"filter" | "actions">()

  useEffect(() => {
    if (!openMenu) return
    const close = (event: PointerEvent): void => {
      if (!headerRef.current?.contains(event.target as Node)) setOpenMenu(undefined)
    }
    window.addEventListener("pointerdown", close)
    return () => window.removeEventListener("pointerdown", close)
  }, [openMenu])

  return (
    <header className="sftp-pane-titlebar" ref={headerRef}>
      <div className="sftp-pane-title">{icon}<h2 id={id}>{title}</h2></div>
      <div className="sftp-pane-controls">
        <button aria-expanded={openMenu === "filter"} className="sftp-pane-control" type="button" onClick={() => setOpenMenu((current) => current === "filter" ? undefined : "filter")}>
          <ListFilter aria-hidden="true" size={13} />
          <span>{t("workspace.sftp.filter")}</span>
        </button>
        <button aria-expanded={openMenu === "actions"} className="sftp-pane-control" type="button" onClick={() => setOpenMenu((current) => current === "actions" ? undefined : "actions")}>
          <span>{t("workspace.sftp.actions")}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </div>
      {openMenu === "filter" ? (
        <div className="sftp-pane-popover sftp-filter-popover" role="search">
          <Search aria-hidden="true" size={14} />
          <input autoFocus aria-label={t("workspace.sftp.filter")} value={filter} placeholder={filterPlaceholder} onChange={(event) => onFilterChange(event.target.value)} />
        </div>
      ) : null}
      {openMenu === "actions" ? (
        <div className="sftp-pane-popover sftp-actions-menu" role="menu">
          {actions.length === 0 ? <span className="sftp-actions-empty">{t("workspace.sftp.noActions")}</span> : actions.map((action) => (
            <button className={action.separator ? "has-separator" : undefined} disabled={action.disabled} key={action.id} role="menuitem" type="button" onClick={() => { action.onSelect(); setOpenMenu(undefined) }}>
              {action.icon}<span>{action.label}</span>
            </button>
          ))}
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
  dropActive
}: Omit<FilePaneProps, "id" | "title" | "titleIcon" | "breadcrumbs" | "actions" | "filterPlaceholder" | "onBack" | "onBreadcrumbSelect">): ReactElement {
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
          canDragFolders={canDragFolders}
          moving={movingEntryIds?.has(entry.path ?? entry.id) ?? false}
        />
      ))}
    </div>
  )
}

function FileRow({ entry, selected, onSelect, onOpen, onDragStart, onDrop, canDragFolders = false, moving = false }: {
  entry: FilePaneEntry
  selected: boolean
  onSelect(): void
  onOpen(): void
  onDragStart?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  onDrop?(entry: FilePaneEntry, event: DragEvent<HTMLDivElement>): void
  canDragFolders?: boolean
  moving?: boolean
}): ReactElement {
  const { t } = useI18n()
  const kindLabel = entry.kind === "folder"
    ? t("session.sftp.kind.folder")
    : entry.kind === "file"
      ? t("session.sftp.kind.file")
      : entry.kind === "symlink"
        ? t("session.sftp.kind.symlink")
        : entry.kind === "host"
          ? t("session.sftp.kind.host")
          : t("session.sftp.kind.other")
  const isFolder = entry.kind === "folder" || entry.kind === "host"
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
        if (moving || event.key !== "Enter") return
        event.preventDefault()
        onOpen()
      }}
    >
      <span className="sftp-file-name" role="cell">{isFolder ? <Folder aria-hidden="true" size={16} /> : <File aria-hidden="true" size={16} />}<span>{entry.name}</span></span>
      <span className="sftp-file-meta" role="cell">{formatModifiedAt(entry.modifiedAt)}</span>
      <span className="sftp-file-meta" role="cell">{isFolder ? "-" : formatFileSize(entry.size)}</span>
      <span className="sftp-file-meta" role="cell">{kindLabel}</span>
    </div>
  )
}

function SftpTransferFooter({ transfers, bridge }: {
  transfers: readonly SftpTransferTask[]
  bridge: RockerBridge
}): ReactElement | null {
  const { t } = useI18n()
  if (transfers.length === 0) return null
  const orderedTransfers = [...transfers].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const primaryTask = orderedTransfers[0]
  const statusLabel = primaryTask.status === "queued" ? t("session.sftp.transferStatus.queued") : t("session.sftp.transferStatus.moving")
  const taskSummary = orderedTransfers.length === 1 ? primaryTask.name : `${primaryTask.name} +${orderedTransfers.length - 1}`
  const progress = primaryTask.totalBytes && primaryTask.totalBytes > 0 ? Math.min(100, Math.round(primaryTask.bytesTransferred / primaryTask.totalBytes * 100)) : undefined
  return (
    <footer className="sftp-transfer-footer" aria-label={t("session.sftp.transfers")}>
      <div className="sftp-transfer-task" data-direction="move" data-status={primaryTask.status}>
        <span className="sftp-transfer-task-name" title={primaryTask.sourcePath ? `${primaryTask.sourcePath} -> ${primaryTask.remotePath}` : primaryTask.name}>
          <ArrowRightLeft aria-hidden="true" size={15} />
          <strong>{t("session.sftp.move")}</strong>
          <span>{taskSummary}</span>
          {primaryTask.sourcePath ? <code>{primaryTask.sourcePath} -&gt; {primaryTask.remotePath}</code> : null}
        </span>
        <span className="sftp-transfer-progress-track" role="progressbar" aria-label={`${primaryTask.name} ${statusLabel}`} aria-valuemin={0} aria-valuemax={100} {...(progress === undefined ? {} : { "aria-valuenow": progress })}>
          <span className={progress === undefined ? "is-indeterminate" : undefined} style={progress === undefined ? undefined : { width: `${progress}%` }} />
        </span>
        <span className="sftp-transfer-task-status">{orderedTransfers.length > 1 ? `${orderedTransfers.length} ${t("session.sftp.active")}` : progress === undefined ? statusLabel : `${progress}%`}</span>
        <button aria-label={t("session.sftp.cancelTransfer")} className="sftp-transfer-task-action" title={t("session.sftp.cancelTransfer")} type="button" onClick={() => { for (const task of transfers) void bridge.sftp.cancelTransfer(task.id) }}>
          <Square aria-hidden="true" size={13} />
        </button>
      </div>
    </footer>
  )
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
  const breadcrumbs: PaneBreadcrumbItem[] = [{ id: "/", label: "/" }]
  let current = ""
  for (const part of parts) {
    current += `/${part}`
    breadcrumbs.push({ id: current, label: part })
  }
  return breadcrumbs
}

function localPathBreadcrumbs(path: string): PaneBreadcrumbItem[] {
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

function isLocalRoot(path: string): boolean {
  return path === "/" || /^[A-Za-z]:[\\/]?$/.test(path)
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

function formatModifiedAt(value: string | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })
}

function formatFileSize(size: number | undefined): string {
  if (size === undefined) return "-"
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${Math.round(size / 1_024)} KB`
  if (size < 1_024 * 1_024 * 1_024) return `${(size / (1_024 * 1_024)).toFixed(1)} MB`
  return `${(size / (1_024 * 1_024 * 1_024)).toFixed(1)} GB`
}
