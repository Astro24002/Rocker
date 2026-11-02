import { Cloud, FolderOpen, Laptop, Pencil, Plus, Server, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { WorkbenchBridge, WorkbenchProfile } from "../../../electron/workbench/types"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import "./workbench.css"

export function useWorkbenchText(): (en: string, zh: string) => string {
  const { locale } = useI18n()
  return (en, zh) => locale === "zh-CN" ? zh : en
}
export function WorkbenchDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; ref.current?.showModal(); return () => previous?.focus() }, [])
  return <dialog className="workbench-dialog" ref={ref} onCancel={event => { event.preventDefault(); onClose() }} aria-label={title} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><h2>{title}</h2><button type="button" aria-label="Close" onClick={onClose}><X size={18} /></button></header>{children}
  </dialog>
}

export function WorkspacesView({ bridge, hosts, onOpen }: { bridge?: WorkbenchBridge; hosts: readonly HostProfile[]; onOpen(profile: WorkbenchProfile, fresh?: boolean): void }) {
  const l = useWorkbenchText()
  const [profiles, setProfiles] = useState<WorkbenchProfile[]>([])
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState<WorkbenchProfile>()
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const refresh = () => bridge?.list().then(setProfiles).catch(e => setError(String(e)))
  useEffect(() => { let current = true; void bridge?.list().then(p => { if (current) setProfiles(p) }).catch(e => { if (current) setError(String(e)) }); return () => { current = false } }, [bridge])
  const update = (change: Partial<WorkbenchProfile>) => setEditing(current => current ? { ...current, ...change } : current)
  return <section className="workspaces-view">
    <header className="view-header"><div><span className="view-eyebrow">ROCKER / WORKSPACE</span><h1>Workspace</h1><p>{l("Your projects, powered by Codex.", "在本地、远程与云端使用 Codex 工作。")}</p></div><button className="primary-command" disabled={!bridge} onClick={() => { setError(""); setEditing({ id: crypto.randomUUID(), name: "", source: "local", cwd: "", executable: "codex" }) }}><Plus size={16} />{l("New workspace", "新建工作环境")}</button></header>
    <div className="workspaces-content">
      {!bridge && <p>{l("Open the desktop client to connect to Codex. Browser preview cannot run local or remote processes.", "请在桌面客户端连接 Codex。浏览器预览无法运行本地或远程进程。")}</p>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="workspaces-grid">{profiles.map(p => {
        const Icon = p.source === "local" ? Laptop : p.source === "cloud" ? Cloud : Server
        return <article className="workspaces-card" data-selected={selected === p.id} key={p.id}>
          <button className="workspaces-card-main" onClick={() => setSelected(p.id)} onDoubleClick={() => onOpen(p)} onKeyDown={event => { if (event.key === "Enter") onOpen(p) }} aria-label={p.name}><Icon size={26} /><span><strong>{p.name}</strong><small>{p.source} {p.hostId ? ` / ${hosts.find(h => h.id === p.hostId)?.name ?? l("Host unavailable", "主机不可用")}` : ""}</small><code title={p.cwd}>{p.cwd}</code></span></button>
          <div className="workspaces-card-actions"><button aria-label={l("Open workspace", "打开工作环境")} onClick={() => onOpen(p)}><FolderOpen size={16} /></button><button aria-label={l("Edit workspace", "编辑工作环境")} onClick={() => { setError(""); setEditing({ ...p }) }}><Pencil size={16} /></button><button aria-label={l("Delete workspace", "删除工作环境")} onClick={() => { if (window.confirm(l("Delete this workspace configuration? Open sessions keep running.", "删除此工作环境配置？已打开的会话会继续运行。"))) void bridge?.remove(p.id).then(refresh).catch(e => setError(String(e))) }}><Trash2 size={16} /></button></div>
        </article>
      })}</div>
      {bridge && profiles.length === 0 && <div className="workbench-empty"><FolderOpen size={32} /><h2>{l("Choose where to work", "选择工作环境")}</h2><p>{l("Add a project directory on this computer or an SSH Host. Codex must be installed and signed in on that machine.", "添加本机或 SSH 主机上的项目目录。目标机器需要安装 Codex 并完成登录。")}</p></div>}
    </div>
    {editing && <WorkbenchDialog title={l("Workspace settings", "工作环境设置")} onClose={() => { if (!saving) setEditing(undefined) }}>
      <form className="workbench-form" onSubmit={event => { event.preventDefault(); if (!bridge) return; setSaving(true); void bridge.save(editing).then(async () => { await refresh(); setEditing(undefined) }).catch(e => setError(String(e))).finally(() => setSaving(false)) }}>
        <label>{l("Name", "名称")}<input autoFocus required maxLength={256} value={editing.name} onChange={e => update({ name: e.target.value })} /></label>
        <label>{l("Source", "来源")}<select value={editing.source} onChange={e => update({ source: e.target.value as WorkbenchProfile["source"] })}><option value="local">Local</option><option value="remote">Remote</option><option value="cloud">Cloud</option></select></label>
        {editing.source !== "local" && <label>{l("SSH Host", "SSH 主机")}<select required value={editing.hostId ?? ""} onChange={e => update({ hostId: e.target.value })}><option value="">{l("Choose a saved Host", "选择已保存的主机")}</option>{hosts.map(h => <option value={h.id} key={h.id}>{h.name} · {h.username}@{h.host}</option>)}</select><small>{l("For Cloud, save the supplied SSH address in Hosts first.", "Cloud 请先在 Hosts 保存提供给你的 SSH 连接信息。")}</small></label>}
        <label>{l("Project directory", "项目目录")}<input required value={editing.cwd} onChange={e => update({ cwd: e.target.value })} placeholder={editing.source === "local" ? l("Choose an existing directory", "选择已有目录") : "/home/user/project"} /></label>
        {editing.source === "local" && <button type="button" className="secondary-command" onClick={() => void bridge?.chooseDirectory().then(path => { if (path) update({ cwd: path }) }).catch(e => setError(String(e)))}><FolderOpen size={15} />{l("Choose directory", "选择目录")}</button>}
        <label>{l("Codex executable", "Codex 可执行文件")}<input required value={editing.executable} onChange={e => update({ executable: e.target.value })} /><small>{l("Use an absolute path if Codex is not on the machine's PATH.", "若 Codex 不在目标机器的 PATH 中，请填写绝对路径。")}</small></label>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <button className="primary-command" disabled={saving}>{l("Save workspace", "保存工作环境")}</button>
      </form>
    </WorkbenchDialog>}
  </section>
}
