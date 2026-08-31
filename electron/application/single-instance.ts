interface SingleInstanceTarget {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: "second-instance", listener: () => void): void
  whenReady(): Promise<void>
}

export function bootstrapPrimaryInstance(
  target: SingleInstanceTarget,
  callbacks: {
    start(): Promise<void> | void
    focusExisting(): void
    onStartError(error: unknown): void
  }
): boolean {
  if (!target.requestSingleInstanceLock()) {
    target.quit()
    return false
  }

  target.on("second-instance", callbacks.focusExisting)
  void target.whenReady().then(callbacks.start).catch(callbacks.onStartError)
  return true
}
