import type { SshManager } from "../ssh/ssh-manager"
import { parseListeningPorts } from "./linux-port-parser"
import type { DiscoveredPort } from "./types"

const ssCommand = "ss -ltnpeH"
const netstatCommand = "netstat -ltnpe"

export class PortService {
  public constructor(private readonly sessions: Pick<SshManager, "exec">) {}

  public async scan(sessionId: string): Promise<DiscoveredPort[]> {
    try {
      const output = await this.sessions.exec(sessionId, ssCommand)
      const ports = parseListeningPorts(output, "ss")
      if (ports.length > 0) return ports.map((port) => ({ ...port, sessionId }))
    } catch {
      // The netstat fallback below reports the final unsupported state.
    }
    const output = await this.sessions.exec(sessionId, netstatCommand)
    return parseListeningPorts(output, "netstat").map((port) => ({ ...port, sessionId }))
  }
}
