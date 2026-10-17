import { Cpu } from 'lucide-react'
import { Ring } from '../components/Ring'
import { Widget } from '../components/Widget'
import { useNow } from '../lib/useNow'
import { native, type ClaudeStats } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

// Browser fallback (the desktop app reads Claude Code's transcripts instead)
const SAMPLE: ClaudeStats = {
  session: { at: 0, model: 'claude-opus-5-5', label: 'Opus 5.5', window: 1_000_000, contextTokens: 312_000, cwd: 'agent-office', effort: 'high' },
  today: { input: 900, output: 380_000, cacheRead: 61_000_000, cacheWrite: 640_000, costUsd: 21.4, requests: 310 },
  budgetUsd: 50,
  limits: { fiveHour: { pct: 36, resetsAt: Date.now() + 47 * 60000 }, sevenDay: { pct: 20, resetsAt: Date.now() + 4.9 * 86400000 } },
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', window: 1_000_000, input: 4, output: 20 },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', window: 1_000_000, input: 2, output: 10 },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', window: 1_000_000, input: 0.1, output: 0.5 },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', window: 1_000_000, input: 10, output: 50 },
  ],
}

const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

/** "2h 14m" / "3d 4h" until a reset time */
function until(at: number | null | undefined, now: number) {
  if (!at) return ''
  const m = Math.max(0, Math.round((at - now) / 60000))
  if (m >= 60 * 24) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}m`
}

export function ClaudeMetrics() {
  const live = useOfficeStore((s) => s.claudeStats)
  const stats = native ? live : SAMPLE
  const now = useNow(true, 30_000)

  if (!stats)
    return (
      <Widget title="claude.usage" icon={Cpu}>
        <p className="text-[12px] text-dim">Reading Claude Code transcripts…</p>
      </Widget>
    )

  const { session, today, budgetUsd, limits } = stats
  const ctxPct = session ? (session.contextTokens / session.window) * 100 : 0
  const five = limits?.fiveHour
  const week = limits?.sevenDay
  const alert = (five?.pct ?? 0) >= 90 || (week?.pct ?? 0) >= 90

  return (
    <Widget
      title="claude.usage"
      icon={Cpu}
      tone={alert ? 'alert' : 'default'}
      status={
        <span title={limits?.error ? `Plan limits: ${limits.error}` : 'Plan limits from claude.ai, refreshed every minute'}>
          {!native && <span className="text-orange">sample </span>}
          {limits?.error && <span className="text-orange">stale </span>}
          {today.requests} req today
        </span>
      }
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex items-start justify-around gap-1">
          <Ring
            pct={five?.pct ?? 0}
            caption="5h limit"
            sub={five ? `resets ${until(five.resetsAt, now)}` : (limits?.error ?? 'reading…')}
            center={five ? undefined : <span className="text-[10px] text-dim">--</span>}
            label="Plan usage in the current 5-hour window"
          />
          <Ring
            pct={week?.pct ?? 0}
            caption="weekly"
            sub={week ? `resets ${until(week.resetsAt, now)}` : '—'}
            center={week ? undefined : <span className="text-[10px] text-dim">--</span>}
            label="Plan usage this week"
          />
          <Ring
            pct={ctxPct}
            caption="context"
            sub={session ? `${compact(session.contextTokens)}/${compact(session.window)}` : 'no session'}
            label="Context window used by the live Claude Code session"
          />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-dim">session</dt>
          <dd className="truncate text-ink" title={session?.cwd ?? ''}>
            {session ? `${session.label}${session.effort ? `, ${session.effort}` : ''}${session.cwd ? `, ${session.cwd}` : ''}` : 'none today'}
          </dd>
          <dt className="text-dim">today</dt>
          <dd className="truncate text-ink tabular-nums" title="API-equivalent cost of today's tokens against the daily budget in settings.json">
            ${today.costUsd.toFixed(today.costUsd < 10 ? 2 : 0)} / ${budgetUsd} · {compact(today.output)} out, {compact(today.cacheRead)} cached
          </dd>
        </dl>
      </div>
    </Widget>
  )
}
