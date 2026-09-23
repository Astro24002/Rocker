import type { RuntimeOwner } from "../runtime/owner"

export type SftpEntryType = "file" | "directory" | "symlink" | "other"

export interface SftpDirectoryEntry {
  name: string
  path: string
  type: SftpEntryType
  size?: number
  modifiedAt?: string
  permissions?: number
  uid?: number
  gid?: number
}

export interface SftpDirectory {
  path: string
  entries: SftpDirectoryEntry[]
}

export type SftpWorkspaceState = "ready" | "disconnected"

export interface SftpWorkspaceInfo {
  workspaceId: string
  hostId: string
  connectionId: string
  state: SftpWorkspaceState
}

export interface SftpUploadSelection {
  selectionId: string
  workspaceId: string
  name: string
  size: number
  remotePath: string
}

export interface SftpDownloadSelection {
  selectionId: string
  workspaceId: string
  name: string
  remotePath: string
}

export type SftpTransferDirection = "upload" | "download" | "move"
export type SftpTransferStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface SftpTransferTask {
  id: string
  workspaceId: string
  hostId: string
  direction: SftpTransferDirection
  name: string
  remotePath: string
  sourcePath?: string
  entryType?: "file" | "directory"
  status: SftpTransferStatus
  bytesTransferred: number
  totalBytes?: number
  attempt: number
  error?: string
  createdAt: string
  updatedAt: string
}

export type SftpTransferStartResult =
  | { kind: "started"; task: SftpTransferTask }
  | { kind: "overwrite-required"; selectionId: string; path: string }

export type SftpRuntimeEvent =
  | { kind: "workspace"; workspace: SftpWorkspaceInfo }
  | { kind: "transfer"; task: SftpTransferTask }

export interface OwnedSftpRuntimeEvent {
  owner: RuntimeOwner
  event: SftpRuntimeEvent
}
