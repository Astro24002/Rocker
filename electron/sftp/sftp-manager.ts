import { randomUUID } from "node:crypto"
import { stat as statLocal } from "node:fs/promises"
import { basename, posix } from "node:path"
import type { Client, FileEntryWithStats, SFTPWrapper } from "ssh2"
import { sameRuntimeOwner, type RuntimeOwner } from "../runtime/owner"
import type {
  ConnectionAcquireRequest,
  ConnectionEvent,
  ConnectionLease
} from "../ssh/connection-manager"
import type {
  OwnedSftpRuntimeEvent,
  SftpDirectory,
  SftpDirectoryEntry,
  SftpDownloadSelection,
  SftpRuntimeEvent,
  SftpTransferDirection,
  SftpTransferStartResult,
  SftpTransferTask,
  SftpUploadSelection,
  SftpWorkspaceInfo,
  SftpWorkspaceState
} from "./types"

export interface SftpConnectionAccess {
  acquire(request: ConnectionAcquireRequest): Promise<ConnectionLease>
  release(leaseId: string): Promise<void>
  getClientForConnection(connectionId: string): Client
  onEvent(listener: (event: ConnectionEvent) => void): () => void
}

export interface SftpResourceSnapshot {
  workspaces: number
  selections: number
  transfers: number
  activeTransfers: number
}

interface SftpWorkspaceRecord {
  info: SftpWorkspaceInfo
  owner: RuntimeOwner
  lease: ConnectionLease
}

interface SftpSelectionRecord {
  selectionId: string
  workspaceId: string
  owner: RuntimeOwner
  direction: SftpTransferDirection
  localPath: string
  remotePath: string
  name: string
  size?: number
}

interface SftpTransferRecord {
  task: SftpTransferTask
  owner: RuntimeOwner
  localPath: string
  controller: AbortController
  lease?: ConnectionLease
  channel?: SFTPWrapper
  runPromise?: Promise<void>
}

const MAX_REMOTE_PATH_BYTES = 4_096
const MAX_LOCAL_PATH_BYTES = 4_096

export class SftpManager {
  private readonly workspaces = new Map<string, SftpWorkspaceRecord>()
  private readonly opening = new Map<string, { hostId: string; owner: RuntimeOwner; promise: Promise<SftpWorkspaceInfo> }>()
  private readonly closing = new Set<string>()
  private readonly selections = new Map<string, SftpSelectionRecord>()
  private readonly transfers = new Map<string, SftpTransferRecord>()
  private readonly listeners = new Set<(event: OwnedSftpRuntimeEvent) => void>()
  private readonly unsubscribeConnectionEvents: () => void

  public constructor(private readonly connections: SftpConnectionAccess) {
    this.unsubscribeConnectionEvents = connections.onEvent((event) => this.handleConnectionEvent(event))
  }

  public onEvent(listener: (event: OwnedSftpRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public resourceSnapshot(): SftpResourceSnapshot {
    return {
      workspaces: this.workspaces.size,
      selections: this.selections.size,
      transfers: this.transfers.size,
      activeTransfers: [...this.transfers.values()].filter((record) => record.task.status === "running").length
    }
  }

  public activeTransferCount(): number {
    return [...this.transfers.values()].filter((record) => record.task.status === "queued" || record.task.status === "running").length
  }

  public async open(workspaceId: string, hostId: string, owner: RuntimeOwner): Promise<SftpWorkspaceInfo> {
    const existing = this.workspaces.get(workspaceId)
    if (existing) {
      this.assertWorkspaceOwner(existing, owner)
      if (existing.info.hostId !== hostId) throw new Error("SFTP workspace is bound to another host")
      return { ...existing.info }
    }
    const pending = this.opening.get(workspaceId)
    if (pending) {
      if (pending.hostId !== hostId || !sameRuntimeOwner(pending.owner, owner)) {
        throw new Error("SFTP workspace is owned by another window")
      }
      return pending.promise
    }
    const promise = this.openWorkspace(workspaceId, hostId, owner)
    this.opening.set(workspaceId, { hostId, owner, promise })
    try {
      return await promise
    } finally {
      this.opening.delete(workspaceId)
    }
  }

  public async close(workspaceId: string, owner: RuntimeOwner): Promise<void> {
    const record = this.workspaces.get(workspaceId)
    if (record) {
      this.assertWorkspaceOwner(record, owner)
    } else {
      const pending = this.opening.get(workspaceId)
      if (!pending) return
      if (!sameRuntimeOwner(pending.owner, owner)) throw new Error("SFTP workspace is owned by another window")
      this.closing.add(workspaceId)
      try {
        await pending.promise
      } catch {
        // The pending open already released its lease or failed.
      }
    }
    try {
      const opened = this.workspaces.get(workspaceId)
      if (!opened) return
      this.assertWorkspaceOwner(opened, owner)
      this.workspaces.delete(workspaceId)
      this.clearSelections(workspaceId, owner)
      await this.connections.release(opened.lease.id)
    } finally {
      this.closing.delete(workspaceId)
    }
  }

  public async releaseOwner(owner: RuntimeOwner): Promise<void> {
    await this.releaseWhere((candidate) => sameRuntimeOwner(candidate, owner))
  }

  public async releaseWebContents(webContentsId: number): Promise<void> {
    await this.releaseWhere((candidate) => candidate.webContentsId === webContentsId)
  }

  public async list(workspaceId: string, path: string, owner: RuntimeOwner): Promise<SftpDirectory> {
    const record = this.requireWorkspace(workspaceId, owner)
    const normalizedPath = normalizeRemotePath(path)
    return this.withSftp(record, (sftp) => new Promise<SftpDirectory>((resolve, reject) => {
      sftp.readdir(normalizedPath, (error, entries) => {
        if (error) {
          reject(error)
          return
        }
        resolve({
          path: normalizedPath,
          entries: entries.map((entry) => toDirectoryEntry(normalizedPath, entry))
        })
      })
    }))
  }

  public async mkdir(workspaceId: string, path: string, owner: RuntimeOwner): Promise<void> {
    const record = this.requireWorkspace(workspaceId, owner)
    const normalizedPath = normalizeRemotePath(path)
    if (normalizedPath === "/") throw new Error("Cannot create the root directory")
    await this.withSftp(record, (sftp) => new Promise<void>((resolve, reject) => {
      sftp.mkdir(normalizedPath, { mode: 0o755 }, (error) => error ? reject(error) : resolve())
    }))
  }

  public async rename(workspaceId: string, path: string, nextPath: string, owner: RuntimeOwner): Promise<void> {
    const record = this.requireWorkspace(workspaceId, owner)
    const normalizedPath = normalizeRemotePath(path)
    const normalizedNextPath = normalizeRemotePath(nextPath)
    if (normalizedPath === "/" || normalizedNextPath === "/") throw new Error("Cannot rename the root directory")
    if (normalizedPath === normalizedNextPath) throw new Error("The new name must be different")
    if (await this.remotePathExists(record, normalizedNextPath)) throw new Error("Remote destination already exists")
    await this.withSftp(record, (sftp) => new Promise<void>((resolve, reject) => {
      sftp.rename(normalizedPath, normalizedNextPath, (error) => error ? reject(error) : resolve())
    }))
  }

  public async remove(workspaceId: string, path: string, kind: "file" | "directory", owner: RuntimeOwner): Promise<void> {
    const record = this.requireWorkspace(workspaceId, owner)
    const normalizedPath = normalizeRemotePath(path)
    if (normalizedPath === "/") throw new Error("Cannot remove the root directory")
    await this.withSftp(record, (sftp) => new Promise<void>((resolve, reject) => {
      if (kind === "directory") {
        sftp.rmdir(normalizedPath, (error) => error ? reject(error) : resolve())
      } else {
        sftp.unlink(normalizedPath, (error) => error ? reject(error) : resolve())
      }
    }))
  }

  public async selectUpload(
    workspaceId: string,
    remoteDirectory: string,
    localPath: string,
    owner: RuntimeOwner
  ): Promise<SftpUploadSelection> {
    this.requireWorkspace(workspaceId, owner)
    const normalizedLocalPath = normalizeLocalPath(localPath)
    const local = await statLocal(normalizedLocalPath)
    if (!local.isFile()) throw new Error("The selected upload source is not a file")
    const name = basename(normalizedLocalPath)
    const remotePath = posix.join(normalizeRemotePath(remoteDirectory), name)
    const selectionId = randomUUID()
    this.selections.set(selectionId, {
      selectionId,
      workspaceId,
      owner,
      direction: "upload",
      localPath: normalizedLocalPath,
      remotePath,
      name,
      size: local.size
    })
    return { selectionId, workspaceId, name, size: local.size, remotePath }
  }

  public async selectDownload(
    workspaceId: string,
    remotePath: string,
    localPath: string,
    owner: RuntimeOwner
  ): Promise<SftpDownloadSelection> {
    const record = this.requireWorkspace(workspaceId, owner)
    const normalizedRemotePath = normalizeRemotePath(remotePath)
    const normalizedLocalPath = normalizeLocalPath(localPath)
    await this.withSftp(record, (sftp) => new Promise<void>((resolve, reject) => {
      sftp.stat(normalizedRemotePath, (error, stats) => {
        if (error) {
          reject(error)
          return
        }
        if (!stats.isFile()) reject(new Error("Only files can be downloaded"))
        else resolve()
      })
    }))
    const selectionId = randomUUID()
    const name = basename(normalizedRemotePath)
    this.selections.set(selectionId, {
      selectionId,
      workspaceId,
      owner,
      direction: "download",
      localPath: normalizedLocalPath,
      remotePath: normalizedRemotePath,
      name
    })
    return { selectionId, workspaceId, name, remotePath: normalizedRemotePath }
  }

  public async upload(selectionId: string, overwrite: boolean, owner: RuntimeOwner): Promise<SftpTransferStartResult> {
    const selection = this.requireSelection(selectionId, owner, "upload")
    const workspace = this.requireWorkspace(selection.workspaceId, owner)
    if (!overwrite && await this.remotePathExists(workspace, selection.remotePath)) {
      return { kind: "overwrite-required", selectionId, path: selection.remotePath }
    }
    this.selections.delete(selectionId)
    return this.enqueueTransfer(selection, workspace.info.hostId, owner)
  }

  public async download(selectionId: string, overwrite: boolean, owner: RuntimeOwner): Promise<SftpTransferStartResult> {
    const selection = this.requireSelection(selectionId, owner, "download")
    const workspace = this.requireWorkspace(selection.workspaceId, owner)
    if (!overwrite && await localPathExists(selection.localPath)) {
      return { kind: "overwrite-required", selectionId, path: selection.localPath }
    }
    this.selections.delete(selectionId)
    return this.enqueueTransfer(selection, workspace.info.hostId, owner)
  }

  public listTransfers(owner: RuntimeOwner, workspaceId?: string): SftpTransferTask[] {
    return [...this.transfers.values()]
      .filter((record) => sameRuntimeOwner(record.owner, owner) && (workspaceId === undefined || record.task.workspaceId === workspaceId))
      .map((record) => ({ ...record.task }))
  }

  public async cancelTransfer(taskId: string, owner: RuntimeOwner): Promise<void> {
    const record = this.requireTransfer(taskId, owner)
    if (record.task.status === "completed" || record.task.status === "failed" || record.task.status === "cancelled") return
    record.controller.abort()
    record.channel?.end()
    this.updateTask(record, { status: "cancelled", error: undefined })
    if (record.runPromise) await record.runPromise
  }

  public async retryTransfer(taskId: string, owner: RuntimeOwner): Promise<SftpTransferStartResult> {
    const record = this.requireTransfer(taskId, owner)
    if (record.task.status !== "failed" && record.task.status !== "cancelled") {
      throw new Error("Only failed or cancelled transfers can be retried")
    }
    record.controller = new AbortController()
    this.updateTask(record, {
      status: "queued",
      bytesTransferred: 0,
      error: undefined,
      attempt: record.task.attempt + 1
    })
    record.runPromise = this.runTransfer(record)
    return { kind: "started", task: { ...record.task } }
  }

  private async openWorkspace(workspaceId: string, hostId: string, owner: RuntimeOwner): Promise<SftpWorkspaceInfo> {
    const lease = await this.connections.acquire({ hostId, owner, kind: "sftp" })
    if (this.closing.has(workspaceId)) {
      this.closing.delete(workspaceId)
      await this.connections.release(lease.id)
      throw new Error("SFTP workspace was closed")
    }
    const info: SftpWorkspaceInfo = { workspaceId, hostId, connectionId: lease.connectionId, state: "ready" }
    const record: SftpWorkspaceRecord = { info, owner, lease }
    this.workspaces.set(workspaceId, record)
    this.emit(owner, { kind: "workspace", workspace: { ...info } })
    return { ...info }
  }

  private async releaseWhere(predicate: (owner: RuntimeOwner) => boolean): Promise<void> {
    const transfers = [...this.transfers.values()].filter((record) => predicate(record.owner))
    for (const record of transfers) {
      if (record.task.status === "queued" || record.task.status === "running") {
        record.controller.abort()
        record.channel?.end()
        this.updateTask(record, { status: "cancelled", error: undefined })
      }
    }
    await Promise.all(transfers.map((record) => record.runPromise ?? Promise.resolve()))
    const workspaces = [...this.workspaces.values()].filter((record) => predicate(record.owner))
    await Promise.all(workspaces.map(async (record) => {
      this.workspaces.delete(record.info.workspaceId)
      this.clearSelections(record.info.workspaceId, record.owner)
      await this.connections.release(record.lease.id)
    }))
    for (const [workspaceId, pending] of this.opening) {
      if (!predicate(pending.owner)) continue
      this.closing.add(workspaceId)
      try {
        await pending.promise
      } catch {
        // The pending open is expected to fail after its owner is released.
      }
    }
  }

  private requireWorkspace(workspaceId: string, owner: RuntimeOwner): SftpWorkspaceRecord {
    const record = this.workspaces.get(workspaceId)
    if (!record) throw new Error("SFTP workspace was not opened")
    this.assertWorkspaceOwner(record, owner)
    return record
  }

  private assertWorkspaceOwner(record: SftpWorkspaceRecord, owner: RuntimeOwner): void {
    if (!sameRuntimeOwner(record.owner, owner)) {
      throw new Error(record.owner.webContentsId === owner.webContentsId
        ? "SFTP workspace is owned by another renderer generation"
        : "SFTP workspace is owned by another window")
    }
  }

  private requireSelection(selectionId: string, owner: RuntimeOwner, direction: SftpTransferDirection): SftpSelectionRecord {
    const selection = this.selections.get(selectionId)
    if (!selection || selection.direction !== direction) throw new Error("SFTP selection was not found")
    if (!sameRuntimeOwner(selection.owner, owner)) throw new Error("SFTP selection is owned by another window")
    return selection
  }

  private requireTransfer(taskId: string, owner: RuntimeOwner): SftpTransferRecord {
    const record = this.transfers.get(taskId)
    if (!record) throw new Error("SFTP transfer was not found")
    if (!sameRuntimeOwner(record.owner, owner)) throw new Error("SFTP transfer is owned by another window")
    return record
  }

  private clearSelections(workspaceId: string, owner: RuntimeOwner): void {
    for (const [selectionId, selection] of this.selections) {
      if (selection.workspaceId === workspaceId && sameRuntimeOwner(selection.owner, owner)) this.selections.delete(selectionId)
    }
  }

  private enqueueTransfer(selection: SftpSelectionRecord, hostId: string, owner: RuntimeOwner): SftpTransferStartResult {
    const now = new Date().toISOString()
    const task: SftpTransferTask = {
      id: randomUUID(),
      workspaceId: selection.workspaceId,
      hostId,
      direction: selection.direction,
      name: selection.name,
      remotePath: selection.remotePath,
      status: "queued",
      bytesTransferred: 0,
      ...(selection.size === undefined ? {} : { totalBytes: selection.size }),
      attempt: 1,
      createdAt: now,
      updatedAt: now
    }
    const record: SftpTransferRecord = {
      task,
      owner,
      localPath: selection.localPath,
      controller: new AbortController()
    }
    this.transfers.set(task.id, record)
    this.emit(owner, { kind: "transfer", task: { ...task } })
    record.runPromise = this.runTransfer(record)
    return { kind: "started", task: { ...task } }
  }

  private async runTransfer(record: SftpTransferRecord): Promise<void> {
    if (record.controller.signal.aborted || record.task.status === "cancelled") return
    this.updateTask(record, { status: "running", error: undefined })
    try {
      const lease = await this.connections.acquire({ hostId: record.task.hostId, owner: record.owner, kind: "sftp" })
      record.lease = lease
      if (record.controller.signal.aborted) return
      await this.withSftpLease(lease, async (sftp) => {
        record.channel = sftp
        if (record.task.direction === "download") {
          const totalBytes = await this.remoteFileSize(sftp, record.task.remotePath)
          this.updateTask(record, { totalBytes })
        } else if (record.task.totalBytes === undefined) {
          const local = await statLocal(record.localPath)
          this.updateTask(record, { totalBytes: local.size })
        }
        await runFastTransfer(sftp, record, (bytesTransferred, totalBytes) => {
          this.updateTask(record, { bytesTransferred, ...(totalBytes > 0 ? { totalBytes } : {}) })
        })
      })
      if (!record.controller.signal.aborted && !isTransferCancelled(record)) {
        this.updateTask(record, { status: "completed", error: undefined })
      }
    } catch (error) {
      if (!record.controller.signal.aborted && !isTransferCancelled(record)) {
        this.updateTask(record, { status: "failed", error: errorMessage(error) })
      }
    } finally {
      record.channel = undefined
      if (record.lease) {
        await this.connections.release(record.lease.id)
        record.lease = undefined
      }
    }
  }

  private async remoteFileSize(sftp: SFTPWrapper, path: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      sftp.stat(path, (error, stats) => {
        if (error) {
          reject(error)
          return
        }
        if (!stats.isFile()) reject(new Error("Only files can be downloaded"))
        else resolve(stats.size)
      })
    })
  }

  private async withSftp<T>(record: SftpWorkspaceRecord, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    return this.withSftpLease(record.lease, operation)
  }

  private async withSftpLease<T>(lease: ConnectionLease, operation: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const client = this.connections.getClientForConnection(lease.connectionId)
    const sftp = await openSftp(client)
    try {
      return await operation(sftp)
    } finally {
      sftp.end()
    }
  }

  private async remotePathExists(record: SftpWorkspaceRecord, path: string): Promise<boolean> {
    try {
      await this.withSftp(record, (sftp) => new Promise<void>((resolve, reject) => {
        sftp.stat(path, (error) => error ? reject(error) : resolve())
      }))
      return true
    } catch (error) {
      if (isMissingRemote(error)) return false
      throw error
    }
  }

  private updateTask(record: SftpTransferRecord, patch: Partial<SftpTransferTask>): void {
    record.task = {
      ...record.task,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.emit(record.owner, { kind: "transfer", task: { ...record.task } })
  }

  private handleConnectionEvent(event: ConnectionEvent): void {
    let nextState: SftpWorkspaceState | undefined
    if (event.kind === "ready") nextState = "ready"
    if (event.kind === "lost" || event.kind === "retrying" || event.kind === "failed") nextState = "disconnected"
    if (!nextState) return
    for (const record of this.workspaces.values()) {
      if (record.lease.connectionId !== event.connectionId || !sameRuntimeOwner(record.owner, event.owner)) continue
      if (record.info.state === nextState) continue
      record.info = { ...record.info, state: nextState }
      this.emit(record.owner, { kind: "workspace", workspace: { ...record.info } })
    }
  }

  private emit(owner: RuntimeOwner, event: SftpRuntimeEvent): void {
    const payload: OwnedSftpRuntimeEvent = { owner, event }
    for (const listener of this.listeners) listener(payload)
  }
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(error)
      else resolve(sftp)
    })
  })
}

function runFastTransfer(
  sftp: SFTPWrapper,
  record: SftpTransferRecord,
  onProgress: (bytesTransferred: number, totalBytes: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const step = (total: number, _chunk: number, fileSize: number): void => onProgress(total, fileSize)
    const done = (error?: Error | null): void => error ? reject(error) : resolve()
    if (record.task.direction === "upload") {
      sftp.fastPut(record.localPath, record.task.remotePath, { step }, done)
    } else {
      sftp.fastGet(record.task.remotePath, record.localPath, { step }, done)
    }
  })
}

function toDirectoryEntry(parentPath: string, entry: FileEntryWithStats): SftpDirectoryEntry {
  const stats = entry.attrs
  const type = stats.isDirectory() ? "directory" : stats.isFile() ? "file" : stats.isSymbolicLink() ? "symlink" : "other"
  return {
    name: entry.filename,
    path: posix.join(parentPath, entry.filename),
    type,
    ...(Number.isFinite(stats.size) ? { size: stats.size } : {}),
    ...(Number.isFinite(stats.mtime) ? { modifiedAt: new Date(stats.mtime * 1_000).toISOString() } : {}),
    ...(Number.isFinite(stats.mode) ? { permissions: stats.mode } : {}),
    ...(Number.isFinite(stats.uid) ? { uid: stats.uid } : {}),
    ...(Number.isFinite(stats.gid) ? { gid: stats.gid } : {})
  }
}

export function normalizeRemotePath(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_REMOTE_PATH_BYTES || value.includes("\u0000")) throw new Error("Invalid remote path")
  const candidate = value.trim() || "/"
  if (candidate.split("/").some((segment) => segment === "..")) throw new Error("Remote path traversal is not allowed")
  return posix.resolve("/", candidate)
}

function normalizeLocalPath(value: string): string {
  if (Buffer.byteLength(value, "utf8") > MAX_LOCAL_PATH_BYTES || value.includes("\u0000") || value.trim().length === 0) {
    throw new Error("Invalid local path")
  }
  return value
}

async function localPathExists(path: string): Promise<boolean> {
  try {
    await statLocal(path)
    return true
  } catch (error) {
    if (isMissingLocal(error)) return false
    throw error
  }
}

function isMissingLocal(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}

function isMissingRemote(error: unknown): boolean {
  if (isRecord(error) && error.code === 2) return true
  return error instanceof Error && /no such file|not found/i.test(error.message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "SFTP transfer failed"
}

function isTransferCancelled(record: SftpTransferRecord): boolean {
  return record.task.status === "cancelled"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
