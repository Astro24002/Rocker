import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("rocker", {
  app: {
    platform: process.platform
  }
})
