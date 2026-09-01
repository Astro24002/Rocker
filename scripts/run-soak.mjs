import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

export const DEFAULT_SOAK_DURATION_MS = 1_800_000
export const MIN_SOAK_DURATION_MS = 1_000

export function parseSoakArgs(args) {
  let durationMs = DEFAULT_SOAK_DURATION_MS
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    let value
    if (argument === "--duration-ms") {
      value = args[++index]
      if (value === undefined) throw new Error("Missing value for --duration-ms")
    } else if (argument.startsWith("--duration-ms=")) {
      value = argument.slice("--duration-ms=".length)
    } else {
      throw new Error(`Unknown soak option: ${argument}`)
    }

    durationMs = Number(value)
    if (!Number.isSafeInteger(durationMs) || durationMs < MIN_SOAK_DURATION_MS) {
      throw new Error(`Soak duration must be at least ${MIN_SOAK_DURATION_MS}ms`)
    }
  }
  return { durationMs }
}

export function runSoak({ durationMs } = parseSoakArgs(process.argv.slice(2))) {
  const vitest = resolve("node_modules/vitest/vitest.mjs")
  const child = spawn(process.execPath, [
    vitest,
    "run",
    "electron/ssh/terminal-soak.test.ts",
    "--project=electron"
  ], {
    cwd: resolve("."),
    env: { ...process.env, ROCKER_SOAK: "1", ROCKER_SOAK_DURATION_MS: String(durationMs) },
    stdio: "inherit"
  })

  return new Promise((resolveExit, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)))
  })
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  runSoak().then((code) => {
    process.exitCode = code
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
