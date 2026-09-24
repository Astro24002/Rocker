import { StrictMode, useCallback, useState, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { RockerBridge } from "../electron/ipc/bridge-contract"
import type { SftpDirectoryEntry, SftpRuntimeEvent, SftpTransferDirection, SftpTransferStartResult, SftpTransferTask } from "../electron/sftp/types"
import type { HostProfile } from "./app/types"
import { I18nProvider } from "./i18n"
import { SftpWorkspacePage } from "./features/sftp/SftpWorkspacePage"
import type { SftpWorkspaceSession, WorkspaceSessionPatch } from "./features/terminal/session-state"
import "./styles/base.css"
import "./styles/sftp-preview.css"

const host: HostProfile = {
  id: "preview-g11",
  name: "G11",
  host: "192.0.2.11",
  port: 22,
  username: "root",
  authMethod: "agent",
  favorite: false,
  notes: ""
}

const workspaceId = "sample-sftp-workspace"
const remoteHome = "/home/root"
const localDesktop = "/sample/Desktop"

interface SampleSelection {
  direction: "upload" | "download"
  name: string
  localPath: string
  remotePath: string
  size: number
}

function sampleTime(daysAgo: number, hour: number, minute: number): string {
  const value = new Date()
  value.setDate(value.getDate() - daysAgo)
  value.setHours(hour, minute, 0, 0)
  return value.toISOString()
}

function createSampleBridge(): RockerBridge {
  const localDirectories = new Map<string, SftpDirectoryEntry[]>([
    [localDesktop, [
      { name: "Projects", path: `${localDesktop}/Projects`, type: "directory", modifiedAt: sampleTime(0, 9, 42) },
      { name: "Screenshots", path: `${localDesktop}/Screenshots`, type: "directory", modifiedAt: sampleTime(1, 18, 6) },
      { name: "Release assets", path: `${localDesktop}/Release assets`, type: "directory", modifiedAt: sampleTime(0, 8, 15) },
      { name: ".env.example", path: `${localDesktop}/.env.example`, type: "file", size: 1229, modifiedAt: sampleTime(0, 9, 13) },
      { name: "release-notes.md", path: `${localDesktop}/release-notes.md`, type: "file", size: 8602, modifiedAt: sampleTime(0, 8, 58) },
      { name: "rocker-build.zip", path: `${localDesktop}/rocker-build.zip`, type: "file", size: 44_879_872, modifiedAt: sampleTime(2, 16, 22) }
    ]],
    [`${localDesktop}/Projects`, [
      { name: "Rocker", path: `${localDesktop}/Projects/Rocker`, type: "directory", modifiedAt: sampleTime(0, 9, 42) },
      { name: "project-notes.md", path: `${localDesktop}/Projects/project-notes.md`, type: "file", size: 2150, modifiedAt: sampleTime(0, 9, 16) }
    ]],
    [`${localDesktop}/Projects/Rocker`, [
      { name: "README.md", path: `${localDesktop}/Projects/Rocker/README.md`, type: "file", size: 7987, modifiedAt: sampleTime(0, 9, 40) },
      { name: "electron-builder.yml", path: `${localDesktop}/Projects/Rocker/electron-builder.yml`, type: "file", size: 3686, modifiedAt: sampleTime(1, 18, 6) }
    ]],
    [`${localDesktop}/Screenshots`, [
      { name: "sftp-workspace.png", path: `${localDesktop}/Screenshots/sftp-workspace.png`, type: "file", size: 1_887_436, modifiedAt: sampleTime(1, 18, 6) },
      { name: "host-card.png", path: `${localDesktop}/Screenshots/host-card.png`, type: "file", size: 962_560, modifiedAt: sampleTime(1, 17, 44) }
    ]],
    [`${localDesktop}/Release assets`, [
      { name: "Rocker-0.7.0-rc.6.exe", path: `${localDesktop}/Release assets/Rocker-0.7.0-rc.6.exe`, type: "file", size: 90_318_643, modifiedAt: sampleTime(0, 8, 15) },
      { name: "release-source.zip", path: `${localDesktop}/Release assets/release-source.zip`, type: "file", size: 44_879_872, modifiedAt: sampleTime(0, 8, 12) }
    ]]
  ])
  const remoteDirectories = new Map<string, SftpDirectoryEntry[]>([
    [remoteHome, [
      { name: "app", path: `${remoteHome}/app`, type: "directory", modifiedAt: sampleTime(0, 9, 47) },
      { name: "config", path: `${remoteHome}/config`, type: "directory", modifiedAt: sampleTime(0, 9, 40) },
      { name: "logs", path: `${remoteHome}/logs`, type: "directory", modifiedAt: sampleTime(0, 9, 35) },
      { name: "docker-compose.yml", path: `${remoteHome}/docker-compose.yml`, type: "file", size: 3686, modifiedAt: sampleTime(0, 9, 12) },
      { name: "README.md", path: `${remoteHome}/README.md`, type: "file", size: 12_390, modifiedAt: sampleTime(1, 20, 18) },
      { name: "backup-2026-09-21.tar.gz", path: `${remoteHome}/backup-2026-09-21.tar.gz`, type: "file", size: 195_454_566, modifiedAt: sampleTime(2, 23, 4) }
    ]],
    [`${remoteHome}/app`, [
      { name: "current", path: `${remoteHome}/app/current`, type: "directory", modifiedAt: sampleTime(0, 9, 47) },
      { name: "releases", path: `${remoteHome}/app/releases`, type: "directory", modifiedAt: sampleTime(0, 9, 21) },
      { name: "package.json", path: `${remoteHome}/app/package.json`, type: "file", size: 1638, modifiedAt: sampleTime(0, 9, 18) }
    ]],
    [`${remoteHome}/app/current`, [
      { name: "index.html", path: `${remoteHome}/app/current/index.html`, type: "file", size: 4915, modifiedAt: sampleTime(0, 9, 47) },
      { name: "assets", path: `${remoteHome}/app/current/assets`, type: "directory", modifiedAt: sampleTime(0, 9, 45) }
    ]],
    [`${remoteHome}/app/current/assets`, [
      { name: "index-B4x9.js", path: `${remoteHome}/app/current/assets/index-B4x9.js`, type: "file", size: 292_864, modifiedAt: sampleTime(0, 9, 45) },
      { name: "index-C2m7.css", path: `${remoteHome}/app/current/assets/index-C2m7.css`, type: "file", size: 43_008, modifiedAt: sampleTime(0, 9, 45) }
    ]],
    [`${remoteHome}/app/releases`, [
      { name: "0.7.0-rc.5", path: `${remoteHome}/app/releases/0.7.0-rc.5`, type: "directory", modifiedAt: sampleTime(1, 23, 10) },
      { name: "0.7.0-rc.6", path: `${remoteHome}/app/releases/0.7.0-rc.6`, type: "directory", modifiedAt: sampleTime(0, 8, 30) }
    ]],
    [`${remoteHome}/config`, [
      { name: "nginx.conf", path: `${remoteHome}/config/nginx.conf`, type: "file", size: 2458, modifiedAt: sampleTime(0, 9, 40) },
      { name: "app.production.json", path: `${remoteHome}/config/app.production.json`, type: "file", size: 881, modifiedAt: sampleTime(0, 9, 31) }
    ]],
    [`${remoteHome}/logs`, [
      { name: "access.log", path: `${remoteHome}/logs/access.log`, type: "file", size: 19_188_326, modifiedAt: sampleTime(0, 9, 35) },
      { name: "error.log", path: `${remoteHome}/logs/error.log`, type: "file", size: 253_952, modifiedAt: sampleTime(0, 9, 34) }
    ]]
  ])
  const listeners = new Set<(event: SftpRuntimeEvent) => void>()
  const selections = new Map<string, SampleSelection>()
  const transfers = new Map<string, SftpTransferTask>()
  let nextId = 0

  const list = (directory: Map<string, SftpDirectoryEntry[]>, path: string): SftpDirectoryEntry[] =>
    (directory.get(path) ?? []).map((entry) => ({ ...entry }))
  const emit = (task: SftpTransferTask): void => {
    for (const listener of listeners) listener({ kind: "transfer", task: { ...task } })
  }
  const startTransfer = (selection: SampleSelection, workspace: string, direction: SftpTransferDirection): SftpTransferStartResult => {
    const now = new Date().toISOString()
    const task: SftpTransferTask = {
      id: `sample-transfer-${++nextId}`,
      workspaceId: workspace,
      hostId: host.id,
      direction,
      name: selection.name,
      remotePath: selection.remotePath,
      ...(direction === "move" || direction === "upload" ? { sourcePath: selection.localPath } : {}),
      entryType: "file",
      status: "running",
      bytesTransferred: 0,
      totalBytes: selection.size,
      attempt: 1,
      createdAt: now,
      updatedAt: now
    }
    transfers.set(task.id, task)
    emit(task)
    window.setTimeout(() => {
      const current = transfers.get(task.id)
      if (!current || current.status !== "running") return
      const partial = { ...current, bytesTransferred: Math.floor(selection.size / 2), updatedAt: new Date().toISOString() }
      transfers.set(task.id, partial)
      emit(partial)
    }, 380)
    window.setTimeout(() => {
      const current = transfers.get(task.id)
      if (!current || current.status !== "running") return
      const completed = { ...current, status: "completed" as const, bytesTransferred: selection.size, updatedAt: new Date().toISOString() }
      transfers.set(task.id, completed)
      if (direction === "upload") {
        const item: SftpDirectoryEntry = { name: selection.name, path: selection.remotePath, type: "file", size: selection.size, modifiedAt: completed.updatedAt }
        const parent = selection.remotePath.slice(0, selection.remotePath.lastIndexOf("/")) || "/"
        remoteDirectories.set(parent, [...(remoteDirectories.get(parent) ?? []).filter((entry) => entry.path !== item.path), item])
      }
      emit(completed)
    }, 920)
    return { kind: "started", task: { ...task } }
  }

  const bridge = {
    sftp: {
      async listLocal(path?: string) {
        const directoryPath = path ?? localDesktop
        return { path: directoryPath, entries: list(localDirectories, directoryPath) }
      },
      async open(workspace: string, hostId: string) {
        return { workspaceId: workspace, hostId, connectionId: "sample-sftp-connection", state: "ready" as const }
      },
      async close() {},
      async list(workspace: string, path: string) {
        const directoryPath = path === "." ? remoteHome : path
        return { workspaceId: workspace, path: directoryPath, entries: list(remoteDirectories, directoryPath) }
      },
      async mkdir(_workspace: string, path: string) {
        const parent = path.slice(0, path.lastIndexOf("/")) || "/"
        const name = path.slice(path.lastIndexOf("/") + 1)
        const entry: SftpDirectoryEntry = { name, path, type: "directory", modifiedAt: new Date().toISOString() }
        remoteDirectories.set(parent, [...(remoteDirectories.get(parent) ?? []), entry])
        remoteDirectories.set(path, [])
      },
      async rename(_workspace: string, path: string, nextPath: string) {
        const parent = path.slice(0, path.lastIndexOf("/")) || "/"
        const entry = remoteDirectories.get(parent)?.find((item) => item.path === path)
        if (!entry) return
        const nextName = nextPath.slice(nextPath.lastIndexOf("/") + 1)
        remoteDirectories.set(parent, (remoteDirectories.get(parent) ?? []).map((item) => item.path === path ? { ...item, name: nextName, path: nextPath, modifiedAt: new Date().toISOString() } : item))
        const contents = remoteDirectories.get(path)
        if (contents) {
          remoteDirectories.delete(path)
          remoteDirectories.set(nextPath, contents.map((item) => ({ ...item, path: `${nextPath}/${item.name}` })))
        }
      },
      async move(workspace: string, path: string, nextPath: string, kind: "file" | "directory") {
        const parent = path.slice(0, path.lastIndexOf("/")) || "/"
        const entry = remoteDirectories.get(parent)?.find((item) => item.path === path)
        return startTransfer({ direction: "upload", name: entry?.name ?? path.split("/").pop() ?? path, localPath: path, remotePath: nextPath, size: entry?.size ?? 0 }, workspace, "move")
      },
      async remove(_workspace: string, path: string) {
        const parent = path.slice(0, path.lastIndexOf("/")) || "/"
        remoteDirectories.set(parent, (remoteDirectories.get(parent) ?? []).filter((entry) => entry.path !== path))
        for (const key of remoteDirectories.keys()) if (key === path || key.startsWith(`${path}/`)) remoteDirectories.delete(key)
      },
      async chooseUpload(workspace: string, remoteDirectory: string, localPath?: string) {
        const sourcePath = localPath ?? localDirectories.get(localDesktop)?.find((entry) => entry.type === "file")?.path
        if (!sourcePath) return undefined
        const source = [...localDirectories.values()].flat().find((entry) => entry.path === sourcePath)
        if (!source) return undefined
        const selectionId = `sample-selection-${++nextId}`
        const selection = { direction: "upload" as const, name: source.name, localPath: sourcePath, remotePath: `${remoteDirectory.replace(/\/$/, "")}/${source.name}`, size: source.size ?? 0 }
        selections.set(selectionId, selection)
        return { selectionId, workspaceId: workspace, name: source.name, size: selection.size, remotePath: selection.remotePath }
      },
      async chooseDownload(workspace: string, remotePath: string, suggestedName: string) {
        const selectionId = `sample-selection-${++nextId}`
        const source = [...remoteDirectories.values()].flat().find((entry) => entry.path === remotePath)
        const selection = { direction: "download" as const, name: suggestedName, localPath: `${localDesktop}/${suggestedName}`, remotePath, size: source?.size ?? 0 }
        selections.set(selectionId, selection)
        return { selectionId, workspaceId: workspace, name: suggestedName, remotePath }
      },
      async upload(selectionId: string) {
        const selection = selections.get(selectionId)
        if (!selection) throw new Error("Sample upload selection was not found")
        return startTransfer(selection, workspaceId, "upload")
      },
      async download(selectionId: string) {
        const selection = selections.get(selectionId)
        if (!selection) throw new Error("Sample download selection was not found")
        return startTransfer(selection, workspaceId, "download")
      },
      async listTransfers(workspace?: string) {
        return [...transfers.values()].filter((task) => workspace === undefined || task.workspaceId === workspace).map((task) => ({ ...task }))
      },
      async cancelTransfer(taskId: string) {
        const task = transfers.get(taskId)
        if (!task) return
        const cancelled = { ...task, status: "cancelled" as const, updatedAt: new Date().toISOString() }
        transfers.set(taskId, cancelled)
        emit(cancelled)
      },
      async retryTransfer(taskId: string) {
        const task = transfers.get(taskId)
        if (!task) return undefined
        return startTransfer({ direction: task.direction === "download" ? "download" : "upload", name: task.name, localPath: task.sourcePath ?? `${localDesktop}/${task.name}`, remotePath: task.remotePath, size: task.totalBytes ?? 0 }, task.workspaceId, task.direction)
      }
    },
    events: {
      onSftpEvent(listener: (event: SftpRuntimeEvent) => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }

  return bridge as unknown as RockerBridge
}

function App(): ReactElement {
  const [bridge] = useState(createSampleBridge)
  const [session, setSession] = useState<SftpWorkspaceSession>({
    id: workspaceId,
    hostId: host.id,
    label: host.name,
    kind: "sftp" as const,
    state: "connected" as const,
    browser: { path: remoteHome, entries: [] as SftpDirectoryEntry[], loading: true }
  })
  const openHost = useCallback((selectedHost: HostProfile): void => {
    setSession((current) => ({ ...current, hostId: selectedHost.id, label: selectedHost.name }))
  }, [])
  const patchSession = useCallback((sessionId: string, patch: WorkspaceSessionPatch): void => {
    if (sessionId !== workspaceId || patch.kind !== "sftp") return
    setSession((current) => ({
      ...current,
      ...patch,
      browser: { ...current.browser, ...patch.browser }
    }))
  }, [])

  return (
    <I18nProvider>
      <main className="sftp-preview-root">
        <SftpWorkspacePage
          hosts={[host]}
          selectedSession={session}
          bridge={bridge}
          samplePreview
          onOpen={openHost}
          onPatch={patchSession}
        />
      </main>
    </I18nProvider>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("SFTP preview root is missing")
createRoot(root).render(<StrictMode><App /></StrictMode>)
