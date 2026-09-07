export const COMPACT_SIDEBAR_WIDTH = 58
export const EXPANDED_SIDEBAR_MIN_WIDTH = 180
export const EXPANDED_SIDEBAR_MAX_WIDTH = 320
export const DEFAULT_SIDEBAR_WIDTH = 220
export const SIDEBAR_COMPACT_THRESHOLD = 119
export const SIDEBAR_RESIZE_STEP = 12

export function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH
  const rounded = Math.round(value)
  if (rounded <= SIDEBAR_COMPACT_THRESHOLD) return COMPACT_SIDEBAR_WIDTH
  if (rounded < EXPANDED_SIDEBAR_MIN_WIDTH) return EXPANDED_SIDEBAR_MIN_WIDTH
  return Math.min(EXPANDED_SIDEBAR_MAX_WIDTH, rounded)
}

export function stepSidebarWidth(current: number, direction: "decrease" | "increase"): number {
  const normalized = normalizeSidebarWidth(current)
  if (direction === "increase") {
    if (normalized === COMPACT_SIDEBAR_WIDTH) return EXPANDED_SIDEBAR_MIN_WIDTH
    return normalizeSidebarWidth(normalized + SIDEBAR_RESIZE_STEP)
  }
  if (normalized === EXPANDED_SIDEBAR_MIN_WIDTH) return COMPACT_SIDEBAR_WIDTH
  if (normalized === COMPACT_SIDEBAR_WIDTH) return COMPACT_SIDEBAR_WIDTH
  return normalizeSidebarWidth(normalized - SIDEBAR_RESIZE_STEP)
}

export function isCompactSidebar(width: number): boolean {
  return normalizeSidebarWidth(width) === COMPACT_SIDEBAR_WIDTH
}
