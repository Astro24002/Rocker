import { join } from "node:path"

/** Returns the product-cased Electron user-data directory. */
export function productUserDataDirectory(appDataPath: string): string {
  return join(appDataPath, "Rocker")
}
