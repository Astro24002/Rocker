import { describe, expect, it } from "vitest"
import { getTerminalFailurePresentation } from "./terminal-error"

describe("terminal failure presentation", () => {
  it("keeps network failures non-blocking and offers cancel plus retry", () => {
    expect(getTerminalFailurePresentation("reconnecting", "network")).toMatchObject({
      severity: "transient",
      showRetry: true,
      showCancel: true,
      showClose: false,
      detailKey: "terminal.networkErrorDetail"
    })
  })

  it("lets the user cancel an initial connection attempt", () => {
    expect(getTerminalFailurePresentation("connecting")).toMatchObject({
      severity: "transient",
      showRetry: false,
      showCancel: true,
      showClose: false
    })
  })

  it("stops automatic retry for authentication failures but keeps manual recovery", () => {
    expect(getTerminalFailurePresentation("error", "authentication")).toMatchObject({
      severity: "blocking",
      showRetry: true,
      showCancel: false,
      showClose: true,
      detailKey: "terminal.authenticationErrorDetail"
    })
  })

  it("uses security copy for changed host keys", () => {
    expect(getTerminalFailurePresentation("error", "host-key-changed")).toMatchObject({
      severity: "blocking",
      showRetry: true,
      showClose: true,
      detailKey: "terminal.hostKeyChangedDetail"
    })
  })

  it("does not hide disconnected sessions after a user cancellation", () => {
    expect(getTerminalFailurePresentation("disconnected", "cancelled")).toMatchObject({
      severity: "blocking",
      showRetry: true,
      showClose: true,
      detailKey: "terminal.reconnectCancelledDetail"
    })
  })
})
