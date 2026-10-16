// One interactive shell per app, run through pty_bridge.py (no native modules).
// Output is kept in a backlog so a remounted terminal widget can redraw it.
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

class PtySession {
  constructor(send) {
    this.send = send // (channel, payload) => void
    this.proc = null
    this.backlog = ''
    this.shell = null
  }

  /** Start the shell if needed; returns what the widget needs to (re)draw. */
  start(cols, rows) {
    if (this.proc) {
      this.resize(cols, rows)
      return { shell: this.shell, backlog: this.backlog, restarted: false }
    }
    const sh = shellCommand()
    this.shell = sh.name
    this.backlog = ''
    const proc = spawn('python3', [BRIDGE, String(cols), String(rows), ...sh.argv], {
      cwd: os.homedir(),
      env: { ...process.env, SHELL: sh.argv[0], AGENT_OFFICE_GRID: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    })
    this.proc = proc
    const decoder = new StringDecoder('utf8')
    proc.stdout.on('data', (chunk) => {
      const text = decoder.write(chunk)
      if (!text) return
      this.backlog = (this.backlog + text).slice(-BACKLOG_MAX)
      this.send('pty:data', text)
    })
    proc.stderr.on('data', (chunk) => this.send('pty:data', `\r\n[bridge] ${chunk}`))
    proc.on('exit', (code) => {
      if (this.proc !== proc) return
      this.proc = null
      this.send('pty:exit', { code })
    })
    if (sh.greet) setTimeout(() => this.write(sh.greet), 300)
    return { shell: this.shell, backlog: '', restarted: true }
  }

  write(data) {
    if (this.proc && typeof data === 'string') this.proc.stdin.write(data)
  }

  resize(cols, rows) {
    const c = Math.floor(cols)
    const r = Math.floor(rows)
    if (this.proc && c > 0 && r > 0) this.proc.stdio[3].write(`${c} ${r}\n`)
  }

  kill() {
    if (!this.proc) return
    const proc = this.proc
    this.proc = null
    proc.kill('SIGTERM')
  }
}

module.exports = { PtySession }
