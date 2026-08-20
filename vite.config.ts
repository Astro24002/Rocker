import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    projects: [
      {
        extends: true
      },
      {
        test: {
          name: "electron",
          include: ["electron/**/*.test.ts"],
          environment: "node"
        }
      }
    ]
  }
})
