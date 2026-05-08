import type { AppGraphSnapshot, WSMessage } from "./types"

const emptySnapshot: AppGraphSnapshot = {
  meta: {
    projectName: "",
    composePath: "",
    version: 0,
    generatedAt: new Date(0).toISOString()
  },
  containers: [],
  findings: [],
  explanations: []
}

export async function fetchSnapshot(): Promise<AppGraphSnapshot> {
  const response = await fetch("/api/v1/snapshot")
  if (!response.ok) {
    return emptySnapshot
  }
  return (await response.json()) as AppGraphSnapshot
}

export function subscribeSnapshot(onMessage: (message: WSMessage) => void): () => void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws"
  const url = `${protocol}://${window.location.host}/api/v1/ws`
  let ws: WebSocket | undefined

  try {
    ws = new WebSocket(url)
    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as WSMessage
        onMessage(parsed)
      } catch {
        // ignore malformed WS payloads for MVP
      }
    }
  } catch {
    // ws optional in MVP skeleton
  }

  return () => {
    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close()
    }
  }
}
