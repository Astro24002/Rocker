import type { RockerBridge } from "../../electron/ipc/bridge-contract"
import type {
  AppBootstrapSnapshot,
  BootstrapHostProfile,
  BootstrapResourceName,
  HostKeyInventorySnapshot,
  HostKeyRemovalRequest,
  HostSaveProfile
} from "../../electron/ipc/bridge-contract"
import type { StorageHealth, StorageKind } from "../../electron/storage/storage-result"
import type { AppSettings, ForwardingInfo, HostCharset, HostEnvironment, HostProfile, HostThemeColor, StoredWorkspaceWindow } from "./types"
import type { ForwardingProfileRequest, ForwardingProfileView } from "../../electron/ports/types"
import type { ForwardingProfile } from "../../electron/storage/types"
import type { SftpDirectory, SftpTransferStartResult, SftpTransferTask } from "../../electron/sftp/types"

const demoHosts: HostProfile[] = [
  { id: "demo-g11", name: "G11", host: "47.97.162.53", port: 22, username: "root", authMethod: "agent", platform: "ubuntu", group: "Personal", environment: "development", tags: ["core", "linux"], favorite: true, notes: "" },
  { id: "demo-adcp", name: "WH-ADCP", host: "10.24.18.21", port: 22, username: "deploy", authMethod: "privateKey", platform: "debian", group: "Production", environment: "production", tags: ["release", "linux"], favorite: false, notes: "" },
  { id: "demo-db", name: "Database", host: "db.internal", port: 2222, username: "ops", authMethod: "password", group: "Production", environment: "production", tags: ["database"], favorite: false, notes: "" }
]

type PreviewSession = {
  hostId: string
  connectionId: string
  channelGeneration: number
  nextSequence: number
}

type TerminalEvent = Parameters<RockerBridge["events"]["onSessionEvent"]>[0] extends (event: infer Event) => void ? Event : never

const mockListeners = new Set<(event: TerminalEvent) => void>()
const mockSessions = new Map<string, PreviewSession>()
const mockForwards = new Map<string, ForwardingInfo>()
const mockSftpWorkspaces = new Map<string, { hostId: string }>()
const mockProfiles = new Map<string, ForwardingProfile>([
  ["preview-forward-g11", {
    id: "preview-forward-g11",
    hostId: "demo-g11",
    name: "G11 Web Console",
    description: "Shared development console",
    localAddress: "127.0.0.1",
    localPort: 18080,
    remoteAddress: "127.0.0.1",
    remotePort: 8080,
    autoStart: false,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-10T12:30:00.000Z"
  }],
  ["preview-forward-adcp", {
    id: "preview-forward-adcp",
    hostId: "demo-adcp",
    name: "Release Metrics",
    description: "Read-only metrics endpoint",
    localAddress: "127.0.0.1",
    localPort: 19090,
    remoteAddress: "127.0.0.1",
    remotePort: 9090,
    autoStart: true,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z"
  }]
])
let mockHosts = [...demoHosts]
let mockWorkspace: StoredWorkspaceWindow | undefined
let mockHostKeys: HostKeyInventorySnapshot = {
  entries: [{ host: "47.97.162.53", port: 22, fingerprint: "demo-g11-fingerprint" }],
  history: [{
    at: "2026-09-01T08:00:00.000Z",
    action: "trusted",
    host: "47.97.162.53",
    port: 22,
    fingerprint: "demo-g11-fingerprint"
  }]
}
let mockSettings: AppSettings = {
  locale: "en",
  sidebarWidth: 220,
  terminalFont: "JetBrains Mono",
  terminalFontSize: 13,
  scrollback: 10000,
  cursorStyle: "bar",
  cursorBlink: true,
  terminalBell: true,
  connectionTimeout: 15,
  autoReconnect: true,
  reconnectMode: "limited",
  restorePreviousWorkspace: true,
  confirmMultilinePaste: true,
  bindAddress: "127.0.0.1"
}

export function getRockerBridge(): RockerBridge {
  if (window.rocker) return window.rocker
  return createBrowserPreviewBridge()
}

function createBrowserPreviewBridge(): RockerBridge {
  return {
    app: {
      platform: "browser" as NodeJS.Platform,
      minimize: async () => undefined,
      toggleMaximize: async () => undefined,
      isMaximized: async () => false,
      close: async () => undefined
    },
    hosts: {
      list: async () => mockHosts,
      save: async ({ profile }) => {
        const existing = mockHosts.find((host) => host.id === profile.id)
        const nextProfile = normalizePreviewHostProfile(profile, existing)
        mockHosts = mockHosts.some((host) => host.id === profile.id)
          ? mockHosts.map((host) => host.id === nextProfile.id ? nextProfile : host)
          : [...mockHosts, nextProfile]
      },
      duplicate: async (id) => {
        const source = mockHosts.find((host) => host.id === id)
        if (!source) throw new Error("Host profile was not found")
        const duplicate: HostProfile = {
          id: crypto.randomUUID(),
          name: `${source.name} copy`,
          host: source.host,
          port: source.port,
          username: source.username,
          authMethod: "agent",
          ...(source.platform ? { platform: source.platform } : {}),
          ...(source.group ? { group: source.group } : {}),
          ...(source.environment ? { environment: source.environment } : {}),
          ...(source.tags ? { tags: [...source.tags] } : {}),
          charset: source.charset ?? "utf-8",
          themeColor: source.themeColor ?? "rocker",
          publicKeyEnabled: false,
          snippetsEnabled: false,
          favorite: false,
          notes: source.notes
        }
        mockHosts = [...mockHosts, duplicate]
        return duplicate
      },
      setFavorite: async (id, favorite) => {
        const source = mockHosts.find((host) => host.id === id)
        if (!source) throw new Error("Host profile was not found")
        const updated = { ...source, favorite }
        mockHosts = mockHosts.map((host) => host.id === id ? updated : host)
        return updated
      },
      remove: async (id) => { mockHosts = mockHosts.filter((host) => host.id !== id) },
      importSshConfig: async () => [],
      testConnection: async (id) => {
        if (!mockHosts.some((host) => host.id === id)) return { status: "failed", reason: "configuration" }
        return { status: "reachable", latencyMs: 24 }
      }
    },
    sessions: {
      open: async ({ sessionId, hostId }) => {
        const connectionId = `preview-${hostId}`
        const channelGeneration = 1
        mockSessions.set(sessionId, { hostId, connectionId, channelGeneration, nextSequence: 1 })
        window.setTimeout(() => emitMock({ kind: "state", sessionId, connectionId, channelGeneration, state: "connected" }), 100)
        window.setTimeout(() => emitPreviewOutput(sessionId, channelGeneration, `Rocker preview session for ${hostId}\r\n$ `), 160)
        return { sessionId, hostId, channelGeneration, state: "connected" }
      },
      write: async (sessionId, channelGeneration, data) => emitPreviewOutput(sessionId, channelGeneration, `preview:${data}`),
      resize: async () => undefined,
      ackOutput: async () => undefined,
      reconnect: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        session.channelGeneration += 1
        session.nextSequence = 1
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "connected",
          notice: "reconnected"
        })
      },
      cancelReconnect: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "disconnected",
          reason: "cancelled"
        })
      },
      close: async (sessionId) => {
        const session = mockSessions.get(sessionId)
        if (!session) return
        mockSessions.delete(sessionId)
        emitMock({
          kind: "state",
          sessionId,
          connectionId: session.connectionId,
          channelGeneration: session.channelGeneration,
          state: "closing"
        })
      },
      beginRestore: async () => undefined,
      completeRestore: async () => undefined,
      duplicateInNewWindow: async () => undefined
    },
    ports: {
      scan: async () => [],
      start: async (connectionId, spec) => {
        const forwarding: ForwardingInfo = { ...spec, id: crypto.randomUUID(), connectionId, status: "forwarding" }
        mockForwards.set(forwarding.id, forwarding)
        return forwarding
      },
      resume: async (forwardingId) => {
        const forwarding = mockForwards.get(forwardingId)
        if (!forwarding) throw new Error("Port forwarding was not found")
        const resumed: ForwardingInfo = { ...forwarding, status: "forwarding" }
        mockForwards.set(forwardingId, resumed)
        return resumed
      },
      stop: async (forwardingId) => { mockForwards.delete(forwardingId) },
      list: async () => [...mockForwards.values()],
      listOverview: async () => previewForwardingViews(),
      listForHost: async (hostId) => previewForwardingViews(hostId),
      createProfile: async (hostId, request) => {
        const profile = createPreviewProfile(hostId, request)
        mockProfiles.set(profile.id, profile)
        return profile
      },
      updateProfile: async (profileId, request) => {
        const existing = mockProfiles.get(profileId)
        if (!existing) throw new Error("Forwarding profile was not found")
        const profile = { ...existing, ...normalizePreviewForwardingRequest(request), updatedAt: new Date().toISOString() }
        mockProfiles.set(profileId, profile)
        return profile
      },
      removeProfile: async (profileId) => {
        mockProfiles.delete(profileId)
        for (const [id, forwarding] of mockForwards) if (forwarding.profileId === profileId) mockForwards.delete(id)
      },
      startProfile: async (profileId) => {
        const profile = mockProfiles.get(profileId)
        if (!profile) throw new Error("Forwarding profile was not found")
        const existing = [...mockForwards.values()].find((forwarding) => forwarding.profileId === profileId)
        const forwarding: ForwardingInfo = {
          ...profileToPreviewSpec(profile),
          id: existing?.id ?? crypto.randomUUID(),
          connectionId: existing?.connectionId ?? `preview-${profile.hostId}`,
          hostId: profile.hostId,
          profileId,
          status: "forwarding"
        }
        mockForwards.set(forwarding.id, forwarding)
        return forwarding
      },
      openAddress: async () => undefined
    },
    // Browser preview only: this in-memory route never represents a real SSH/SFTP connection.
    sftp: {
      open: async (workspaceId, hostId) => {
        mockSftpWorkspaces.set(workspaceId, { hostId })
        return { workspaceId, hostId, connectionId: `preview-sftp-${hostId}`, state: "ready" as const }
      },
      close: async (workspaceId) => { mockSftpWorkspaces.delete(workspaceId) },
      list: async (workspaceId, path): Promise<SftpDirectory> => {
        const workspace = mockSftpWorkspaces.get(workspaceId)
        if (!workspace) throw new Error("SFTP workspace was not opened")
        const normalized = path.trim() || "/"
        return {
          path: normalized.startsWith("/") ? normalized : `/${normalized}`,
          entries: normalized === "/" ? [
            { name: "home", path: "/home", type: "directory" },
            { name: "README.md", path: "/README.md", type: "file", size: 1_024, modifiedAt: new Date(0).toISOString() }
          ] : []
        }
      },
      mkdir: async () => undefined,
      rename: async () => undefined,
      remove: async () => undefined,
      chooseUpload: async () => { throw new Error("SFTP uploads are unavailable in browser preview") },
      chooseDownload: async () => { throw new Error("SFTP downloads are unavailable in browser preview") },
      upload: async (): Promise<SftpTransferStartResult> => { throw new Error("SFTP uploads are unavailable in browser preview") },
      download: async (): Promise<SftpTransferStartResult> => { throw new Error("SFTP downloads are unavailable in browser preview") },
      listTransfers: async (): Promise<SftpTransferTask[]> => [],
      cancelTransfer: async () => undefined,
      retryTransfer: async (): Promise<SftpTransferStartResult> => { throw new Error("SFTP transfers are unavailable in browser preview") }
    },
    workspace: {
      load: async () => mockWorkspace,
      save: async (snapshot) => {
        mockWorkspace = {
          workspaceId: mockWorkspace?.workspaceId ?? crypto.randomUUID(),
          bounds: mockWorkspace?.bounds,
          maximized: mockWorkspace?.maximized ?? false,
          ...snapshot
        }
      }
    },
    bootstrap: {
      load: async () => createPreviewBootstrapSnapshot(),
      retry: async (resources) => {
        validatePreviewBootstrapResources(resources)
        const snapshot = await createPreviewBootstrapSnapshot()
        const result: Partial<AppBootstrapSnapshot> = {}
        for (const resource of resources) result[resource] = snapshot[resource] as never
        return result
      }
    },
    history: {
      list: async () => [
        { id: "preview-history", hostId: "demo-g11", connectedAt: new Date(Date.now() - 36 * 60_000).toISOString(), durationMs: 742_000, outcome: "connected" }
      ],
      clear: async () => undefined
    },
    settings: {
      get: async () => ({ ...mockSettings }),
      update: async (update) => {
        mockSettings = { ...mockSettings, ...update }
        return { ...mockSettings }
      }
    },
    diagnostics: {
      export: async () => ({ canceled: true })
    },
    configuration: {
      exportTemplate: async () => ({ canceled: true }),
      exportBundle: async () => ({ canceled: true }),
      chooseImport: async () => ({ canceled: true }),
      previewImport: async () => {
        throw new Error("Configuration import is unavailable in browser preview")
      },
      applyImport: async () => {
        throw new Error("Configuration import is unavailable in browser preview")
      }
    },
    credentials: {
      protectionStatus: async () => ({ mode: "keychain", keychainAvailable: true, vaultState: "not-configured" }),
      enableVault: async () => ({ mode: "vault", keychainAvailable: true, vaultState: "unlocked" }),
      unlockVault: async () => ({ mode: "vault", keychainAvailable: true, vaultState: "unlocked" }),
      lockVault: async () => ({ mode: "vault", keychainAvailable: true, vaultState: "locked" }),
      disableVault: async () => ({ mode: "keychain", keychainAvailable: true, vaultState: "not-configured" })
    },
    hostKeys: {
      list: async () => ({
        entries: mockHostKeys.entries.map((entry) => ({ ...entry })),
        history: mockHostKeys.history.map((entry) => ({ ...entry }))
      }),
      remove: async (request: HostKeyRemovalRequest) => {
        const current = mockHostKeys.entries.find((entry) => entry.host === request.host && entry.port === request.port)
        if (current && current.fingerprint !== request.fingerprint.replace(/^SHA256:/i, "")) throw new Error("Host Key changed")
        mockHostKeys = {
          entries: mockHostKeys.entries.filter((entry) => !(entry.host === request.host && entry.port === request.port)),
          history: current
            ? [...mockHostKeys.history, { at: new Date().toISOString(), action: "removed", ...current }]
            : mockHostKeys.history
        }
      }
    },
    events: {
      onSessionEvent: (listener) => {
        mockListeners.add(listener)
        return () => mockListeners.delete(listener)
      },
      onSessionLaunch: () => () => undefined,
      onForwardingEvent: () => () => undefined,
      onSftpEvent: () => () => undefined
    }
  }
}

async function createPreviewBootstrapSnapshot(): Promise<AppBootstrapSnapshot> {
  return {
    settings: { health: previewHealth("settings"), value: { ...mockSettings } },
    history: {
      health: previewHealth("history"),
      value: [
        { id: "preview-history", hostId: "demo-g11", connectedAt: "2026-01-01T00:00:00.000Z", durationMs: 742_000, outcome: "connected" }
      ]
    },
    workspace: { health: previewHealth("workspace"), value: mockWorkspace },
    hosts: { health: previewHealth("hosts"), value: mockHosts.map(toPreviewBootstrapHostProfile) },
    credentials: { health: previewHealth("credentials") },
    hostKeys: { health: previewHealth("hostKeys") }
  }
}

function toPreviewBootstrapHostProfile(profile: HostProfile): BootstrapHostProfile {
  const { identityFile: _identityFile, ...safeProfile } = profile
  return { ...safeProfile, hasIdentityFile: Boolean(profile.identityFile) }
}

function normalizePreviewHostProfile(profile: HostSaveProfile, existing: HostProfile | undefined): HostProfile {
  const source = isRedactedHostProfile(profile)
    ? (() => {
      const { hasIdentityFile: _hasIdentityFile, ...safeProfile } = profile
      return profile.hasIdentityFile && existing?.identityFile
        ? { ...safeProfile, identityFile: existing.identityFile }
        : safeProfile
    })()
    : profile
  const publicKeyEnabled = source.publicKeyEnabled === true || source.authMethod === "privateKey"
  const snippetCollection = isNonBlankString(source.snippetCollection, 256) ? source.snippetCollection.trim() : undefined
  const snippetsEnabled = source.snippetsEnabled === true && snippetCollection !== undefined
  const normalizedTags = normalizePreviewTags(source.tags)
  const { snippetCollection: _snippetCollection, environment: _environment, tags: _tags, ...withoutOptionalMetadata } = source
  return {
    ...(snippetsEnabled ? { ...withoutOptionalMetadata, snippetCollection } : withoutOptionalMetadata),
    publicKeyEnabled,
    snippetsEnabled,
    charset: isPreviewCharset(source.charset) ? source.charset : "utf-8",
    themeColor: isPreviewThemeColor(source.themeColor) ? source.themeColor : "rocker",
    ...(isPreviewEnvironment(source.environment) ? { environment: source.environment } : {}),
    ...(normalizedTags ? { tags: normalizedTags } : {})
  }
}

function isNonBlankString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
}

function isPreviewCharset(value: unknown): value is HostCharset {
  return value === "utf-8" || value === "gb18030" || value === "iso-8859-1"
}

function isPreviewThemeColor(value: unknown): value is HostThemeColor {
  return value === "rocker" || value === "amber" || value === "ocean" || value === "slate"
}

function isPreviewEnvironment(value: unknown): value is HostEnvironment {
  return value === "production" || value === "staging" || value === "development" || value === "personal"
}

function normalizePreviewTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined
  const tags: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== "string") return undefined
    const tag = candidate.trim()
    if (!tag) continue
    if (tag.length > 64) return undefined
    const identity = tag.toLowerCase()
    if (seen.has(identity)) continue
    seen.add(identity)
    tags.push(tag)
  }
  return tags.length > 0 ? tags : undefined
}

function isRedactedHostProfile(profile: HostSaveProfile): profile is BootstrapHostProfile {
  return typeof (profile as { hasIdentityFile?: unknown }).hasIdentityFile === "boolean"
    && (profile as HostProfile).identityFile === undefined
}

function previewHealth(store: StorageKind): StorageHealth {
  return { store, status: "ok" }
}

function validatePreviewBootstrapResources(resources: BootstrapResourceName[]): void {
  const known: BootstrapResourceName[] = ["settings", "history", "workspace", "hosts", "credentials", "hostKeys"]
  if (!Array.isArray(resources) || resources.length === 0) throw new Error("Retry resources must be non-empty")
  if (resources.length > known.length) throw new Error("Retry resources must include at most six resources")
  const seen = new Set<string>()
  for (const resource of resources) {
    if (!known.includes(resource)) throw new Error("Retry resources must use known resource names")
    if (seen.has(resource)) throw new Error("Retry resources must not contain duplicates")
    seen.add(resource)
  }
}

function emitMock(event: TerminalEvent): void {
  for (const listener of mockListeners) listener(event)
}

function emitPreviewOutput(sessionId: string, channelGeneration: number, data: string): void {
  const session = mockSessions.get(sessionId)
  if (!session || session.channelGeneration !== channelGeneration) return
  emitMock({
    kind: "output",
    packet: {
      sessionId,
      channelGeneration,
      sequence: session.nextSequence++,
      bytes: new TextEncoder().encode(data)
    }
  })
}

function previewForwardingViews(hostId?: string): ForwardingProfileView[] {
  return [...mockProfiles.values()]
    .filter((profile) => hostId === undefined || profile.hostId === hostId)
    .map((profile) => ({
      profile: { ...profile },
      runtime: [...mockForwards.values()].find((forwarding) => forwarding.profileId === profile.id)
    }))
}

function createPreviewProfile(hostId: string, request: ForwardingProfileRequest): ForwardingProfile {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    hostId,
    ...normalizePreviewForwardingRequest(request),
    createdAt: now,
    updatedAt: now
  }
}

function normalizePreviewForwardingRequest(request: ForwardingProfileRequest): Omit<ForwardingProfile, "id" | "hostId" | "createdAt" | "updatedAt"> {
  return {
    name: request.name.trim(),
    ...(request.description?.trim() ? { description: request.description.trim() } : {}),
    localAddress: request.localAddress,
    localPort: request.localPort,
    remoteAddress: request.remoteAddress.trim(),
    remotePort: request.remotePort,
    autoStart: request.autoStart
  }
}

function profileToPreviewSpec(profile: ForwardingProfile): Omit<ForwardingInfo, "id" | "connectionId" | "status"> {
  return {
    localAddress: profile.localAddress,
    localPort: profile.localPort,
    remoteAddress: profile.remoteAddress,
    remotePort: profile.remotePort,
    hostId: profile.hostId,
    profileId: profile.id
  }
}
