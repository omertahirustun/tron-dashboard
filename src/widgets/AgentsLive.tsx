import { Bot, GitBranch, Plus, ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { formatDuration, useNow } from '../lib/useNow'
import { native, type AgentActivity, type LiveSession, type PermissionHookStatus, type PermissionRequest } from '../native/api'
import { useSessions } from '../native/useSessions'
import { useOfficeStore } from '../store/useOfficeStore'
import { PermissionPrompt } from './agents/PermissionPrompt'

// Every Claude Code session of the last hours as a card: what it is doing right
// now (thinking, which tool on what, or waiting for you), its subagents, and
// its permission prompts (answered right on the card). Clicking a card opens
// the agent console, and focuses its latest file in the graph underneath.

// cards closed with ×: session id -> its lastAt then; it comes back on new activity
const HIDDEN_KEY = 'aod.agents.hidden.v1'
function loadHidden(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '{}')
  } catch {
    return {}
  }
}
/** hide a card; entries of sessions no longer listed at all are dropped */
function withHidden(hidden: Record<string, number>, all: LiveSession[], s: LiveSession) {
  const next = Object.fromEntries(Object.entries(hidden).filter(([id]) => all.some((x) => x.id === id)))
  // a stopped claude may still write a last line to its transcript as it exits
  next[s.id] = Math.max(s.lastAt, Date.now() + 5000)
  return next
}
function saveHidden(hidden: Record<string, number>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden))
  } catch {
    // only for this window
  }
}

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

const now0 = Date.now()
const SAMPLE: LiveSession[] = [
  {
    id: 'sample-1',
    title: 'Live agents panel',
    project: 'agent-office-dashboard',
    cwd: null,
    branch: 'main',
    model: 'claude-opus-5-5',
    lastAt: now0,
    startedAt: now0 - 3_600_000,
    live: true,
    prompt: "1'i yap",
    activity: { state: 'tool', tool: 'Edit', target: 'AgentsLive.tsx', since: now0 - 95_000 },
    pane: null,
    host: 'terminal',
    files: [],
    subagents: [
      {
        id: 'a1',
        description: 'Find session consumers',
        agentType: 'Explore',
        model: 'claude-haiku-5-5',
        lastAt: now0,
        live: true,
        activity: { state: 'tool', tool: 'Grep', target: 'onSessions', since: now0 - 20_000 },
      },
    ],
    skillsUsed: [],
  },
  {
    id: 'sample-2',
    title: 'Compass heading fix',
    project: 'android',
    cwd: null,
    branch: null,
    model: 'claude-opus-5-5',
    lastAt: now0 - 300_000,
    startedAt: now0 - 7_200_000,
    live: false,
    prompt: 'pusulayı düzelt',
    activity: { state: 'waiting', tool: 'Bash', target: 'Run unit tests', since: now0 - 400_000 },
    pane: null,
    host: null,
    files: [],
    subagents: [],
    skillsUsed: [],
  },
]

const working = (a: AgentActivity | null | undefined) => a?.state === 'thinking' || a?.state === 'tool'
const RANK = { tool: 0, thinking: 0, waiting: 1, idle: 2 } as const

/** "claude-opus-5-5" → "opus 5.5" */
function modelLabel(id: string | null) {
  if (!id) return null
  const m = id.replace(/^claude-/, '').match(/^([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1]} ${m[2]}.${m[3]}` : id.replace(/^claude-/, '')
}

function ago(ms: number) {
  const m = Math.round(ms / 60_000)
  return m < 1 ? 'now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`
}

/** One status line: diamond, state word, tool and target, elapsed time */
function ActivityLine({ activity, now, sub }: { activity: AgentActivity; now: number; sub?: boolean }) {
  const busy = working(activity)
  const word =
    activity.state === 'tool'
      ? activity.tool
      : activity.state === 'thinking'
        ? 'thinking'
        : activity.state === 'waiting'
          ? sub
            ? 'done'
            : 'your turn'
          : 'idle'
  const color = busy ? 'text-orange' : activity.state === 'waiting' && !sub ? 'text-cyan' : 'text-dim'
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={`size-1.5 shrink-0 rotate-45 ${
          busy ? 'agent-pulse bg-orange' : activity.state === 'waiting' && !sub ? 'bg-cyan' : 'bg-dim/50'
        }`}
        aria-hidden
      />
      <span lang="en" className={`shrink-0 uppercase tracking-wider ${color}`}>{word}</span>
      {activity.state === 'tool' && activity.target && <span className="min-w-0 truncate text-ink/80">{activity.target}</span>}
      {busy && activity.since > 0 && (
        <span className="ml-auto shrink-0 pl-1 tabular-nums text-dim">{formatDuration(now - activity.since)}</span>
      )}
    </div>
  )
}

/**
 * × on a card. An agent running in the dashboard is stopped (asking first while
 * it is mid-turn); one in another terminal, or not running, just loses its card.
 */
function CloseButton({ session, onClose }: { session: LiveSession; onClose: () => void }) {
  const [armed, setArmed] = useState(false)
  const here = session.host === 'dashboard'
  const confirm = here && working(session.activity)
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm && !armed) {
      setArmed(true)
      return
    }
    sfx.emit('close', { source: 'agents.card-close' })
    if (here) void native?.stopAgent(session.id)
    onClose()
  }
  return (
    <button
      type="button"
      onClick={click}
      onMouseLeave={() => setArmed(false)}
      onKeyDown={(e) => e.stopPropagation()}
      className={`agent-card-close -mr-1 flex shrink-0 items-center gap-0.5 px-0.5 ${armed ? 'text-crit' : 'text-dim hover:text-crit'}`}
      aria-label={here ? 'Stop this agent and close its card' : 'Close this card'}
      title={
        here
          ? armed
            ? 'Mid-turn: click again to stop it'
            : 'Stop this claude and close the card (the session stays resumable)'
          : 'Hide this card (the session itself is not touched); it comes back when it is active again'
      }
    >
      {armed && (
        <span lang="en" className="text-[9px] uppercase tracking-wider">
          stop?
        </span>
      )}
      <X size={12} />
    </button>
  )
}

function AgentCard({ session, now, asks, onClose }: { session: LiveSession; now: number; asks: PermissionRequest[]; onClose: () => void }) {
  const selectFile = useOfficeStore((s) => s.selectFile)
  const setActiveRepo = useOfficeStore((s) => s.setActiveRepo)
  const openConsole = useOfficeStore((s) => s.openConsole)
  const busy = working(session.activity)
  const idle = session.activity.state === 'idle'
  const subs = session.subagents.filter((a) => working(a.activity) || now - a.lastAt < 15 * 60_000)

  const open = (el: Element) => {
    if (!native) return
    sfx.emit('click', { source: 'agents.open' })
    openConsole({ sessionId: session.id, cwd: session.cwd, pane: session.pane, origin: rectOf(el) })
    const latest = session.files.find((f) => f.op !== 'read') ?? session.files[0]
    if (latest) selectFile(latest.path)
    else if (session.cwd) void native.repoOf(session.cwd).then((repo) => repo && setActiveRepo(repo))
  }

  return (
    // a div: the permission buttons inside can't live in a <button>
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        open(e.currentTarget)
      }}
      data-state={asks.length ? 'ask' : busy ? 'busy' : session.activity.state}
      className="agent-card no-drag flex h-full w-64 shrink-0 cursor-pointer flex-col gap-1 border px-2.5 py-2 text-left text-[11px]"
      title={session.cwd ?? undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`min-w-0 truncate font-medium ${idle ? 'text-dim' : 'text-ink'}`}>{session.project ?? 'session'}</span>
        {session.branch && session.branch !== 'HEAD' && (
          <span className="flex min-w-0 shrink items-center gap-0.5 truncate text-[10px] text-dim">
            <GitBranch size={10} className="shrink-0" aria-hidden />
            {session.branch}
          </span>
        )}
        {session.host === 'dashboard' && (
          <span lang="en" className="shrink-0 text-[9px] uppercase tracking-wider text-cyan" title="Runs in the dashboard: click to talk to it">
            here
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-dim">{modelLabel(session.model)}</span>
        {native && <CloseButton session={session} onClose={onClose} />}
      </div>
      {asks.length > 0 ? (
        <>
          <PermissionPrompt request={asks[0]} compact />
          {asks.length > 1 && <p className="text-[10px] text-orange">+{asks.length - 1} more waiting</p>}
        </>
      ) : (
        <CardBody session={session} now={now} subs={subs} busy={busy} />
      )}
    </div>
  )
}

function CardBody({ session, now, subs, busy }: { session: LiveSession; now: number; subs: LiveSession['subagents']; busy: boolean }) {
  return (
    <>
      <ActivityLine activity={session.activity} now={now} />
      <p className="truncate text-[10px] text-dim" title={session.title}>
        {session.title}
      </p>
      {session.prompt && (
        <p className="line-clamp-2 text-[10px] leading-snug text-ink/70" title={session.prompt}>
          › {session.prompt}
        </p>
      )}
      {subs.length > 0 && (
        <ul className="mt-auto space-y-0.5 border-t border-cyan-line/40 pt-1 text-[10px]" aria-label="Subagents">
          {subs.slice(0, 3).map((a) => (
            <li key={a.id} className="flex min-w-0 items-center gap-1.5" title={a.description}>
              <span className="shrink-0 text-cyan/80">{a.agentType}</span>
              <div className="min-w-0 flex-1">
                {a.activity ? <ActivityLine activity={a.activity} now={now} sub /> : <span className="text-dim">{a.description}</span>}
              </div>
            </li>
          ))}
          {subs.length > 3 && <li className="text-dim">+{subs.length - 3} more</li>}
        </ul>
      )}
      {subs.length === 0 && session.files.length > 0 && (
        <ul className="mt-auto space-y-0.5 border-t border-cyan-line/40 pt-1 text-[10px]" aria-label="Recent files">
          {session.files.slice(0, 3).map((f) => (
            <li key={f.path} className="flex min-w-0 items-center gap-1.5" title={f.path}>
              <span lang="en" className={`w-3 shrink-0 uppercase ${f.op === 'read' ? 'text-dim' : 'text-cyan/80'}`}>{f.op[0]}</span>
              <span className="min-w-0 truncate text-ink/70">{f.path.split('/').pop()}</span>
              <span className="ml-auto shrink-0 text-dim/70">{ago(now - f.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {!busy && subs.length === 0 && session.files.length === 0 && (
        <p className="mt-auto text-[10px] text-dim/70">{ago(now - session.lastAt)}</p>
      )}
    </>
  )
}

export function AgentsLive() {
  const snapshot = useSessions()
  const permissions = useOfficeStore((s) => s.permissions)
  const activeRepo = useOfficeStore((s) => s.activeRepo)
  const openConsole = useOfficeStore((s) => s.openConsole)
  const [hook, setHook] = useState<PermissionHookStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(loadHidden)
  const all = native ? (snapshot?.sessions ?? []) : SAMPLE
  // a hidden card comes back when its session does something new, or asks for permission
  const sessions = all.filter(
    (s) => !(s.id in hidden) || s.lastAt > hidden[s.id] || permissions.some((p) => p.sessionId === s.id),
  )
  const hide = (s: LiveSession) => {
    const next = withHidden(hidden, all, s)
    setHidden(next)
    saveHidden(next)
  }
  const busyCount = sessions.filter((s) => working(s.activity) || s.subagents.some((a) => working(a.activity))).length
  const waitingCount = sessions.filter((s) => s.activity.state === 'waiting').length
  // the elapsed timers only tick while something works
  const now = useNow(busyCount > 0)
  const asking = (id: string) => permissions.filter((p) => p.sessionId === id)
  // asking first, then working, waiting, idle
  const sorted = [...sessions].sort(
    (a, b) =>
      Number(asking(b.id).length > 0) - Number(asking(a.id).length > 0) ||
      RANK[a.activity.state] - RANK[b.activity.state] ||
      b.lastAt - a.lastAt,
  )
  // prompts of sessions without a card (older than the ones listed)
  const orphans = permissions.filter((p) => !all.some((s) => s.id === p.sessionId))

  useEffect(() => {
    if (native) void native.getPermissionHookStatus().then(setHook)
  }, [])

  const fail = (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  const installHook = () => {
    setError(null)
    native?.installPermissionHook().then(setHook, fail)
  }
  const newAgent = (el: Element) => {
    if (!native) return
    setError(null)
    const origin = rectOf(el)
    native.startAgent({ cwd: activeRepo }).then((r) => openConsole({ sessionId: r.sessionId, pane: r.pane, cwd: activeRepo, origin }), fail)
  }

  return (
    <Widget
      title="agents.live"
      icon={Bot}
      flush
      tone={permissions.length ? 'alert' : 'default'}
      status={
        <>
          {!native && <span className="text-orange">sample </span>}
          {permissions.length > 0 && <span className="text-orange">{permissions.length} asking ·</span>}
          <span className={busyCount ? 'text-orange' : ''}>{busyCount} working</span>
          <span>· {waitingCount} waiting</span>
        </>
      }
      actions={
        native && (
          <>
            {hook && !hook.installed && (
              <TronButton
                sfxSource="agents.install-hook"
                variant="alert"
                onClick={installHook}
                title="Adds an HTTP PermissionRequest hook to ~/.claude/settings.json (backup: settings.json.bak-agent-office-grid). The terminal still asks too; whichever answers first wins."
              >
                <ShieldCheck size={12} /> route permissions here
              </TronButton>
            )}
            <TronButton
              sfxSource="agents.new"
              onClick={(e) => newAgent(e.currentTarget)}
              aria-label="New agent"
              title={`Start claude in ${activeRepo ?? 'your home folder'}`}
            >
              <Plus size={12} />
            </TronButton>
          </>
        )
      }
    >
      {(error || hook?.error) && <p className="px-3 pt-2 text-[11px] text-crit">{error ?? hook?.error}</p>}
      {native && !snapshot ? (
        <p className="p-3 text-[12px] text-dim">Reading sessions…</p>
      ) : sorted.length === 0 && orphans.length === 0 ? (
        <p className="p-3 text-[12px] text-dim">No Claude Code session in the last 6 hours. Start one with +.</p>
      ) : (
        <div className="flex h-full gap-2 overflow-x-auto overflow-y-hidden p-2" aria-label="Claude Code sessions">
          {orphans.map((p) => (
            <div key={p.id} className="agent-card flex h-full w-64 shrink-0 flex-col gap-1 border px-2.5 py-2 text-[11px]" data-state="ask">
              <span className="truncate font-medium text-ink">{p.project ?? 'session'}</span>
              <PermissionPrompt request={p} compact />
            </div>
          ))}
          {sorted.map((s) => (
            <AgentCard key={s.id} session={s} now={now} asks={asking(s.id)} onClose={() => hide(s)} />
          ))}
        </div>
      )}
    </Widget>
  )
}
