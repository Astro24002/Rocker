export type StorageKind =
  | "settings"
  | "history"
  | "workspace"
  | "hosts"
  | "credentials"
  | "hostKeys"

export type StorageFailureReason = "corrupt" | "permission" | "unavailable" | "recovery-failed"

export interface StorageIssue {
  store: StorageKind
  reason: StorageFailureReason
  message: string
}

export type LoadResult<T> =
  | { status: "ok"; value: T }
  | { status: "recovered"; value: T; source: "backup" }
  | { status: "defaulted"; value: T; reason: "missing" | "corrupt" }
  | { status: "blocked"; issue: StorageIssue }

export type StorageHealth =
  | { store: StorageKind; status: "ok" }
  | { store: StorageKind; status: "recovered"; source: "backup" }
  | { store: StorageKind; status: "defaulted"; reason: "missing" | "corrupt" }
  | { store: StorageKind; status: "blocked"; reason: StorageFailureReason; message: string }

export class StorageBlockedError extends Error {
  public constructor(public readonly issue: StorageIssue) {
    super(issue.message)
    this.name = "StorageBlockedError"
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
