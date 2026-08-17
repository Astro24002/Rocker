import { resolve } from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "electron/main.ts"),
        formats: ["es"]
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.js"
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, "electron/preload.ts"),
        formats: ["cjs"]
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.cjs"
        }
      }
    }
  },
  renderer: {
    root: __dirname,
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    }
  }
})
