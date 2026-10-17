import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { sfx } from '../../lib/sfx'
import { native, type PermissionRequest } from '../../native/api'

/**
 * A Claude Code permission prompt with Allow / Always / Deny. The same prompt
 * is open in the agent's terminal too; whichever answers first wins.
 */
export function PermissionPrompt({ request, compact }: { request: PermissionRequest; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const decide = (decision: 'allow' | 'always' | 'deny') => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!native || busy) return
    setBusy(true)
    sfx.emit('click', { source: `permission.${decision}` })
    void native.decidePermission(request.id, decision).finally(() => setBusy(false))
  }

  return (
    <div
      className={`permission-prompt no-drag flex flex-col gap-1 border border-orange/70 bg-orange-soft text-[11px] ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
      role="alert"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <ShieldAlert size={compact ? 11 : 13} className="shrink-0 text-orange" aria-hidden />
        <span lang="en" className="shrink-0 font-medium uppercase tracking-wider text-orange">{request.tool}</span>
        {request.description && <span className="min-w-0 truncate text-ink/80">{request.description}</span>}
      </div>
      <code
        className={`block break-all text-ink ${compact ? 'line-clamp-2 text-[10px]' : 'max-h-28 overflow-auto whitespace-pre-wrap'}`}
        title={request.detail}
      >
        {request.detail}
      </code>
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button type="button" disabled={busy} onClick={decide('allow')} lang="en" className="perm-btn perm-allow">
          allow
        </button>
        {request.always && (
          <button
            type="button"
            disabled={busy}
            onClick={decide('always')}
            lang="en"
            className="perm-btn perm-always min-w-0"
            title={`Always allow: ${request.always}`}
          >
            <span className="truncate">always{compact ? '' : `: ${request.always}`}</span>
          </button>
        )}
        <button type="button" disabled={busy} onClick={decide('deny')} lang="en" className="perm-btn perm-deny">
          deny
        </button>
      </div>
    </div>
  )
}
