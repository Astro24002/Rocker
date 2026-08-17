const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validatePort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
}

export function validateDimensions(cols: unknown, rows: unknown): cols is number {
  return typeof cols === "number" && Number.isInteger(cols) && cols >= 1 && cols <= 500 &&
    typeof rows === "number" && Number.isInteger(rows) && rows >= 1 && rows <= 500
}

export function validateTerminalData(value: unknown): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 64 * 1024
}

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && sessionIdPattern.test(value)
}
