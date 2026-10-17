import type { LucideIcon } from 'lucide-react'
import { GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'

export interface WidgetProps {
  title: string
  icon: LucideIcon
  /** Small status text on the right of the header */
  status?: ReactNode
  /** Extra header controls (rendered outside the drag handle hit area) */
  actions?: ReactNode
  tone?: 'default' | 'alert'
  /** Remove body padding for edge-to-edge content (graphs, terminals) */
  flush?: boolean
  children: ReactNode
}

/** Glass frame shared by every dashboard panel. The header is the drag handle. */
export function Widget({ title, icon: Icon, status, actions, tone = 'default', flush, children }: WidgetProps) {
  return (
    <section className="widget" data-tone={tone} aria-label={title}>
      {/* HUD brackets on the two rounded corners (the other two are bevelled) */}
      <span className="hud-corner" data-at="tr" aria-hidden />
      <span className="hud-corner" data-at="bl" aria-hidden />
      <header className="widget-handle relative flex h-8 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <GripVertical size={13} className="text-dim" aria-hidden />
        <Icon size={13} className={tone === 'alert' ? 'text-orange' : 'text-cyan'} aria-hidden />
        <h2 lang="en" className="widget-title shrink-0">{title}</h2>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-dim">
          {status}
          {actions && <div className="no-drag flex items-center gap-0.5">{actions}</div>}
        </div>
        {/* lit edge under the header: powers on left to right when the panel boots */}
        <span className="widget-rule" aria-hidden />
      </header>
      <div className={`min-h-0 flex-1 overflow-auto ${flush ? '' : 'p-3'}`}>{children}</div>
    </section>
  )
}
