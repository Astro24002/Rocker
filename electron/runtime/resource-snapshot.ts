export interface ConnectionResourceSnapshot {
  connections: number
  leases: number
  readyWaiters: number
  retryTimers: number
  connectingTransports: number
}

export interface TerminalResourceSnapshot {
  sessions: number
  channels: number
  outputPumps: number
  activeAttempts: number
  recoveryWaiters: number
  queuedShells: number
}

export interface ForwardingResourceSnapshot {
  forwards: number
  listeners: number
  activationTasks: number
}

export interface RuntimeResourceSnapshot {
  connection: ConnectionResourceSnapshot
  terminal: TerminalResourceSnapshot
  forwarding: ForwardingResourceSnapshot
}

export function runtimeResourcesAtBaseline(snapshot: RuntimeResourceSnapshot): boolean {
  return Object.values(snapshot.connection).every((value) => value === 0) &&
    Object.values(snapshot.terminal).every((value) => value === 0) &&
    Object.values(snapshot.forwarding).every((value) => value === 0)
}
