import { generateKeyPairSync } from "node:crypto"
import { mkdtemp, mkdir, open as openFile, readdir, rename, rm, rmdir, stat, unlink, writeFile, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import type { Socket } from "node:net"
import { Server, type AuthContext, type PseudoTtyInfo, type SFTPWrapper, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2"

export const TEST_USERNAME = "rocker-test"
export const TEST_PASSWORD = "rocker-password"

export interface SshTestServerOptions {
  username?: string
  password?: string
  welcome?: string
  onPtyResize?: (info: WindowChangeInfo) => void
  sftpFiles?: Record<string, string>
}

export interface SshResourceSnapshot {
  clients: number
  sessions: number
  shells: number
  forwards: number
}

export interface SshTestServer {
  readonly port: number
  readonly server: Server
  readonly connectionCount: number
  readonly ptyRequests: PseudoTtyInfo[]
  readonly ptyResizes: WindowChangeInfo[]
  close(): Promise<void>
  holdAuthentication(): void
  releaseAuthentication(): void
  holdNextShell(): void
  releaseNextShell(): void
  setKeepaliveResponse(enabled: boolean): void
  resourceSnapshot(): SshResourceSnapshot
  dropTransports(): void
  resizePty(cols: number, rows: number): void
}

export async function createSshTestServer(options: SshTestServerOptions = {}): Promise<SshTestServer> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const hostKey = privateKey.export({ type: "pkcs1", format: "pem" })
  const server = new Server({ hostKeys: [hostKey] })
  const sftpRoot = await mkdtemp(join(tmpdir(), "rocker-sftp-"))
  await mkdir(join(sftpRoot, "docs"), { recursive: true })
  await writeFile(join(sftpRoot, "README.txt"), "Rocker SFTP fixture\n", "utf8")
  for (const [remotePath, contents] of Object.entries(options.sftpFiles ?? {})) {
    const localPath = fixturePath(sftpRoot, remotePath)
    await mkdir(join(localPath, ".."), { recursive: true })
    await writeFile(localPath, contents, "utf8")
  }
  const sockets = new Set<Socket>()
  const activeClients = new Set<object>()
  const activeSessions = new Set<Session>()
  const activeShells = new Set<ServerChannel>()
  const activeForwards = new Set<ServerChannel>()
  const ptyRequests: PseudoTtyInfo[] = []
  const ptyResizes: WindowChangeInfo[] = []
  const pendingAuthentications: AuthContext[] = []
  const pendingShells: Array<{ accept: () => void; reject: () => void }> = []
  let connectionCount = 0
  let authenticationHeld = false
  let shellHoldCount = 0
  let keepaliveResponse = true
  let listeningPort = 0

  server.on("connection", (connection) => {
    connectionCount += 1
    activeClients.add(connection)
    const connectionSessions = new Set<Session>()
    const connectionShells = new Set<ServerChannel>()
    const connectionForwards = new Set<ServerChannel>()
    connection.once("close", () => {
      activeClients.delete(connection)
      for (const session of connectionSessions) activeSessions.delete(session)
      for (const channel of connectionShells) activeShells.delete(channel)
      for (const channel of connectionForwards) activeForwards.delete(channel)
    })
    const protocol = (connection as unknown as { _protocol?: { _handlers?: Record<string, (...args: unknown[]) => void> } })._protocol
    const globalRequest = protocol?._handlers?.GLOBAL_REQUEST
    if (protocol?._handlers && globalRequest) {
      protocol._handlers.GLOBAL_REQUEST = (proto, name, wantReply, data) => {
        if (name === "keepalive@openssh.com" && !keepaliveResponse) return
        globalRequest(proto, name, wantReply, data)
      }
    }
    const socket = (connection as unknown as { _sock?: Socket })._sock
    if (socket) {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    }
    connection.on("authentication", (context) => {
      const authenticate = (): void => {
        if (context.method === "password" && context.username === (options.username ?? TEST_USERNAME) && context.password === (options.password ?? TEST_PASSWORD)) context.accept()
        else context.reject()
      }
      if (authenticationHeld) pendingAuthentications.push(context)
      else authenticate()
    })
    connection.on("tcpip", (accept, _reject, _details) => {
      const channel = accept()
      activeForwards.add(channel)
      connectionForwards.add(channel)
      channel.once("close", () => {
        activeForwards.delete(channel)
        connectionForwards.delete(channel)
      })
    })
    connection.on("session", (accept, reject) => {
      const session = accept() as Session
      activeSessions.add(session)
      connectionSessions.add(session)
      session.once("close", () => {
        activeSessions.delete(session)
        connectionSessions.delete(session)
      })
      session.on("pty", (ptyAccept, _ptyReject, info) => {
        ptyRequests.push(info)
        ptyAccept()
      })
      session.on("window-change", (...args: unknown[]) => {
        const info = (args.length === 1 ? args[0] : args[2]) as WindowChangeInfo
        ptyResizes.push(info)
        options.onPtyResize?.(info)
      })
      session.on("shell", (shellAccept, shellReject) => {
        const openShell = (): void => {
          const channel = shellAccept()
          activeShells.add(channel)
          connectionShells.add(channel)
          channel.once("close", () => {
            activeShells.delete(channel)
            connectionShells.delete(channel)
          })
          if (options.welcome !== undefined) channel.write(options.welcome)
          channel.on("data", (data: Buffer) => {
            const text = data.toString("utf8")
            if (text.length > 0) channel.write(`echo: ${text}`)
          })
        }
        if (shellHoldCount > 0) {
          shellHoldCount -= 1
          pendingShells.push({ accept: openShell, reject: shellReject })
        } else {
          openShell()
        }
      })
      session.on("exec", (execAccept) => {
        const channel = execAccept()
        activeShells.add(channel)
        connectionShells.add(channel)
        channel.once("close", () => {
          activeShells.delete(channel)
          connectionShells.delete(channel)
        })
        channel.write("ok\n")
        queueMicrotask(() => {
          channel.exit(0)
          channel.end()
          // ssh2 keeps server-side exec streams half-open until the client
          // acknowledges the close. The command itself is complete once EOF
          // has been sent, so stop counting it as an active fixture resource.
          activeShells.delete(channel)
          connectionShells.delete(channel)
        })
      })
      session.on("sftp", (sftpAccept, sftpReject) => {
        try {
          installSftpFixture(sftpAccept(), sftpRoot)
        } catch {
          sftpReject()
        }
      })
      void reject
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address && typeof address === "object") listeningPort = address.port
      resolve()
    })
  })

  return {
    get port() { return listeningPort },
    server,
    get connectionCount() { return connectionCount },
    ptyRequests,
    ptyResizes,
    holdAuthentication() {
      authenticationHeld = true
    },
    releaseAuthentication() {
      authenticationHeld = false
      for (const context of pendingAuthentications.splice(0)) {
        if (context.method === "password" && context.username === (options.username ?? TEST_USERNAME) && context.password === (options.password ?? TEST_PASSWORD)) context.accept()
        else context.reject()
      }
    },
    holdNextShell() {
      shellHoldCount += 1
    },
    releaseNextShell() {
      pendingShells.shift()?.accept()
    },
    setKeepaliveResponse(enabled) {
      keepaliveResponse = enabled
    },
    resourceSnapshot() {
      return { clients: activeClients.size, sessions: activeSessions.size, shells: activeShells.size, forwards: activeForwards.size }
    },
    resizePty(cols, rows) {
      const info = { cols, rows, width: 0, height: 0 }
      ptyResizes.push(info)
      options.onPtyResize?.(info)
    },
    dropTransports() {
      for (const socket of sockets) socket.destroy()
    },
    async close() {
      authenticationHeld = false
      for (const context of pendingAuthentications.splice(0)) context.reject()
      shellHoldCount = 0
      for (const pending of pendingShells.splice(0)) pending.reject()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        if (server.address() === null) return resolve()
        server.close(() => resolve())
      })
      while (sockets.size > 0) await new Promise((resolve) => setImmediate(resolve))
      for (const channel of [...activeShells, ...activeForwards]) channel.close()
      activeClients.clear()
      activeSessions.clear()
      activeShells.clear()
      activeForwards.clear()
      await rm(sftpRoot, { recursive: true, force: true })
    }
  }
}

const SFTP_OPEN_WRITE = 0x00000002
const SFTP_OPEN_APPEND = 0x00000004
const SFTP_OPEN_CREAT = 0x00000008
const SFTP_OPEN_TRUNC = 0x00000010
const SFTP_OPEN_EXCL = 0x00000020
const SFTP_STATUS_OK = 0
const SFTP_STATUS_EOF = 1
const SFTP_STATUS_NO_SUCH_FILE = 2
const SFTP_STATUS_PERMISSION_DENIED = 3
const SFTP_STATUS_FAILURE = 4

type FixtureHandle =
  | { kind: "file"; file: FileHandle }
  | { kind: "directory"; path: string; entries: string[]; index: number }

function installSftpFixture(sftp: SFTPWrapper, root: string): void {
  const handles = new Map<string, FixtureHandle>()
  let nextHandle = 1
  const allocateHandle = (handle: FixtureHandle): Buffer => {
    const value = Buffer.from(`rocker-${nextHandle++}`)
    handles.set(value.toString("hex"), handle)
    return value
  }
  const readHandle = (value: Buffer): FixtureHandle | undefined => handles.get(value.toString("hex"))
  const removeHandle = (value: Buffer): void => { handles.delete(value.toString("hex")) }

  sftp.on("REALPATH", (id: number, remotePath: string) => {
    void Promise.resolve().then(() => {
      const normalized = normalizeFixtureRemotePath(remotePath)
      sftp.name(id, [{ filename: normalized, longname: normalized, attrs: emptySftpAttributes() }])
    }).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("STAT", (id: number, remotePath: string) => {
    void respondWithStats(sftp, id, fixturePath(root, remotePath))
  })
  sftp.on("LSTAT", (id: number, remotePath: string) => {
    void respondWithStats(sftp, id, fixturePath(root, remotePath))
  })
  sftp.on("OPENDIR", (id: number, remotePath: string) => {
    void readdir(fixturePath(root, remotePath)).then((entries) => {
      sftp.handle(id, allocateHandle({ kind: "directory", path: fixturePath(root, remotePath), entries, index: 0 }))
    }).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("READDIR", (id: number, rawHandle: Buffer) => {
    const handle = readHandle(rawHandle)
    if (!handle || handle.kind !== "directory") {
      sftp.status(id, SFTP_STATUS_FAILURE, "Invalid directory handle")
      return
    }
    const entries = handle.entries.slice(handle.index, handle.index + 64)
    handle.index += entries.length
    if (entries.length === 0) {
      sftp.status(id, SFTP_STATUS_EOF)
      return
    }
    void Promise.all(entries.map(async (entry) => {
      const entryPath = join(handle.path, entry)
      const attributes = await stat(entryPath)
      return { filename: entry, longname: entry, attrs: toSftpAttributes(attributes) }
    })).then((values) => sftp.name(id, values)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("OPEN", (id: number, remotePath: string, flags: number) => {
    const localPath = fixturePath(root, remotePath)
    void openFile(localPath, openFlags(flags)).then((file) => {
      sftp.handle(id, allocateHandle({ kind: "file", file }))
    }).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("READ", (id: number, rawHandle: Buffer, offset: number, length: number) => {
    const handle = readHandle(rawHandle)
    if (!handle || handle.kind !== "file") {
      sftp.status(id, SFTP_STATUS_FAILURE, "Invalid file handle")
      return
    }
    const buffer = Buffer.alloc(length)
    void handle.file.read(buffer, 0, length, offset).then(({ bytesRead }) => {
      if (bytesRead === 0) sftp.status(id, SFTP_STATUS_EOF)
      else sftp.data(id, buffer.subarray(0, bytesRead))
    }).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("WRITE", (id: number, rawHandle: Buffer, offset: number, data: Buffer) => {
    const handle = readHandle(rawHandle)
    if (!handle || handle.kind !== "file") {
      sftp.status(id, SFTP_STATUS_FAILURE, "Invalid file handle")
      return
    }
    void handle.file.write(data, 0, data.length, offset).then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("CLOSE", (id: number, rawHandle: Buffer) => {
    const handle = readHandle(rawHandle)
    if (!handle) {
      sftp.status(id, SFTP_STATUS_FAILURE, "Invalid handle")
      return
    }
    removeHandle(rawHandle)
    if (handle.kind === "directory") {
      sftp.status(id, SFTP_STATUS_OK)
      return
    }
    void handle.file.close().then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("REMOVE", (id: number, remotePath: string) => {
    void unlink(fixturePath(root, remotePath)).then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("MKDIR", (id: number, remotePath: string) => {
    void mkdir(fixturePath(root, remotePath)).then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("RMDIR", (id: number, remotePath: string) => {
    void rmdir(fixturePath(root, remotePath)).then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
  sftp.on("RENAME", (id: number, oldPath: string, newPath: string) => {
    void rename(fixturePath(root, oldPath), fixturePath(root, newPath)).then(() => sftp.status(id, SFTP_STATUS_OK)).catch((error: unknown) => sendSftpError(sftp, id, error))
  })
}

async function respondWithStats(sftp: SFTPWrapper, id: number, localPath: string): Promise<void> {
  try {
    const attributes = await stat(localPath)
    sftp.attrs(id, toSftpAttributes(attributes))
  } catch (error) {
    sendSftpError(sftp, id, error)
  }
}

function openFlags(flags: number): string {
  const write = (flags & SFTP_OPEN_WRITE) !== 0
  const append = (flags & SFTP_OPEN_APPEND) !== 0
  const create = (flags & SFTP_OPEN_CREAT) !== 0
  const truncate = (flags & SFTP_OPEN_TRUNC) !== 0
  const exclusive = (flags & SFTP_OPEN_EXCL) !== 0
  if (!write) return "r"
  if (append && exclusive) return "ax"
  if (append) return create ? "a" : "a+"
  if (truncate && exclusive) return "wx"
  if (truncate || create) return "w"
  return "r+"
}

function toSftpAttributes(value: { mode: number; uid: number; gid: number; size: number; atimeMs: number; mtimeMs: number }): { mode: number; uid: number; gid: number; size: number; atime: number; mtime: number } {
  return {
    mode: value.mode,
    uid: value.uid,
    gid: value.gid,
    size: value.size,
    atime: Math.floor(value.atimeMs / 1_000),
    mtime: Math.floor(value.mtimeMs / 1_000)
  }
}

function emptySftpAttributes(): { mode: number; uid: number; gid: number; size: number; atime: number; mtime: number } {
  return { mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }
}

function sendSftpError(sftp: SFTPWrapper, id: number, error: unknown): void {
  const code = errorCode(error)
  sftp.status(id, code, error instanceof Error ? error.message : "SFTP operation failed")
}

function errorCode(error: unknown): number {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    if (code === "ENOENT") return SFTP_STATUS_NO_SUCH_FILE
    if (code === "EACCES" || code === "EPERM") return SFTP_STATUS_PERMISSION_DENIED
  }
  return SFTP_STATUS_FAILURE
}

function normalizeFixtureRemotePath(value: string): string {
  const normalized = posix.resolve("/", value)
  return normalized === "/" ? "/" : normalized.replace(/\/$/, "")
}

function fixturePath(root: string, remotePath: string): string {
  const normalized = normalizeFixtureRemotePath(remotePath)
  return normalized === "/" ? root : join(root, normalized.slice(1))
}
