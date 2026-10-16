import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Cpu } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Widget } from '../components/Widget'
import { sfx } from '../lib/sfx'
import { native, type ClaudeStats } from '../native/api'
import { loadLevel, type LoadLevel } from '../services/telemetry'
import { useOfficeStore, type ChatModel } from '../store/useOfficeStore'

// Browser fallback (the desktop app reads Claude Code's transcripts instead)
const SAMPLE: ClaudeStats = {
  session: { at: 0, model: 'claude-opus-5-5', label: 'Opus 5.5', window: 1_000_000, contextTokens: 312_000, cwd: 'agent-office', effort: 'high' },
  today: { input: 900, output: 380_000, cacheRead: 61_000_000, cacheWrite: 640_000, costUsd: 21.4, requests: 310 },
  budgetUsd: 50,
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', window: 1_000_000, input: 4, output: 20 },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', window: 1_000_000, input: 2, output: 10 },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', window: 1_000_000, input: 0.1, output: 0.5 },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', window: 1_000_000, input: 10, output: 50 },
  ],
}

const ring: Record<LoadLevel, string> = {
  normal: 'var(--color-cyan)',
  heavy: 'var(--color-orange)',
  critical: 'var(--color-crit)',
}

const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)

function RadialGauge({ pct, value, caption, label }: { pct: number; value: string; caption: string; label: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, pct))
  const level = loadLevel(clamped)
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div className="relative size-[84px]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
        <svg viewBox="0 0 84 84" className="size-full -rotate-90" aria-hidden>
          <circle cx="42" cy="42" r={r} fill="none" stroke="rgb(13 230 255 / 0.1)" strokeWidth="6" />
          {/* tick ring */}
          <circle cx="42" cy="42" r={r + 6} fill="none" stroke="rgb(13 230 255 / 0.18)" strokeWidth="1" strokeDasharray="1 5.6" />
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke={ring[level]}
            strokeWidth="6"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - clamped / 100)}
            style={{ transition: 'stroke-dashoffset 0.6s ease-out, stroke 0.3s', filter: `drop-shadow(0 0 4px ${ring[level]})` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[15px] leading-none font-bold tabular-nums" style={{ color: ring[level] }}>
            {Math.round(clamped)}
            <span className="text-[10px] text-dim">%</span>
          </span>
          <span className="mt-0.5 text-[10px] text-dim tabular-nums">{value}</span>
        </div>
      </div>
      <figcaption className="text-center text-[11px] text-ink">{caption}</figcaption>
    </figure>
  )
}

function ModelSelect({ models }: { models: ClaudeStats['models'] }) {
  const model = useOfficeStore((s) => s.chatModel)
  const setModel = useOfficeStore((s) => s.setChatModel)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const current = models.find((m) => m.id === model) ?? models[0]

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const choose = (id: string) => {
    setModel(id as ChatModel)
    setOpen(false)
    sfx.emit('select', { source: 'claude.model', model: id })
    useOfficeStore.getState().addTerminalLog(`[LOG] Chat model set to ${models.find((m) => m.id === id)?.label}`, { source: 'claude', level: 'ok' })
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setActive(Math.max(0, models.findIndex((m) => m.id === model)))
        return setOpen(true)
      }
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : models.length - 1)) % models.length)
    }
    if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      choose(models[active].id)
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.97 }}
        onMouseEnter={() => sfx.emit('hover', { source: 'claude.model' })}
        onClick={() => {
          setActive(Math.max(0, models.findIndex((m) => m.id === model)))
          setOpen((o) => !o)
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Chat model"
        className="flex w-full items-center gap-2 border border-cyan-line bg-cyan-soft px-2.5 py-1.5 text-left text-[12px] text-cyan transition-colors hover:border-cyan"
      >
        <span className="font-bold">{current?.label}</span>
        <span className="truncate text-[10px] text-dim">
          ${current?.input}/${current?.output} per 1M, {compact(current?.window ?? 0)} ctx
        </span>
        <ChevronDown size={13} className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label="Models"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-full z-20 mt-1 border border-cyan bg-[#04090c] shadow-glow"
          >
            {models.map((m, i) => (
              <li
                key={m.id}
                role="option"
                aria-selected={m.id === model}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m.id)}
                className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] ${
                  i === active ? 'bg-cyan-soft text-cyan' : 'text-ink'
                }`}
              >
                <Check size={12} className={m.id === model ? 'text-cyan' : 'invisible'} aria-hidden />
                <span className="font-medium">{m.label}</span>
                <span className="ml-auto text-[10px] text-dim tabular-nums">
                  ${m.input} / ${m.output}
                </span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

export function ClaudeMetrics() {
  const live = useOfficeStore((s) => s.claudeStats)
  const stats = native ? live : SAMPLE

  if (!stats)
    return (
      <Widget title="claude.metrics" icon={Cpu}>
        <p className="text-[12px] text-dim">Reading Claude Code transcripts…</p>
      </Widget>
    )

  const { session, today, budgetUsd } = stats
  const ctxPct = session ? (session.contextTokens / session.window) * 100 : 0
  const budgetPct = (today.costUsd / budgetUsd) * 100

  return (
    <Widget
      title="claude.metrics"
      icon={Cpu}
      tone={budgetPct > 100 ? 'alert' : 'default'}
      status={
        <>
          {!native && <span className="text-orange">sample </span>}
          {today.requests} req today
        </>
      }
    >
      <div className="flex h-full flex-col gap-3">
        <ModelSelect models={stats.models} />
        <div className="flex items-start justify-around gap-2">
          <RadialGauge
            pct={ctxPct}
            value={session ? `${compact(session.contextTokens)}/${compact(session.window)}` : 'no session'}
            caption="context density"
            label="Context window used by the live Claude Code session"
          />
          <RadialGauge
            pct={budgetPct}
            value={`$${today.costUsd.toFixed(today.costUsd < 10 ? 2 : 0)}/$${budgetUsd}`}
            caption="daily budget"
            label="API-equivalent spend today against the daily budget"
          />
        </div>
        <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-dim">session</dt>
          <dd className="truncate text-ink" title={session?.cwd ?? ''}>
            {session ? `${session.label}${session.effort ? `, ${session.effort} effort` : ''}${session.cwd ? `, ${session.cwd}` : ''}` : 'none today'}
          </dd>
          <dt className="text-dim">tokens</dt>
          <dd className="truncate text-ink tabular-nums">
            {compact(today.output)} out, {compact(today.cacheRead)} cached, {compact(today.input + today.cacheWrite)} new
          </dd>
        </dl>
      </div>
    </Widget>
  )
}
