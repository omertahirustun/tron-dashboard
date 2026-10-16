// Real task runner: each task is a shell command from settings.json, run in
// its own process group so stopping it also stops its children (npm → node).
const { spawn } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')

const TAIL = 200

function createTasks(settings, emit) {
  /** id -> runtime state */
  const state = new Map()

  const def = (id) => settings.get().tasks.find((t) => t.id === id)

  function snapshot() {
    return settings.get().tasks.map((t) => {
      const s = state.get(t.id) ?? {}
      return {
        id: t.id,
        name: t.name,
        command: t.command,
        cwd: t.cwd,
        longRunning: !!t.longRunning,
        status: s.status ?? 'idle',
        startedAt: s.startedAt ?? null,
        endedAt: s.endedAt ?? null,
        exitCode: s.exitCode ?? null,
        runAt: s.runAt ?? null,
        lastLine: s.lines?.at(-1) ?? '',
      }
    })
  }

  const publish = () => emit('tasks:update', snapshot())

  function start(id) {
    const t = def(id)
    if (!t) throw new Error(`Unknown task: ${id}`)
    const s = state.get(id)
    if (s?.status === 'running') return snapshot()
    clearTimeout(s?.timer)
    const proc = spawn('bash', ['-lc', t.command], {
      cwd: t.cwd,
      detached: true, // own process group
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const next = { status: 'running', startedAt: Date.now(), endedAt: null, exitCode: null, runAt: null, lines: [], proc }
    state.set(id, next)
    const decoder = new StringDecoder('utf8')
    let partial = ''
    const onData = (chunk) => {
      // strip ANSI colour codes and carriage-return progress redraws
      // oxlint-disable-next-line no-control-regex -- matching ESC is the point
      const text = (partial + decoder.write(chunk)).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      const parts = text.split('\n')
      partial = parts.pop() ?? ''
      for (const raw of parts) {
        const line = raw.split('\r').at(-1).trimEnd()
        if (!line) continue
        next.lines.push(line)
        emit('tasks:output', { id, line })
      }
      if (next.lines.length > TAIL) next.lines.splice(0, next.lines.length - TAIL)
      publish()
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', (err) => {
      next.lines.push(err.message)
    })
    proc.on('exit', (code, signal) => {
      next.proc = null
      next.endedAt = Date.now()
      next.exitCode = code
      next.status = signal ? 'stopped' : code === 0 ? 'done' : 'failed'
      publish()
    })
    publish()
    return snapshot()
  }

  function stop(id) {
    const s = state.get(id)
    if (!s) return snapshot()
    if (s.status === 'scheduled') {
      clearTimeout(s.timer)
      state.set(id, { ...s, status: 'idle', runAt: null, timer: null })
    } else if (s.proc) {
      try {
        process.kill(-s.proc.pid, 'SIGTERM') // whole process group
      } catch {
        s.proc.kill('SIGTERM')
      }
    }
    publish()
    return snapshot()
  }

  /** Run a task after `delaySec`; the widget shows the countdown from runAt. */
  function schedule(id, delaySec) {
    if (!def(id)) throw new Error(`Unknown task: ${id}`)
    const sec = Math.max(1, Math.min(24 * 3600, Math.floor(Number(delaySec))))
    const prev = state.get(id)
    if (prev?.status === 'running') throw new Error(`${id} is already running`)
    clearTimeout(prev?.timer)
    const runAt = Date.now() + sec * 1000
    state.set(id, { ...(prev ?? {}), status: 'scheduled', runAt, timer: setTimeout(() => start(id), sec * 1000) })
    publish()
    return snapshot()
  }

  function output(id) {
    return state.get(id)?.lines ?? []
  }

  function stopAll() {
    for (const id of state.keys()) stop(id)
  }

  return { list: snapshot, start, stop, schedule, output, stopAll }
}

module.exports = { createTasks }
