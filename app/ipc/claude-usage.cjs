// Claude usage from Claude Code's own transcripts (~/.claude/projects/*/*.jsonl):
// the live session's context fill and today's tokens / API-equivalent cost.
// Files are read incrementally (only bytes appended since the last scan).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')

// $/1M tokens and context windows (claude-api skill table, cached 2026-10-06).
// Cache writes bill 1.25x input (5-minute TTL) or 2x (1-hour TTL). Haiku 5.5's
// cache-read price isn't in the table, so it uses the usual 0.1x of input.
const MODELS = {
  'claude-fable-5-1': { label: 'Fable 5.1', window: 1_000_000, input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { label: 'Opus 5.5', window: 1_000_000, input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', window: 1_000_000, input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { label: 'Haiku 5.5', window: 1_000_000, input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { label: 'Haiku 4.5', window: 200_000, input: 1, output: 5, cacheRead: 0.1 },
}
const FALLBACK = { label: 'Claude', window: 1_000_000, input: 4, output: 20, cacheRead: 0.2 }
const modelInfo = (id) => MODELS[id] ?? MODELS[Object.keys(MODELS).find((k) => id?.startsWith(k))] ?? FALLBACK

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function createClaudeUsage(settings, emit, intervalMs = 10000) {
  const offsets = new Map() // file -> bytes already read
  const seen = new Set() // message ids counted today (transcripts repeat usage per content block)
  let day = startOfToday()
  let today = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, requests: 0 }
  let session = null // newest assistant turn across all transcripts
  let timer = null

  function resetDay() {
    day = startOfToday()
    today = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, requests: 0 }
    seen.clear()
    offsets.clear()
  }

  function account(rec) {
    const msg = rec.message
    const u = msg?.usage
    if (!u || rec.type !== 'assistant') return
    const ts = Date.parse(rec.timestamp)
    if (!(ts >= day)) return
    const info = modelInfo(msg.model)
    // without the TTL breakdown, assume the default 5-minute cache
    const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0)
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
    const context = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    // sub-agent turns (sidechains) have their own context; track the main session
    if (!rec.isSidechain && (!session || ts >= session.at))
      session = { at: ts, model: msg.model, label: info.label, window: info.window, contextTokens: context, cwd: rec.cwd ?? null, effort: rec.effort ?? null }
    const key = msg.id ?? rec.requestId ?? rec.uuid
    if (seen.has(key)) return
    seen.add(key)
    today.requests++
    today.input += u.input_tokens ?? 0
    today.output += u.output_tokens ?? 0
    today.cacheRead += u.cache_read_input_tokens ?? 0
    today.cacheWrite += u.cache_creation_input_tokens ?? 0
    today.costUsd +=
      ((u.input_tokens ?? 0) * info.input +
        (u.output_tokens ?? 0) * info.output +
        (u.cache_read_input_tokens ?? 0) * info.cacheRead +
        write5m * info.input * 1.25 +
        write1h * info.input * 2) /
      1e6
  }

  function scanFile(file) {
    let stat
    try {
      stat = fs.statSync(file)
    } catch {
      return
    }
    if (stat.mtimeMs < day) return
    const from = offsets.get(file) ?? 0
    if (stat.size <= from) return
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(stat.size - from)
      fs.readSync(fd, buf, 0, buf.length, from)
      const text = buf.toString('utf8')
      const end = text.lastIndexOf('\n') + 1 // leave a half-written last line for next time
      offsets.set(file, from + Buffer.byteLength(text.slice(0, end)))
      for (const line of text.slice(0, end).split('\n')) {
        if (!line.includes('"usage"')) continue
        try {
          account(JSON.parse(line))
        } catch {
          /* partial or foreign line */
        }
      }
    } finally {
      fs.closeSync(fd)
    }
  }

  function scan() {
    if (startOfToday() !== day) resetDay()
    let dirs = []
    try {
      dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory())
    } catch {
      return publish()
    }
    for (const d of dirs) {
      const dir = path.join(PROJECTS, d.name)
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) scanFile(path.join(dir, f))
    }
    publish()
  }

  function stats() {
    return {
      session: session && { ...session, cwd: session.cwd ? path.basename(session.cwd) : null },
      today: { ...today },
      budgetUsd: settings.get().dailyBudgetUsd,
      models: Object.entries(MODELS)
        .filter(([id]) => id !== 'claude-haiku-4-5')
        .map(([id, m]) => ({ id, label: m.label, window: m.window, input: m.input, output: m.output })),
    }
  }

  const publish = () => emit('claude:stats', stats())

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
    stats,
  }
}

module.exports = { createClaudeUsage }
