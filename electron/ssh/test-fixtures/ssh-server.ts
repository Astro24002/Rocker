import { generateKeyPairSync } from "node:crypto"
import type { Socket } from "node:net"
import { Server, type PseudoTtyInfo, type ServerChannel, type Session, type WindowChangeInfo } from "ssh2"

export const TEST_USERNAME = "rocker-test"
export const TEST_PASSWORD = "rocker-password"

export interface SshTestServerOptions {
  username?: string
  password?: string
  welcome?: string
  onPtyResize?: (info: WindowChangeInfo) => void
}

export interface SshTestServer {
  readonly port: number
  readonly server: Server
  readonly connectionCount: number
  readonly ptyRequests: PseudoTtyInfo[]
  readonly ptyResizes: WindowChangeInfo[]
  close(): Promise<void>
  dropTransports(): void
  resizePty(cols: number, rows: number): void
}

export async function createSshTestServer(options: SshTestServerOptions = {}): Promise<SshTestServer> {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const hostKey = privateKey.export({ type: "pkcs1", format: "pem" })
  const server = new Server({ hostKeys: [hostKey] })
  const sockets = new Set<Socket>()
  const ptyRequests: PseudoTtyInfo[] = []
  const ptyResizes: WindowChangeInfo[] = []
  let connectionCount = 0
  let lastChannel: ServerChannel | undefined
  let listeningPort = 0

  server.on("connection", (connection) => {
    connectionCount += 1
    const socket = (connection as unknown as { _sock?: Socket })._sock
    if (socket) {
      sockets.add(socket)
      socket.once("close", () => sockets.delete(socket))
    }
    connection.on("authentication", (context) => {
      if (context.method === "password" && context.username === (options.username ?? TEST_USERNAME) && context.password === (options.password ?? TEST_PASSWORD)) context.accept()
      else context.reject()
    })
    connection.on("session", (accept, reject) => {
      const session = accept() as Session
      session.on("pty", (ptyAccept, _ptyReject, info) => {
        ptyRequests.push(info)
        ptyAccept()
      })
      session.on("window-change", (windowAccept, _windowReject, info) => {
        ptyResizes.push(info)
        options.onPtyResize?.(info)
        windowAccept()
      })
      session.on("shell", (shellAccept, shellReject) => {
        const channel = shellAccept()
        lastChannel = channel
        if (options.welcome !== undefined) channel.write(options.welcome)
        channel.on("data", (data: Buffer) => {
          const text = data.toString("utf8")
          if (text.length > 0) channel.write(`echo: ${text}`)
        })
        channel.on("close", () => {
          if (lastChannel === channel) lastChannel = undefined
        })
      })
      session.on("exec", (execAccept) => {
        const channel = execAccept()
        lastChannel = channel
        channel.write("ok\n")
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
    resizePty(cols, rows) {
      const info = { cols, rows, width: 0, height: 0 }
      ptyResizes.push(info)
      options.onPtyResize?.(info)
    },
    dropTransports() {
      for (const socket of sockets) socket.destroy()
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        if (server.address() === null) return resolve()
        server.close(() => resolve())
      })
      while (sockets.size > 0) await new Promise((resolve) => setImmediate(resolve))
      lastChannel?.close()
      lastChannel = undefined
    }
  }
}
