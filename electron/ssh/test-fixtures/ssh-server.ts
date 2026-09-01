import { generateKeyPairSync } from "node:crypto"
import type { Socket } from "node:net"
import { Server, type AuthContext, type PseudoTtyInfo, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2"

export const TEST_USERNAME = "rocker-test"
export const TEST_PASSWORD = "rocker-password"

export interface SshTestServerOptions {
  username?: string
  password?: string
  welcome?: string
  onPtyResize?: (info: WindowChangeInfo) => void
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
    const protocol = (connection as unknown as { _protocol?: { _handlers?: Record<string, (...args: any[]) => void> } })._protocol
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
    }
  }
}
