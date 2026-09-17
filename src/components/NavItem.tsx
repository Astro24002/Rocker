import type { LucideIcon } from "lucide-react"

interface NavItemProps {
  icon: LucideIcon
  label: string
  active: boolean
  onClick(): void
}

export function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button aria-current={active ? "page" : undefined} aria-label={label} className="nav-item" data-active={active} title={label} type="button" onClick={onClick}>
      <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  )
}
