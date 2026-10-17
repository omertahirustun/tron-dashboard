// Claude Code sessions run inside the dashboard: each one is a PTY pane
// ("agent-<session id>") with fish running `claude`, so the agent console can
// show it and you can talk to it. When claude exits, the pane drops to fish
// in the same folder. A session open in some other terminal can be moved
// here: that claude is stopped first (the conversation is in its transcript,
// so --resume continues it), since two processes on one session would clash.
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { which } = require('./pty.cjs')
const { runningSessions } = require('./sessions.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const alive = (pid) => {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'claude'
  } catch {
    return false
  }
}

/** Stop another terminal's claude: SIGTERM, then SIGKILL if it hasn't exited after 5 s. */
async function stopClaude(pid) {
  process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100)
  if (alive(pid)) {
    process.kill(pid, 'SIGKILL')
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(100)
  }
}

// set when the dashboard itself was started from inside a Claude Code session;
// a claude that inherits them thinks it is a child session and saves no transcript
const INHERITED = /^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT)$/
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !INHERITED.test(k)))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function createAgents(pty) {
  // a session's pane is always "agent-<id>", so after an app restart the
  // terminals still running in the PTY host are found again
  const paneId = (sessionId) => `agent-${sessionId}`
  /** session id -> start in progress (stopping another terminal's claude takes a moment) */
  const starting = new Map()

  function command(args) {
    const claude = which('claude')
    if (!claude) throw new Error('claude is not on PATH')
    const line = [claude, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')
    const fish = which('fish')
    if (fish) return { name: 'claude', argv: [fish, '-C', line] }
    const bash = which('bash') || '/bin/sh'
    return { name: 'claude', argv: [bash, '-c', `${line}; exec ${bash} -i`] }
  }

  return {
    /**
     * Start claude in a new pane: a new session (no id) or `--resume` of an
     * existing one. A session open in another terminal is only taken over with
     * `takeOver` (that claude is stopped first). Returns { sessionId, pane }.
     */
    start(opts) {
      const key = opts?.sessionId != null ? String(opts.sessionId) : null
      if (key && starting.has(key)) return starting.get(key)
      const p = this.launch(opts).finally(() => starting.delete(key))
      if (key) starting.set(key, p)
      return p
    },
    async launch({ sessionId, cwd, cols = 120, rows = 32, takeOver = false }) {
      const dir = path.resolve(String(cwd || os.homedir()).replace(/^~(?=$|\/)/, os.homedir()))
      if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`)
      const resume = sessionId != null
      const id = resume ? String(sessionId) : crypto.randomUUID()
      if (!UUID.test(id)) throw new Error('Bad session id')
      const pane = paneId(id)
      if (!pty.alive(pane)) {
        const pid = resume ? runningSessions().get(id) : null
        if (pid) {
          if (!takeOver) throw new Error('This session is open in another terminal')
          await stopClaude(pid)
          if (alive(pid)) throw new Error(`claude (pid ${pid}) did not stop`)
        }
        const spec = { ...command(resume ? ['--resume', id] : ['--session-id', id]), cwd: dir, env: cleanEnv() }
        await pty.start(pane, cols, rows, spec)
      }
      return { sessionId: id, pane }
    },
    /** pane of a session while its process is still running, else null */
    paneOf(sessionId) {
      const pane = paneId(sessionId)
      return pty.alive(pane) ? pane : null
    },
    stop(sessionId) {
      pty.kill(paneId(sessionId))
    },
  }
}

module.exports = { createAgents }
