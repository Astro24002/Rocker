import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { productUserDataDirectory } from "./user-data-directory"

describe("productUserDataDirectory", () => {
  it("always selects the product-cased Rocker directory", () => {
    expect(productUserDataDirectory("C:\\Users\\Libk\\AppData\\Roaming")).toBe(join("C:\\Users\\Libk\\AppData\\Roaming", "Rocker"))
  })
})
