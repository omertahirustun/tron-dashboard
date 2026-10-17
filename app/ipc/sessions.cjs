// Live Claude Code activity for the topology graph, from the transcripts in
// ~/.claude/projects: recent sessions, their subagents (subagents/*.meta.json),
// the files they touched, the skills they used, and the full list of loaded
// skills (Claude Code records it as a `skill_listing` attachment). Transcripts
// are read incrementally. Each session and subagent also carries what it is
// doing right now (thinking, running a tool, or waiting for the user).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
// Claude Code writes <pid>.json ({ pid, sessionId, … }) here for every running process
const RUNNING = path.join(os.homedir(), '.claude', 'sessions')
const RECENT_MS = 6 * 3600 * 1000 // sessions shown if active in the last 6 h
const LIVE_MS = 30 * 1000 // "working right now"
const MAX_SESSIONS = 8
// a turn that never ended (closed terminal, crash) stops counting as working
const STALE_MS = 10 * 60 * 1000
const MAX_FILES = 6
const MAX_SUBAGENTS = 5
const FILE_TOOLS = { Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'write', NotebookEdit: 'edit' }
// screenshots and scratch files would crowd out the notes and code
const SKIP_FILE = /\.(png|jpe?g|gif|webp|svg|pdf|mp4|webm)$/i
const SKIP_DIR = /^\/tmp\//
const LOG_MAX = 150 // transcript lines kept per session for the agent console
const clip = (text, n) => {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** Short "what" of a tool call: a file name, a command, a pattern. */
function toolTarget(name, input = {}) {
  const file = input.file_path ?? input.notebook_path
  if (typeof file === 'string') return path.basename(file)
  if (name === 'Bash') return clip(input.description || input.command, 60)
  if (name === 'Agent' || name === 'Task') return clip(input.description, 60)
  if (name === 'Skill') return clip(input.skill, 60)
  if (name === 'WebFetch' && typeof input.url === 'string') return clip(input.url.replace(/^https?:\/\//, ''), 60)
  return clip(input.pattern ?? input.query ?? input.prompt ?? '', 60)
}

/** state for the renderer: `tool` while a tool call has no result yet */
function activityOf(s, now) {
  const a = { state: s.state, tool: s.tool, target: s.target, since: s.since }
  if (a.state !== 'waiting' && now - s.lastAt > STALE_MS) a.state = 'idle'
  return a
}

/**
 * `content` is "- name: description" entries, one per skill; descriptions can
 * span lines, so each one runs until the next known name starts.
 */
function parseListing({ names, content }) {
  return names.map((name) => {
    const marker = `- ${name}: `
    const start = content.indexOf(marker)
    let description = ''
    if (start >= 0) {
      const from = start + marker.length
      const next = content.indexOf('\n- ', from)
      description = content.slice(from, next < 0 ? undefined : next).trim()
    }
    const colon = name.indexOf(':')
    return {
      name,
      source: colon > 0 ? name.slice(0, colon) : 'built-in',
      short: colon > 0 ? name.slice(colon + 1) : name,
      description: description.split('\n')[0].slice(0, 300),
    }
  })
}

/** session id -> pid of the claude process that has it open */
function runningSessions() {
  const map = new Map()
  let names = []
  try {
    names = fs.readdirSync(RUNNING).filter((n) => /^\d+\.json$/.test(n))
  } catch {
    return map
  }
  for (const n of names) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(RUNNING, n), 'utf8'))
      // stale files of crashed processes: the pid must still be a claude
      if (fs.readFileSync(`/proc/${info.pid}/comm`, 'utf8').trim() === 'claude' && info.sessionId) map.set(info.sessionId, info.pid)
    } catch {
      /* gone or unreadable */
    }
  }
  return map
}

function createSessions(emit, { intervalMs = 2000, paneOf = () => null } = {}) {
  /** transcript path -> parsed state */
  const cache = new Map()
  let timer = null
  let lastJson = ''

  function parse(file, stat) {
    let s = cache.get(file)
    if (!s) {
      s = {
        offset: 0,
        id: path.basename(file, '.jsonl'),
        title: null,
        cwd: null,
        branch: null,
        model: null,
        lastAt: 0,
        files: new Map(),
        skillsUsed: new Map(), // skill name -> last use
        listing: null, // { names, content, at }
        startedAt: 0,
        prompt: null,
        state: 'idle', // thinking | tool | waiting | idle
        tool: null,
        target: null,
        since: 0, // when the current turn started
        pending: new Map(), // tool_use id -> { name, target }
        log: [], // { kind: user | text | tool | result, text, at }
      }
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
        if (rec.type === 'last-prompt' && rec.lastPrompt) s.prompt = clip(rec.lastPrompt, 140)
        const att = rec.attachment
        if (att?.type === 'skill_listing' && Array.isArray(att.names))
          s.listing = { names: att.names, content: String(att.content ?? ''), at: Date.parse(rec.timestamp) || 0 }
        // the folder claude started in (later records follow the Bash tool's cd)
        if (rec.cwd && !s.cwd) s.cwd = rec.cwd
        if (rec.gitBranch) s.branch = rec.gitBranch
        const at = Date.parse(rec.timestamp)
        if (at > s.lastAt) s.lastAt = at
        if (at && !s.startedAt) s.startedAt = at
        const msg = rec.message
        track(s, rec, msg, at || Date.now())
        if (rec.type === 'assistant' && msg?.model) s.model = msg.model
        if (!rec.isMeta) logRecord(s, rec, msg, at || Date.now())
        if (rec.type === 'assistant' && Array.isArray(msg?.content)) {
          for (const block of msg.content) {
            const op = block?.type === 'tool_use' && FILE_TOOLS[block.name]
            const p = op && (block.input?.file_path ?? block.input?.notebook_path)
            if (typeof p === 'string' && !SKIP_FILE.test(p) && !SKIP_DIR.test(p)) s.files.set(p, { path: p, op, at: at || Date.now() })
            if (block?.type === 'tool_use' && block.name === 'Skill' && typeof block.input?.skill === 'string')
              s.skillsUsed.set(block.input.skill, at || Date.now())
          }
        }
      }
    } finally {
      fs.closeSync(fd)
    }
    return s
  }

  /** conversation lines for the agent console: prompts, replies, tool calls, failed results */
  function logRecord(s, rec, msg, at) {
    const push = (kind, text) => {
      if (!text) return
      s.log.push({ kind, text, at })
      if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX)
    }
    const content = msg?.content
    if (rec.type === 'user') {
      if (typeof content === 'string') {
        if (!content.startsWith('<')) push('user', clip(content, 2000))
        return
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type === 'text' && !b.text.startsWith('<')) push('user', clip(b.text, 2000))
        if (b?.type === 'tool_result' && b.is_error) {
          const t = typeof b.content === 'string' ? b.content : b.content?.find?.((x) => x?.type === 'text')?.text
          push('result', clip(t || 'error', 300))
        }
      }
    } else if (rec.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b?.type === 'text') push('text', b.text.length > 4000 ? `${b.text.slice(0, 3999)}…` : b.text)
        if (b?.type === 'tool_use') {
          const target = toolTarget(b.name, b.input)
          push('tool', target ? `${b.name} · ${target}` : b.name)
        }
      }
    }
  }

  /** follow the turn: prompt → thinking → tool calls ↔ results → end of turn */
  function track(s, rec, msg, at) {
    if (rec.type === 'system' && rec.subtype === 'turn_duration') {
      s.state = 'waiting'
      s.pending.clear()
      return
    }
    if (rec.type === 'user' && msg && !rec.isMeta) {
      const content = msg.content
      if (Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) {
        for (const b of content) if (b?.type === 'tool_result') s.pending.delete(b.tool_use_id)
        const last = [...s.pending.values()].pop()
        if (last) Object.assign(s, { state: 'tool', tool: last.name, target: last.target })
        else s.state = 'thinking'
        return
      }
      const text = typeof content === 'string' ? content : content?.find?.((b) => b?.type === 'text')?.text
      if (typeof text !== 'string' || text.startsWith('<')) return // local commands, reminders
      if (text.startsWith('[Request interrupted')) {
        s.state = 'waiting'
        s.pending.clear()
        return
      }
      // a subagent's task is its first user message; a session shows its latest prompt
      if (!rec.isSidechain || !s.prompt) s.prompt = clip(text, 140)
      Object.assign(s, { state: 'thinking', tool: null, target: null, since: at })
      return
    }
    if (rec.type !== 'assistant' || !Array.isArray(msg?.content)) return
    if (!s.since || s.state === 'waiting' || s.state === 'idle') s.since = at
    for (const b of msg.content) {
      if (b?.type !== 'tool_use') continue
      const t = { name: b.name, target: toolTarget(b.name, b.input) }
      s.pending.set(b.id, t)
      Object.assign(s, { state: 'tool', tool: t.name, target: t.target })
    }
    if (msg.stop_reason === 'end_turn' && !s.pending.size) s.state = 'waiting'
    else if (!s.pending.size) s.state = 'thinking'
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
        let activity = null
        const transcript = path.join(dir, `${id}.jsonl`)
        try {
          const stat = fs.statSync(transcript)
          lastAt = stat.mtimeMs
          const t = parse(transcript, stat)
          activity = activityOf({ ...t, lastAt: Math.max(t.lastAt, lastAt) }, now)
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
          activity,
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
    const running = runningSessions()
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
        startedAt: s.startedAt || stat.birthtimeMs,
        live: now - lastAt < LIVE_MS,
        prompt: s.prompt,
        activity: activityOf({ ...s, lastAt }, now),
        pane: paneOf(s.id),
        // where the session's claude runs: our PTY, some other terminal, or nowhere
        host: paneOf(s.id) ? 'dashboard' : running.has(s.id) ? 'terminal' : null,
        files: [...s.files.values()].sort((a, b) => b.at - a.at).slice(0, MAX_FILES),
        subagents: subagents(file, now),
        skillsUsed: [...s.skillsUsed].map(([name, at]) => ({ name, at, live: now - at < LIVE_MS })),
      }
    })
    // the newest skill listing among the shown sessions is what is loaded now
    const listing = recent
      .slice(0, MAX_SESSIONS)
      .map(({ file }) => cache.get(file)?.listing)
      .filter(Boolean)
      .sort((a, b) => b.at - a.at)[0]
    const skills = listing ? parseListing(listing) : []
    // only push when something visible changed
    const json = JSON.stringify([
      sessions.map((s) => ({ ...s, lastAt: undefined, subagents: s.subagents.map((a) => ({ ...a, lastAt: undefined })) })),
      skills.map((k) => k.name),
    ])
    latest = { sessions, skills }
    if (json !== lastJson) {
      lastJson = json
      emit('sessions:update', latest)
    }
  }

  let latest = { sessions: [], skills: [] }
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
    rescan: scan,
    /** last conversation lines of a session, if it is among the recent ones */
    transcript(id) {
      for (const s of cache.values()) if (s.id === id) return { id, log: s.log }
      return { id, log: [] }
    },
  }
}

module.exports = { createSessions, runningSessions }
