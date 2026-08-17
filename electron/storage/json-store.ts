import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export class JsonStore<T> {
  public constructor(
    private readonly filePath: string,
    private readonly defaultValue: T = {} as T
  ) {}

  public async read(): Promise<T> {
    try {
      const serialized = await readFile(this.filePath, "utf8")
      return JSON.parse(serialized) as T
    } catch (error) {
      if (isFileMissing(error)) {
        return structuredClone(this.defaultValue)
      }
      throw error
    }
  }

  public async write(value: T): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    await rename(temporaryPath, this.filePath)
  }
}

function isFileMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
