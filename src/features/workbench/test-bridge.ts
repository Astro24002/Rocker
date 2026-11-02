import { vi } from "vitest"
import type { WorkbenchBridge, WorkbenchProfile, WorkbenchSnapshot } from "../../../electron/workbench/types"

export const testProfile: WorkbenchProfile = { id: "project", name: "Rocker project", source: "local", cwd: "/work/rocker", executable: "codex" }
export function createWorkbenchTestBridge() {
  const listeners = new Set<(snapshot: WorkbenchSnapshot) => void>()
  const snapshots = new Map<string, WorkbenchSnapshot>()
  const bridge = {
    list: vi.fn(async () => [testProfile]), save: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
    chooseDirectory: vi.fn(async () => "/chosen/project"),
    open: vi.fn(async (id: string, _profileId: string) => {
      if (!snapshots.has(id)) snapshots.set(id, { id, revision: 1, profile: testProfile, status: "ready", threadId: `thread-${id}`, items: [], approvals: [], terminal: { open: false, output: "" } })
      return snapshots.get(id)!
    }),
    read: vi.fn(async (id: string) => { const s = snapshots.get(id); if (!s) throw new Error("missing"); return s }),
    send: vi.fn(async (_id: string, _text: string) => undefined), interrupt: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined), answer: vi.fn(async () => undefined),
    reconnect: vi.fn(async (id: string) => snapshots.get(id)!), close: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined),
    onEvent: vi.fn((listener: (s: WorkbenchSnapshot) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } })
  } satisfies WorkbenchBridge
  return { bridge, emit(snapshot: WorkbenchSnapshot) { snapshots.set(snapshot.id, snapshot); for (const listener of listeners) listener(snapshot) } }
}
