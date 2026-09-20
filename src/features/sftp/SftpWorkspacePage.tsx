import {
  ArrowLeft,
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

  const remotePath = selectedSession?.browser.path ?? "/"
  const selectedRemoteEntry = selectedSession?.browser.entries.find((entry) => entry.path === selectedRemoteId)
  const selectedLocalEntry = [...localDirectory.entries, ...localFiles.map((file) => ({ name: file.name, path: file.path ?? file.name, type: "file" as const, size: file.size, modifiedAt: file.modifiedAt }))]
    .find((entry) => entry.path === selectedLocalId)

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
    if (!selectedSession) return
    return bridge.events.onSftpEvent((event) => {
      if (event.kind !== "workspace" || event.workspace.workspaceId !== selectedSession.id) return
      onPatch(selectedSession.id, { kind: "sftp", state: event.workspace.state === "ready" ? "connected" : "disconnected" })
    })
  }, [bridge, onPatch, selectedSession?.id])

  useEffect(() => {
    setSelectedRemoteId(undefined)
  }, [remotePath, selectedSession?.id])

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

  const uploadLocalFile = async (file: { path?: string } | undefined): Promise<void> => {
    if (!selectedSession || !file?.path) return
    try {
      const selection = await bridge.sftp.chooseUpload(selectedSession.id, remotePath, file.path)
      if (!selection) return
      let result = await bridge.sftp.upload(selection.selectionId)
      if (result.kind === "overwrite-required") {
        if (!window.confirm(t("session.sftp.overwritePrompt"))) return
        result = await bridge.sftp.upload(selection.selectionId, true)
      }
      if (result.kind === "started") setLocalError(undefined)
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

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDropActive(false)
    const paths = Array.from(event.dataTransfer.files)
      .map(localFilePath)
      .filter((value): value is string => value !== undefined)
    if (!selectedSession || paths.length === 0) {
      setActionError(t("session.sftp.dropUnsupported"))
      return
    }
    void (async (): Promise<void> => {
      for (const path of paths) {
        const selection = await bridge.sftp.chooseUpload(selectedSession.id, remotePath, path)
        if (selection) await bridge.sftp.upload(selection.selectionId)
      }
    })().catch((reason: unknown) => setActionError(reason instanceof Error ? reason.message : String(reason)))
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
    <section className="sftp-workspace-page" aria-label={t("session.sftp.title")}>
      <input
        className="sftp-hidden-file-input"
        multiple
        onChange={(event) => selectLocalFiles(event.target.files)}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
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
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false) }}
        onDrop={handleDrop}
        dropActive={dropActive}
      />
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
        />
      ))}
    </div>
  )
}

function FileRow({ entry, selected, onSelect, onOpen }: { entry: FilePaneEntry; selected: boolean; onSelect(): void; onOpen(): void }): ReactElement {
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
  return (
    <div
      aria-selected={selected}
      className="sftp-file-row"
      data-kind={entry.kind}
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return
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
