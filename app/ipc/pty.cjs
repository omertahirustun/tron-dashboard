// Interactive shells for the terminal window's panes and the agent console,
// run through pty_bridge.py (no native modules). Runs inside the PTY host
// (pty-host.cjs), not the app, so the terminals outlive it. Output is kept in a backlog per shell so a reloaded
// window can redraw it.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { StringDecoder } = require('node:string_decoder')

const BRIDGE = path.join(__dirname, '..', 'pty_bridge.py')
const BACKLOG_MAX = 256 * 1024

function which(bin) {
  for (const dir of (process.env.PATH || '').split(':')) {
    const p = path.join(dir, bin)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      /* keep looking */
    }
  }
  return null
}

function shellCommand() {
  const fish = which('fish')
  const fastfetch = which('fastfetch')
  if (fish) return { name: 'fish', argv: [fish, ...(fastfetch ? ['-C', 'fastfetch'] : [])], greet: null }
  const bash = which('bash') || '/bin/sh'
  return { name: path.basename(bash), argv: [bash, '-i'], greet: fastfetch ? 'fastfetch\r' : null }
}

/** Many shells, one per terminal pane, keyed by the pane's id. */
class PtyManager {
  constructor(send) {
    this.send = send // (channel, payload) => void
    this.sessions = new Map() // id -> { proc, backlog, shell }
  }

  /**
   * Start the pane's shell if needed; returns what the pane needs to (re)draw.
   * `spec` runs something else than the login shell: { name, argv, cwd, env }.
   */
  start(id, cols, rows, spec) {
    const key = String(id)
    const existing = this.sessions.get(key)
    if (existing?.proc) {
      this.resize(key, cols, rows)
      return { shell: existing.shell, backlog: existing.backlog, restarted: false }
    }
    const sh = spec ?? shellCommand()
    const session = { proc: null, backlog: '', shell: sh.name }
    const proc = spawn('python3', [BRIDGE, String(Math.max(2, cols | 0)), String(Math.max(2, rows | 0)), ...sh.argv], {
      cwd: spec?.cwd ?? os.homedir(),
      env: { ...(spec?.env ?? process.env), SHELL: sh.argv[0], AGENT_OFFICE_GRID: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })
    session.proc = proc
    this.sessions.set(key, session)
    const decoder = new StringDecoder('utf8')
    proc.stdout.on('data', (chunk) => {
      const data = decoder.write(chunk)
      if (!data) return
      session.backlog = (session.backlog + data).slice(-BACKLOG_MAX)
      this.send('pty:data', { id: key, data })
    })
    proc.stderr.on('data', (chunk) => this.send('pty:data', { id: key, data: `\r\n[bridge] ${chunk}` }))
    proc.on('exit', (code) => {
      if (session.proc !== proc) return
      session.proc = null
      this.send('pty:exit', { id: key, code })
    })
    if (sh.greet) setTimeout(() => this.write(key, sh.greet), 300)
    return { shell: sh.name, backlog: '', restarted: true }
  }

  liveIds() {
    return [...this.sessions].filter(([, s]) => s.proc).map(([id]) => id)
  }

  alive(id) {
    return Boolean(this.sessions.get(String(id))?.proc)
  }

  write(id, data) {
    const proc = this.sessions.get(String(id))?.proc
    if (proc && typeof data === 'string') proc.stdin.write(data)
  }

  resize(id, cols, rows) {
    const proc = this.sessions.get(String(id))?.proc
    const c = Math.floor(cols)
    const r = Math.floor(rows)
    if (proc && c > 0 && r > 0) proc.stdio[3].write(`${c} ${r}\n`)
  }

  /** Close one pane's shell for good (its backlog goes too). */
  kill(id) {
    const key = String(id)
    const proc = this.sessions.get(key)?.proc
    this.sessions.delete(key)
    proc?.kill('SIGTERM')
  }

  killAll() {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}

module.exports = { PtyManager, which }
