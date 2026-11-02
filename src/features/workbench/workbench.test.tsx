import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../../i18n"
import { WorkspacesView } from "./WorkspacesView"
import { CodexWorkbench } from "./CodexWorkbench"
import { createWorkbenchTestBridge, testProfile } from "./test-bridge"
import type { CodexWorkspaceSession } from "../terminal/session-state"

beforeEach(() => {
  localStorage.clear()
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
})
describe("Workspace UI", () => {
  it("selects a card with one click and opens its workbench with a double click", async () => {
    const { bridge } = createWorkbenchTestBridge(), onOpen = vi.fn()
    render(<I18nProvider><WorkspacesView bridge={bridge} hosts={[]} onOpen={onOpen} /></I18nProvider>)
    const card = await screen.findByRole("button", { name: testProfile.name })
    fireEvent.click(card)
    expect(card.closest("article")).toHaveAttribute("data-selected", "true"); expect(onOpen).not.toHaveBeenCalled()
    fireEvent.doubleClick(card); expect(onOpen).toHaveBeenCalledWith(testProfile)
  })
  it("uses the native directory picker and stores a local profile", async () => {
    const { bridge } = createWorkbenchTestBridge()
    render(<I18nProvider><WorkspacesView bridge={bridge} hosts={[]} onOpen={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New project" } })
    fireEvent.click(screen.getByRole("button", { name: "Choose directory" }))
    await waitFor(() => expect(screen.getByLabelText("Project directory")).toHaveValue("/chosen/project"))
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }))
    await waitFor(() => expect(bridge.save).toHaveBeenCalledWith(expect.objectContaining({ name: "New project", source: "local", cwd: "/chosen/project", executable: "codex" })))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
  it("keeps a conversation alive while hidden, handles events and ignores stale responses", async () => {
    const { bridge, emit } = createWorkbenchTestBridge(), patch = vi.fn(), onNew = vi.fn()
    const session: CodexWorkspaceSession = { id: "session", hostId: "local", label: "Project", kind: "codex", workbenchProfileId: testProfile.id, state: "idle" }
    const view = (active: boolean) => <I18nProvider><CodexWorkbench session={session} bridge={bridge} active={active} onNew={onNew} onPatch={patch} /></I18nProvider>
    const rendered = render(view(true))
    await screen.findByText("Ready")
    expect(bridge.terminal).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole("textbox", { name: "Message Codex" }), { target: { value: "Inspect the project" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    await waitFor(() => expect(bridge.send).toHaveBeenCalledWith(session.id, "Inspect the project"))
    const snapshot = await bridge.read(session.id)
    act(() => emit({ ...snapshot, revision: 3, status: "running", turnId: "turn", items: [{ id: "reply", role: "assistant", text: "Working on the project" }], approvals: [{ id: "approve", method: "command", description: "ls" }] }))
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }))
    expect(bridge.approve).toHaveBeenCalledWith(session.id, "approve", true)
    rendered.rerender(view(false)); rendered.rerender(view(true))
    act(() => emit({ ...snapshot, revision: 2 }))
    expect(screen.getByText("Working on the project")).toBeInTheDocument()
    expect(bridge.open).toHaveBeenCalledTimes(1)
    expect(bridge.close).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Stop" })); expect(bridge.interrupt).toHaveBeenCalledWith(session.id)
    fireEvent.click(screen.getByRole("button", { name: "Terminal" })); expect(bridge.terminal).toHaveBeenCalledWith(session.id, "open")
    fireEvent.click(screen.getByRole("button", { name: "New session" })); expect(onNew).toHaveBeenCalledWith(testProfile, true)
    rendered.unmount(); expect(bridge.close).not.toHaveBeenCalled()
  })
})
