export interface RuntimeOwner {
  webContentsId: number
  rendererGeneration: number
}

export function sameRuntimeOwner(left: RuntimeOwner, right: RuntimeOwner): boolean {
  return left.webContentsId === right.webContentsId &&
    left.rendererGeneration === right.rendererGeneration
}

export function isRuntimeOwner(value: unknown): value is RuntimeOwner {
  if (!value || typeof value !== "object") return false
  const owner = value as Partial<RuntimeOwner>
  return Number.isSafeInteger(owner.webContentsId) && owner.webContentsId! > 0 &&
    Number.isSafeInteger(owner.rendererGeneration) && owner.rendererGeneration! >= 1
}

export function runtimeOwnerKey(owner: RuntimeOwner): string {
  return `${owner.webContentsId}:${owner.rendererGeneration}`
}
