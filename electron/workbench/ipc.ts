import { BrowserWindow, dialog, ipcMain } from "electron"
import { ipcChannels } from "../ipc/bridge-contract"
import type { RuntimeOwner } from "../runtime/owner"
import { record } from "./types"
import type { WorkbenchService } from "./service"

function string(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value || value.length > max || value.includes("\0")) throw new Error("Invalid workspace request")
  return value
}
export function registerWorkbenchIpc(service: WorkbenchService, ownerFor: (id: number) => RuntimeOwner, send: (owner: RuntimeOwner, channel: string, payload: unknown) => void): () => void {
  ipcMain.handle(ipcChannels.workbenchRequest, async (event, action: unknown, input: unknown) => {
    const owner = ownerFor(event.sender.id), p = record(input)
    switch (action) {
      case "list": return service.profiles.list()
      case "save": return service.profiles.save(input)
      case "remove": return service.profiles.remove(string(p.id))
      case "chooseDirectory": {
        const target = BrowserWindow.fromWebContents(event.sender)
        const options = { properties: ["openDirectory"] as Array<"openDirectory"> }
        const result = target ? await dialog.showOpenDialog(target, options) : await dialog.showOpenDialog(options)
        return result.canceled ? undefined : result.filePaths[0]
      }
      case "open": return service.open(string(p.id), string(p.profileId), owner)
      case "read": return service.read(string(p.id), owner)
      case "send": return service.send(string(p.id), string(p.text, 100_000), owner)
      case "interrupt": return service.interrupt(string(p.id), owner)
      case "reconnect": return service.reconnect(string(p.id), owner)
      case "close": {
        if (typeof p.stop !== "boolean") throw new Error("Invalid close action")
        return service.close(string(p.id), owner, p.stop)
      }
      case "approve": {
        if (typeof p.accept !== "boolean") throw new Error("Invalid approval")
        return service.approve(string(p.id), string(p.approvalId), p.accept, owner)
      }
      case "answer": {
        const answers: Record<string, string> = {}
        for (const [key, value] of Object.entries(record(p.answers))) answers[string(key)] = string(value, 10_000)
        return service.answer(string(p.id), string(p.approvalId), answers, owner)
      }
      case "terminal": {
        if (!["open", "close", "write", "resize"].includes(String(p.action))) throw new Error("Invalid terminal action")
        const cols = p.cols === undefined ? 100 : p.cols, rows = p.rows === undefined ? 24 : p.rows
        if (typeof cols !== "number" || typeof rows !== "number" || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) throw new Error("Invalid terminal dimensions")
        return service.terminal(string(p.id), owner, String(p.action), p.data === undefined ? undefined : string(p.data, 65_536), cols, rows)
      }
      default: throw new Error("Unknown workspace action")
    }
  })
  const unsubscribe = service.onEvent(({ owner, snapshot }) => send(owner, ipcChannels.workbenchEvent, snapshot))
  return () => { unsubscribe(); ipcMain.removeHandler(ipcChannels.workbenchRequest) }
}
