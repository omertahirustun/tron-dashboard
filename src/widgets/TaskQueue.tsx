import { motion } from 'framer-motion'
import { Clock, ListChecks, Play, Square, Timer } from 'lucide-react'
import { useState } from 'react'
import { TronButton } from '../components/TronButton'
import { Widget } from '../components/Widget'
import { formatDuration, useNow } from '../lib/useNow'
import { sfx } from '../lib/sfx'
import { native, type TaskInfo } from '../native/api'
import { useOfficeStore } from '../store/useOfficeStore'

const statusStyle: Record<TaskInfo['status'], { glyph: string; color: string; label: string }> = {
  idle: { glyph: '○', color: 'text-dim', label: 'idle' },
  scheduled: { glyph: '◷', color: 'text-cyan', label: 'scheduled' },
  running: { glyph: '●', color: 'text-orange', label: 'running' },
  done: { glyph: '✓', color: 'text-ok', label: 'done' },
  failed: { glyph: '✗', color: 'text-crit', label: 'failed' },
  stopped: { glyph: '■', color: 'text-dim', label: 'stopped' },
}

const DELAYS = [
  { label: '1 min', sec: 60 },
  { label: '5 min', sec: 300 },
  { label: '15 min', sec: 900 },
]

export function TaskQueue() {
  const tasks = useOfficeStore((s) => s.taskQueue)
  const ticking = tasks.some((t) => t.status === 'running' || t.status === 'scheduled')
  const now = useNow(ticking)
  const [scheduling, setScheduling] = useState<string | null>(null)

  const log = useOfficeStore((s) => s.addTerminalLog)
  const fail = (e: unknown) => log(`[TASK] ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { level: 'error', source: 'task' })

  const start = (t: TaskInfo) => {
    sfx.emit('click', { source: 'task.start', task: t.id })
    if (native) return void native.startTask(t.id).catch(fail)
    // browser: simulate a run
    const store = useOfficeStore.getState()
    store.setTasks(store.taskQueue.map((x) => (x.id === t.id ? { ...x, status: 'running', startedAt: Date.now(), runAt: null } : x)))
    setTimeout(() => {
      const s = useOfficeStore.getState()
      s.setTasks(s.taskQueue.map((x) => (x.id === t.id ? { ...x, status: 'done', exitCode: 0, endedAt: Date.now() } : x)))
    }, 3000)
  }

  const stop = (t: TaskInfo) => {
    sfx.emit('click', { source: 'task.stop', task: t.id })
    if (native) return void native.stopTask(t.id).catch(fail)
    const store = useOfficeStore.getState()
    store.setTasks(store.taskQueue.map((x) => (x.id === t.id ? { ...x, status: 'stopped', endedAt: Date.now(), runAt: null } : x)))
  }

  const schedule = (t: TaskInfo, sec: number) => {
    setScheduling(null)
    sfx.emit('click', { source: 'task.schedule', task: t.id })
    if (native) return void native.scheduleTask(t.id, sec).catch(fail)
    const store = useOfficeStore.getState()
    store.setTasks(store.taskQueue.map((x) => (x.id === t.id ? { ...x, status: 'scheduled', runAt: Date.now() + sec * 1000 } : x)))
  }

  const running = tasks.filter((t) => t.status === 'running').length
  return (
    <Widget
      title="task.queue"
      icon={ListChecks}
      status={
        <>
          {!native && <span className="text-orange">sample </span>}
          {running ? <span className="text-orange">{running} running</span> : `${tasks.length} tasks`}
        </>
      }
      flush
    >
      <ul className="@container divide-y divide-cyan-line/30 text-[12px]" aria-label="Tasks">
        {tasks.map((t) => {
          const st = statusStyle[t.status]
          const time =
            t.status === 'running' && t.startedAt
              ? formatDuration(now - t.startedAt)
              : t.status === 'scheduled' && t.runAt
                ? `in ${formatDuration(t.runAt - now)}`
                : t.endedAt && t.startedAt
                  ? formatDuration(t.endedAt - t.startedAt)
                  : ''
          const busy = t.status === 'running' || t.status === 'scheduled'
          return (
            <li key={t.id} className="group relative px-3 py-1.5 hover:bg-cyan/5">
              <div className="flex items-center gap-2">
                <span className={`w-3 shrink-0 text-center ${st.color}`} aria-label={st.label} title={st.label}>
                  {st.glyph}
                </span>
                <span className="min-w-0 truncate text-ink" title={t.cwd ? `${t.command}\n${t.cwd}` : t.command}>
                  {t.name}
                </span>
                <span className="hidden min-w-0 truncate text-[11px] text-dim @md:inline">{t.command}</span>
                <span className={`ml-auto shrink-0 text-[11px] tabular-nums ${t.status === 'scheduled' ? 'text-cyan' : 'text-dim'}`}>
                  {t.status === 'scheduled' && <Timer size={10} className="mr-1 inline" aria-hidden />}
                  {time}
                  {t.status === 'failed' && t.exitCode !== null && ` exit ${t.exitCode}`}
                </span>
                <div className="flex shrink-0 gap-0.5">
                  {busy ? (
                    <TronButton sfxSource="task.stop" variant="alert" onClick={() => stop(t)} aria-label={`Stop ${t.name}`} className="px-1.5! py-0.5!">
                      <Square size={10} />
                    </TronButton>
                  ) : (
                    <>
                      <TronButton sfxSource="task.start" onClick={() => start(t)} aria-label={`Run ${t.name}`} className="px-1.5! py-0.5!">
                        <Play size={10} />
                      </TronButton>
                      {!t.longRunning && (
                        <TronButton
                          sfxSource="task.schedule-menu"
                          onClick={() => setScheduling(scheduling === t.id ? null : t.id)}
                          aria-label={`Schedule ${t.name}`}
                          aria-expanded={scheduling === t.id}
                          className="px-1.5! py-0.5!"
                        >
                          <Clock size={10} />
                        </TronButton>
                      )}
                    </>
                  )}
                </div>
              </div>
              {t.lastLine && (t.status === 'running' || t.status === 'failed') && (
                <p className="mt-0.5 truncate pl-5 text-[10px] text-dim" title={t.lastLine}>
                  {t.lastLine}
                </p>
              )}
              {scheduling === t.id && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-1 flex items-center gap-1 pl-5 text-[11px] text-dim"
                >
                  run in
                  {DELAYS.map((d) => (
                    <TronButton key={d.sec} sfxSource="task.schedule" variant="solid" onClick={() => schedule(t, d.sec)} className="px-1.5! py-0!">
                      {d.label}
                    </TronButton>
                  ))}
                </motion.div>
              )}
            </li>
          )
        })}
      </ul>
    </Widget>
  )
}
