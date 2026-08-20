const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.max(0, Math.min(BACKOFF_DELAYS_MS.length - 1, Math.floor(attempt) - 1))
  const delay = BACKOFF_DELAYS_MS[index]
  const jitter = (Math.max(0, Math.min(1, random())) * 0.4) - 0.2
  return Math.round(delay * (1 + jitter))
}
