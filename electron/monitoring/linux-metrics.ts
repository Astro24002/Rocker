import { performance } from "node:perf_hooks"
import type { RemoteExecOptions, SessionCommandExecutor } from "../ssh/types"

export interface NetworkTotals {
  receivedBytes: number
  transmittedBytes: number
}

export interface HostMetrics {
  sessionId: string
  latencyMs: number | null
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  loadAverage: number | null
  receiveBytesPerSecond: number | null
  transmitBytesPerSecond: number | null
  sampledAt: string
}

interface PreviousSample {
  cpu: string
  network: NetworkTotals
  sampledAt: number
}

const monitoringExecOptions: RemoteExecOptions = { timeoutMs: 8_000, maxOutputBytes: 262_144 }

export class LinuxMetricsSampler {
  private readonly previous = new Map<string, PreviousSample>()

  public constructor(private readonly sessions: SessionCommandExecutor) {}

  public async sample(sessionId: string): Promise<HostMetrics> {
    const startedAt = performance.now()
    const [cpu, memory, disk, network, load] = await Promise.all([
      this.sessions.exec(sessionId, "cat /proc/stat", monitoringExecOptions),
      this.sessions.exec(sessionId, "cat /proc/meminfo", monitoringExecOptions),
      this.sessions.exec(sessionId, "df -P /", monitoringExecOptions),
      this.sessions.exec(sessionId, "cat /proc/net/dev", monitoringExecOptions),
      this.sessions.exec(sessionId, "cat /proc/loadavg", monitoringExecOptions)
    ])
    const now = Date.now()
    const currentNetwork = parseNetworkTotals(network)
    const previous = this.previous.get(sessionId)
    const elapsedSeconds = previous ? Math.max((now - previous.sampledAt) / 1000, 0.001) : 0
    this.previous.set(sessionId, { cpu, network: currentNetwork, sampledAt: now })
    return {
      sessionId,
      latencyMs: Math.round(performance.now() - startedAt),
      cpuPercent: previous ? parseCpuUsage(previous.cpu, cpu) : null,
      memoryPercent: parseMemoryUsage(memory),
      diskPercent: parseDiskUsage(disk),
      loadAverage: parseLoadAverage(load),
      receiveBytesPerSecond: previous ? (currentNetwork.receivedBytes - previous.network.receivedBytes) / elapsedSeconds : null,
      transmitBytesPerSecond: previous ? (currentNetwork.transmittedBytes - previous.network.transmittedBytes) / elapsedSeconds : null,
      sampledAt: new Date(now).toISOString()
    }
  }

  public clear(sessionId: string): void {
    this.previous.delete(sessionId)
  }
}

export function parseLoadAverage(output: string): number | null {
  const value = Number.parseFloat(output.trim().split(/\s+/)[0] ?? "")
  return Number.isFinite(value) ? value : null
}

export function parseCpuUsage(previous: string, current: string): number | null {
  const before = parseCpuLine(previous)
  const after = parseCpuLine(current)
  if (!before || !after) return null
  const totalDelta = after.total - before.total
  const idleDelta = after.idle - before.idle
  if (totalDelta <= 0) return null
  return clampPercent(((totalDelta - idleDelta) / totalDelta) * 100)
}

export function parseMemoryUsage(output: string): number | null {
  const total = readKiB(output, "MemTotal")
  const available = readKiB(output, "MemAvailable")
  if (total === undefined || available === undefined || total <= 0) return null
  return clampPercent(((total - available) / total) * 100)
}

export function parseDiskUsage(output: string): number | null {
  const lines = output.trim().split(/\r?\n/)
  const data = lines[lines.length - 1]?.trim().split(/\s+/)
  const percentage = data?.find((part) => /^\d+%$/.test(part))
  return percentage ? Number(percentage.slice(0, -1)) : null
}

export function parseNetworkTotals(output: string): NetworkTotals {
  let receivedBytes = 0
  let transmittedBytes = 0
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+)$/)
    if (!match || match[1].trim() === "lo") continue
    const values = match[2].trim().split(/\s+/).map(Number)
    if (values.length >= 9 && values.every(Number.isFinite)) {
      receivedBytes += values[0]
      transmittedBytes += values[8]
    }
  }
  return { receivedBytes, transmittedBytes }
}

function parseCpuLine(output: string): { idle: number; total: number } | undefined {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith("cpu "))
  if (!line) return undefined
  const values = line.trim().split(/\s+/).slice(1).map(Number)
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) return undefined
  return {
    idle: values[3] + (values[4] ?? 0),
    total: values.reduce((sum, value) => sum + value, 0)
  }
}

function readKiB(output: string, key: string): number | undefined {
  const match = output.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, "m"))
  return match ? Number(match[1]) : undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}
