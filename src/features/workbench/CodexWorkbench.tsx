import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Send, Square, TerminalSquare } from "lucide-react"
import type { WorkbenchBridge, WorkbenchProfile, WorkbenchSnapshot, WorkbenchApproval } from "../../../electron/workbench/types"
import type { CodexWorkspaceSession, WorkspaceSessionPatch } from "../terminal/session-state"
import { useWorkbenchText } from "./WorkspacesView"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import "@xterm/xterm/css/xterm.css"

export function CodexWorkbench({ session, bridge, active, onNew, onPatch }: { session: CodexWorkspaceSession; bridge?: WorkbenchBridge; active: boolean; onNew(profile: WorkbenchProfile, fresh: boolean): void; onPatch(id: string, patch: WorkspaceSessionPatch): void }) {
  const l = useWorkbenchText()
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>()
  const [error, setError] = useState("")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  const revision = useRef(-1)
  const followOutput = useRef(true)
  const receive = useCallback((next: WorkbenchSnapshot) => {
    if (next.id !== session.id || next.revision < revision.current) return
    revision.current = next.revision
    setSnapshot(next)
    onPatch(session.id, { kind: "codex", running: next.status === "running", state: next.status === "error" ? "error" : next.status === "connecting" ? "connecting" : next.status === "closed" ? "disconnected" : "connected" })
  }, [session.id, onPatch])
  useEffect(() => {
    if (!bridge) return
    let mounted = true
    const unsubscribe = bridge.onEvent(next => { if (mounted) receive(next) })
    void bridge.open(session.id, session.workbenchProfileId).then(next => { if (mounted) receive(next) }).catch(e => { if (mounted) setError(String(e)) })
    return () => { mounted = false; unsubscribe() }
  }, [bridge, session.id, session.workbenchProfileId, receive])
  useEffect(() => {
    if (active && followOutput.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [active, snapshot?.revision])
  const run = (task: Promise<unknown> | undefined) => { setError(""); void task?.catch(e => setError(String(e))) }
  const send = () => {
    if (!bridge || !input.trim() || busy || snapshot?.status !== "ready") return
    setBusy(true); setError("")
    void bridge.send(session.id, input.trim()).then(() => setInput("")).catch(e => setError(String(e))).finally(() => setBusy(false))
  }
  const label = snapshot?.status === "running" ? l("Working", "执行中") : snapshot?.status === "ready" ? l("Ready", "就绪") : snapshot?.status === "error" ? l("Connection error", "连接异常") : l("Connecting", "连接中")
  return <section className="codex-workbench">
    <header className="view-header"><div><span className="view-eyebrow">ROCKER / WORKSPACE / {session.label}</span><h1>{session.label}</h1><p>{snapshot?.profile.source} · {snapshot?.profile.cwd}</p></div><div className="view-header-actions"><span role="status">{label}</span><button className="secondary-command" disabled={!snapshot} onClick={() => { if (snapshot) onNew(snapshot.profile, true) }}><Plus size={15} />{l("New session", "新建会话")}</button><button className="secondary-command" disabled={!bridge || !snapshot || snapshot.status === "connecting" || snapshot.status === "error"} onClick={() => run(bridge?.terminal(session.id, snapshot?.terminal.open ? "close" : "open"))}><TerminalSquare size={15} />{snapshot?.terminal.open ? l("Close terminal", "关闭终端") : "Terminal"}</button></div></header>
    {(error || snapshot?.error) && <div className="workbench-error" role="alert">{error || snapshot?.error}{snapshot?.status === "error" && <button className="secondary-command" onClick={() => run(bridge?.reconnect(session.id).then(receive))}>{l("Reconnect", "重新连接")}</button>}</div>}
    <div className="workbench-conversation" ref={log} onScroll={event => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }} aria-label={l("Codex conversation", "Codex 对话")}>
      {!snapshot?.items.length && <div className="workbench-empty"><h2>{l("What would you like to work on?", "准备在这个项目中做什么？")}</h2><p>{l("Codex works in this workspace's project directory.", "Codex 将在此工作环境的项目目录中执行任务。")}</p></div>}
      {snapshot?.items.map(item => item.role === "tool" ? <details className="workbench-tool" key={item.id}><summary>{item.text.split("\n")[0].slice(0, 160)}</summary><pre>{item.text}</pre></details> : <article className="workbench-message" data-role={item.role} key={item.id}><strong>{item.role === "user" ? l("You", "你") : "Codex"}</strong><p>{item.text}</p></article>)}
      {snapshot?.approvals.map(approval => <Approval key={approval.id} approval={approval} onApprove={accept => run(bridge?.approve(session.id, approval.id, accept))} onAnswer={answers => run(bridge?.answer(session.id, approval.id, answers))} />)}
    </div>
    <form className="workbench-composer" onSubmit={event => { event.preventDefault(); send() }}><textarea aria-label={l("Message Codex", "发送给 Codex")} placeholder={l("Describe a task…", "描述要完成的任务…")} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }} /><div>{snapshot?.status === "running" ? <button type="button" className="secondary-command" disabled={!snapshot.turnId} onClick={() => run(bridge?.interrupt(session.id))}><Square size={14} />{l("Stop", "停止")}</button> : <button className="primary-command" disabled={!input.trim() || busy || snapshot?.status !== "ready"}><Send size={15} />{l("Send", "发送")}</button>}</div></form>
    {snapshot?.terminal.error && <p role="alert">{snapshot.terminal.error}</p>}
    {bridge && snapshot?.terminal.open && <AuxTerminal bridge={bridge} id={session.id} output={snapshot.terminal.output} active={active} onError={setError} />}
  </section>
}

function Approval({ approval, onApprove, onAnswer }: { approval: WorkbenchApproval; onApprove(accept: boolean): void; onAnswer(answers: Record<string, string>): void }) {
  const l = useWorkbenchText(), [answers, setAnswers] = useState<Record<string, string>>({})
  return <div className="workbench-approval"><strong>{approval.questions ? l("Codex needs your input", "Codex 需要你的补充") : l("Approval required", "需要确认")}</strong><pre>{approval.description}</pre>{approval.questions ? <form onSubmit={e => { e.preventDefault(); onAnswer(answers) }}>{approval.questions.map(q => <label key={q.id}>{q.question}{q.options.length ? <select required value={answers[q.id] ?? ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}><option value="">{l("Choose an answer", "请选择")}</option>{q.options.map(o => <option key={o}>{o}</option>)}</select> : <input required value={answers[q.id] ?? ""} onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))} />}</label>)}<button className="primary-command">{l("Continue", "继续")}</button></form> : <div><button className="secondary-command" onClick={() => onApprove(false)}>{l("Decline", "拒绝")}</button><button className="primary-command" onClick={() => onApprove(true)}>{l("Allow once", "仅允许本次")}</button></div>}</div>
}

function AuxTerminal({ bridge, id, output, active, onError }: { bridge: WorkbenchBridge; id: string; output: string; active: boolean; onError(error: string): void }) {
  const container = useRef<HTMLDivElement>(null), terminal = useRef<Terminal>(undefined), previous = useRef("")
  useEffect(() => {
    if (!container.current) return
    const instance = new Terminal({ fontFamily: "Consolas, monospace", fontSize: 14, scrollback: 2000 }), fit = new FitAddon()
    instance.loadAddon(fit); instance.open(container.current); terminal.current = instance; previous.current = ""
    const resize = () => { if (!container.current?.clientWidth || !container.current.clientHeight) return; fit.fit(); void bridge.terminal(id, "resize", undefined, instance.cols, instance.rows).catch(e => onError(String(e))) }
    const observer = new ResizeObserver(resize); observer.observe(container.current)
    const input = instance.onData(data => { void bridge.terminal(id, "write", data).catch(e => onError(String(e))) })
    resize()
    return () => { observer.disconnect(); input.dispose(); instance.dispose(); terminal.current = undefined }
  }, [bridge, id, onError])
  useEffect(() => {
    if (!terminal.current) return
    if (!output.startsWith(previous.current)) { terminal.current.reset(); previous.current = "" }
    terminal.current.write(output.slice(previous.current.length)); previous.current = output
  }, [output, active])
  return <div className="workbench-terminal" ref={container} aria-label="Terminal" />
}
