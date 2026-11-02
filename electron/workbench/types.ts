export type WorkbenchSource = "local" | "remote" | "cloud"
export interface WorkbenchProfile {
  id: string
  name: string
  source: WorkbenchSource
  hostId?: string
  cwd: string
  executable: string
}
export interface WorkbenchItem {
  id: string
  role: "user" | "assistant" | "tool"
  text: string
}
export interface WorkbenchApproval {
  id: string
  method: string
  description: string
  questions?: Array<{ id: string; question: string; options: string[] }>
}
export interface WorkbenchSnapshot {
  id: string
  revision: number
  profile: WorkbenchProfile
  status: "connecting" | "ready" | "running" | "error" | "closed"
  threadId?: string
  turnId?: string
  error?: string
  items: WorkbenchItem[]
  approvals: WorkbenchApproval[]
  terminal: { open: boolean; output: string; error?: string }
}
export interface WorkbenchBridge {
  list(): Promise<WorkbenchProfile[]>
  save(profile: WorkbenchProfile): Promise<void>
  remove(id: string): Promise<void>
  chooseDirectory(): Promise<string | undefined>
  open(id: string, profileId: string): Promise<WorkbenchSnapshot>
  read(id: string): Promise<WorkbenchSnapshot>
  send(id: string, text: string): Promise<void>
  interrupt(id: string): Promise<void>
  approve(id: string, approvalId: string, accept: boolean): Promise<void>
  answer(id: string, approvalId: string, answers: Record<string, string>): Promise<void>
  reconnect(id: string): Promise<WorkbenchSnapshot>
  close(id: string, stop: boolean): Promise<void>
  terminal(id: string, action: "open" | "close" | "write" | "resize", data?: string, cols?: number, rows?: number): Promise<void>
  onEvent(listener: (snapshot: WorkbenchSnapshot) => void): () => void
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function text(value: unknown): string { return typeof value === "string" ? value : "" }
