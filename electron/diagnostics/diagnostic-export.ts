import { writeFile } from "node:fs/promises"
import type { AppSettings } from "../storage/types"
import type { DiagnosticLogger } from "./diagnostic-logger"
import type { DiagnosticRuntimeMetadata } from "./diagnostic-types"
import { sanitizeDiagnosticExport } from "./sanitize"

export interface DiagnosticExportContext {
  logger: Pick<DiagnosticLogger, "snapshot">
  settings: AppSettings
  appVersion?: string
  platform?: string
  arch?: string
  buildChannel?: DiagnosticRuntimeMetadata["buildChannel"]
  runtimeMode?: DiagnosticRuntimeMetadata["runtimeMode"]
  now?: () => Date
}

export async function writeDiagnosticExport(filePath: string, context: DiagnosticExportContext): Promise<void> {
  const now = context.now?.() ?? new Date()
  const payload = sanitizeDiagnosticExport({
    generatedAt: now.toISOString(),
    appVersion: context.appVersion ?? "unknown",
    platform: context.platform ?? "unknown",
    arch: context.arch ?? "unknown",
    buildChannel: context.buildChannel,
    runtimeMode: context.runtimeMode,
    events: context.logger.snapshot(),
    settings: context.settings
  })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
    if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST")) throw error
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  })
}

export function diagnosticFileName(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `rocker-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
}
