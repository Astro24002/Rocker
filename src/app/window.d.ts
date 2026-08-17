import type { RockerBridge } from "../../electron/ipc/bridge-contract"

export {}

declare global {
  interface Window {
    rocker: RockerBridge
  }
}
