// Live Claude Code activity for the topology graph, from the transcripts in
// ~/.claude/projects: recent sessions, their subagents (subagents/*.meta.json)
// and the files they touched. Transcripts are read incrementally.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const RECENT_MS = 6 * 3600 * 1000 // sessions shown if active in the last 6 h
const LIVE_MS = 30 * 1000 // "working right now"
const MAX_SESSIONS = 4
const MAX_FILES = 6
const MAX_SUBAGENTS = 5
const FILE_TOOLS = { Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'write', NotebookEdit: 'edit' }
// screenshots and scratch files would crowd out the notes and code
const SKIP_FILE = /\.(png|jpe?g|gif|webp|svg|pdf|mp4|webm)$/i
const SKIP_DIR = /^\/tmp\//

function createSessions(emit, intervalMs = 5000) {
  /** transcript path -> parsed state */
  const cache = new Map()
  let timer = null
  let lastJson = ''

  function parse(file, stat) {
    let s = cache.get(file)
    if (!s) {
      s = { offset: 0, id: path.basename(file, '.jsonl'), title: null, cwd: null, branch: null, model: null, lastAt: 0, files: new Map() }
      cache.set(file, s)
    }
    if (stat.size <= s.offset) return s
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(stat.size - s.offset)
      fs.readSync(fd, buf, 0, buf.length, s.offset)
      const text = buf.toString('utf8')
      const end = text.lastIndexOf('\n') + 1
      s.offset += Buffer.byteLength(text.slice(0, end))
      for (const line of text.slice(0, end).split('\n')) {
        if (!line) continue
        let rec
        try {
          rec = JSON.parse(line)
        } catch {
          continue
        }
        if (rec.type === 'ai-title' && rec.aiTitle) s.title = rec.aiTitle
        if (rec.cwd) s.cwd = rec.cwd
        if (rec.gitBranch) s.branch = rec.gitBranch
        const at = Date.parse(rec.timestamp)
        if (at > s.lastAt) s.lastAt = at
        const msg = rec.message
        if (rec.type === 'assistant' && msg?.model) s.model = msg.model
        if (rec.type === 'assistant' && Array.isArray(msg?.content)) {
          for (const block of msg.content) {
            const op = block?.type === 'tool_use' && FILE_TOOLS[block.name]
            const p = op && (block.input?.file_path ?? block.input?.notebook_path)
            if (typeof p === 'string' && !SKIP_FILE.test(p) && !SKIP_DIR.test(p)) s.files.set(p, { path: p, op, at: at || Date.now() })
          }
        }
      }
    } finally {
      fs.closeSync(fd)
    }
    return s
  }

  function subagents(sessionFile, now) {
    const dir = path.join(sessionFile.slice(0, -'.jsonl'.length), 'subagents')
    let names
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.meta.json'))
    } catch {
      return []
    }
    return names
      .map((n) => {
        const id = n.slice(0, -'.meta.json'.length)
        let meta = {}
        try {
          meta = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
        } catch {
          /* still being written */
        }
        let lastAt = 0
        try {
          lastAt = fs.statSync(path.join(dir, `${id}.jsonl`)).mtimeMs
        } catch {
          lastAt = fs.statSync(path.join(dir, n)).mtimeMs
        }
        return {
          id,
          description: meta.description ?? id,
          agentType: meta.agentType ?? 'agent',
          model: meta.model ?? null,
          lastAt,
          live: now - lastAt < LIVE_MS,
        }
      })
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, MAX_SUBAGENTS)
  }

  function scan() {
    const now = Date.now()
    const recent = []
    let dirs = []
    try {
      dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      /* no Claude Code data */
    }
    for (const d of dirs) {
      const dir = path.join(PROJECTS, d.name)
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.jsonl')) continue
        const file = path.join(dir, name)
        const stat = fs.statSync(file)
        if (now - stat.mtimeMs < RECENT_MS) recent.push({ file, stat })
      }
    }
    recent.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    const sessions = recent.slice(0, MAX_SESSIONS).map(({ file, stat }) => {
      const s = parse(file, stat)
      const lastAt = Math.max(s.lastAt, stat.mtimeMs)
      return {
        id: s.id,
        title: s.title ?? 'Untitled session',
        project: s.cwd ? path.basename(s.cwd) : null,
        cwd: s.cwd,
        branch: s.branch,
        model: s.model,
        lastAt,
        live: now - lastAt < LIVE_MS,
        files: [...s.files.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FILES),
        subagents: subagents(file, now),
      }
    })
    // only push when something visible changed
    const json = JSON.stringify(sessions.map((s) => ({ ...s, lastAt: undefined, subagents: s.subagents.map((a) => ({ ...a, lastAt: undefined })) })))
    if (json !== lastJson) {
      lastJson = json
      emit('sessions:update', sessions)
    }
    latest = sessions
  }

  let latest = []
  return {
    start() {
      if (timer) return
      scan()
      timer = setInterval(scan, intervalMs)
    },
    stop() {
      clearInterval(timer)
      timer = null
    },
    latest: () => latest,
  }
}

module.exports = { createSessions }
