import { createHash } from "node:crypto"
import type { DiscoveredPort, PortSource } from "./types"

export function parseListeningPorts(output: string, source: Exclude<PortSource, "manual">): DiscoveredPort[] {
  const ports = output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => source === "ss" ? parseSsLine(line) : parseNetstatLine(line))
    .filter((port): port is ParsedPort => port !== undefined)

  const unique = new Map<string, DiscoveredPort>()
  for (const port of ports) {
    const identity = `${port.remoteAddress}:${port.remotePort}:${port.pid ?? ""}:${port.process ?? ""}`
    if (!unique.has(identity)) {
      unique.set(identity, {
        ...port,
        id: createHash("sha1").update(identity).digest("hex").slice(0, 16),
        source,
        status: "discovered"
      })
    }
  }
  return [...unique.values()].sort((left, right) => left.remotePort - right.remotePort)
}

type ParsedPort = Omit<DiscoveredPort, "id" | "source" | "status">

function parseSsLine(line: string): ParsedPort | undefined {
  if (!line.startsWith("LISTEN")) return undefined
  const tokens = line.split(/\s+/)
  const endpoint = parseEndpoint(tokens[3] ?? "")
  if (!endpoint) return undefined
  const processMatch = line.match(/users:\(\(\"([^\"]+)\",pid=(\d+)/)
  const uidMatch = line.match(/\buid:(\d+)\b/)
  return {
    ...endpoint,
    process: processMatch?.[1],
    pid: processMatch?.[2] ? Number(processMatch[2]) : undefined,
    user: uidMatch?.[1]
  }
}

function parseNetstatLine(line: string): ParsedPort | undefined {
  const tokens = line.split(/\s+/)
  if (!tokens[0]?.startsWith("tcp") || !tokens.includes("LISTEN")) return undefined
  const endpoint = parseEndpoint(tokens[3] ?? "")
  if (!endpoint) return undefined
  const listenIndex = tokens.indexOf("LISTEN")
  const processToken = tokens[tokens.length - 1] ?? ""
  const processMatch = processToken.match(/^(\d+)\/(.+)$/)
  return {
    ...endpoint,
    process: processMatch?.[2],
    pid: processMatch?.[1] ? Number(processMatch[1]) : undefined,
    user: tokens[listenIndex + 1] && /^\d+$/.test(tokens[listenIndex + 1]) ? tokens[listenIndex + 1] : undefined
  }
}

function parseEndpoint(value: string): Pick<ParsedPort, "remoteAddress" | "remotePort"> | undefined {
  const bracketed = value.match(/^\[(.*)]:(\d+)$/)
  if (bracketed) {
    return { remoteAddress: bracketed[1], remotePort: Number(bracketed[2]) }
  }
  const separator = value.lastIndexOf(":")
  if (separator <= 0) return undefined
  const port = Number(value.slice(separator + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return { remoteAddress: value.slice(0, separator), remotePort: port }
}
