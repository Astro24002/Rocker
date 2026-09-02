import { Ellipsis, Import, Plus, Search, Server, Star } from "lucide-react"
import { useMemo, useState } from "react"
import type { HostProfile } from "../../app/types"
import { useI18n } from "../../i18n"
import { IconButton } from "../../components/IconButton"
import { filterHosts } from "./host-state"

interface HostListProps {
  hosts: HostProfile[]
  disabled?: boolean
  onConnect(host: HostProfile): void
  onAdd(): void
  onEdit(host: HostProfile): void
  onImport(): void
  onFavorite(host: HostProfile): void
}

export function HostList({ hosts, disabled = false, onConnect, onAdd, onEdit, onImport, onFavorite }: HostListProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState("all")
  const groups = useMemo(() => [...new Set(hosts.map((host) => host.group).filter(Boolean))] as string[], [hosts])
  const filtered = filterHosts(hosts, group, query)

  return (
    <section className="hosts-view">
      <header className="view-header host-list-header">
        <div>
          <span className="view-eyebrow">Rocker / {t("workspace.personal")}</span>
          <h1>{t("hosts.title")}</h1>
          <p>{t("hosts.subtitle")}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onImport() }}><Import size={15} />{t("hosts.import")}</button>
          <button className="primary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onAdd() }}><Plus size={15} />{t("hosts.add")}</button>
        </div>
      </header>

      <div className="host-browser">
        <aside className="host-groups">
          <button data-active={group === "all"} type="button" onClick={() => setGroup("all")}>All hosts <span>{hosts.length}</span></button>
          {groups.map((name) => (
            <button key={name} data-active={group === name} type="button" onClick={() => setGroup(name)}>{name}<span>{hosts.filter((host) => host.group === name).length}</span></button>
          ))}
        </aside>
        <div className="host-content">
          <label className="search-field">
            <Search aria-hidden="true" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("common.search")} />
          </label>

          {filtered.length === 0 ? (
            <div className="empty-workspace compact-empty">
              <div className="empty-symbol"><Server size={24} strokeWidth={1.5} /></div>
              <h2>{t("hosts.emptyTitle")}</h2>
              <p>{t("hosts.emptyBody")}</p>
              <button className="primary-command" type="button" disabled={disabled} onClick={() => { if (!disabled) onAdd() }}><Plus size={15} />{t("hosts.add")}</button>
            </div>
          ) : (
            <div className="host-table" role="list">
              <div className="host-table-heading"><span>Host</span><span>Address</span><span>User</span><span>Group</span><span /></div>
              {filtered.map((host) => (
                <div key={host.id} className="host-row" role="listitem" onDoubleClick={() => { if (!disabled) onConnect(host) }}>
                  <button className="host-identity" type="button" disabled={disabled} onClick={() => { if (!disabled) onConnect(host) }}>
                    <span className="host-avatar"><Server size={15} /></span>
                    <span><strong>{host.name}</strong><small>SSH · {host.port}</small></span>
                  </button>
                  <span className="host-address">{host.host}</span>
                  <span>{host.username}</span>
                  <span>{host.group || "—"}</span>
                  <div className="host-row-actions">
                    <IconButton label="Favorite" disabled={disabled} className={host.favorite ? "is-favorite" : ""} onClick={() => { if (!disabled) onFavorite(host) }}><Star size={14} fill={host.favorite ? "currentColor" : "none"} /></IconButton>
                    <IconButton label={t("common.more")} disabled={disabled} onClick={() => { if (!disabled) onEdit(host) }}><Ellipsis size={15} /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
