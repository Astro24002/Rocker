export const DEFAULT_SOAK_DURATION_MS: number
export const MIN_SOAK_DURATION_MS: number

export function parseSoakArgs(args: string[]): { durationMs: number }
export function runSoak(options?: { durationMs: number }): Promise<number>
