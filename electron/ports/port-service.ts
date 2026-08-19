import type { ConnectionCommandExecutor } from "../ssh/types"
import { parseListeningPorts } from "./linux-port-parser"
import type { DiscoveredPort } from "./types"

const ssCommand = "ss -ltnpeH"
const netstatCommand = "netstat -ltnpe"

export class PortService {
  public constructor(private readonly sessions: ConnectionCommandExecutor) {}

  public async scan(connectionId: string): Promise<DiscoveredPort[]> {
    try {
      const output = await this.sessions.execOnConnection(connectionId, ssCommand)
      const ports = parseListeningPorts(output, "ss")
      if (ports.length > 0) return ports.map((port) => ({ ...port, connectionId }))
    } catch {
      // The netstat fallback below reports the final unsupported state.
    }
    const output = await this.sessions.execOnConnection(connectionId, netstatCommand)
    return parseListeningPorts(output, "netstat").map((port) => ({ ...port, connectionId }))
  }
}
