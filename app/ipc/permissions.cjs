// Claude Code permission prompts answered from the dashboard. A global HTTP
// hook (PermissionRequest in ~/.claude/settings.json) posts every prompt here;
// the request is held open until the dashboard decides. Claude Code shows its
// own dialog at the same time and whichever answers first wins: answering in
// the terminal closes our request, and when the dashboard is not running the
// hook fails silently and only the terminal asks (both tested 2026-10-17).
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

// AOD_PERMISSION_PORT: a second instance (testing) next to the real one
const PORT = Number(process.env.AOD_PERMISSION_PORT) || 47820
const HOOK_URL = `http://127.0.0.1:${PORT}/hook/permission`
// long enough to walk over from another room; the terminal dialog stays usable meanwhile
const HOOK_TIMEOUT_S = 3600
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')
const MAX_BODY = 1024 * 1024

const clip = (text, n) => {
  const one = String(text ?? '').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** What the prompt is about, as one or a few lines of text */
function describe(tool, input = {}) {
  if (tool === 'Bash') return clip(input.command, 600)
  const file = input.file_path ?? input.notebook_path
  if (typeof file === 'string') return file
  if (tool === 'WebFetch') return clip(input.url, 300)
  if (tool === 'WebSearch') return clip(input.query, 300)
  return clip(JSON.stringify(input), 400)
}

/** "Bash(npm test)", "Read(//tmp/**)", "mode: acceptEdits" */
function suggestionLabel(s) {
  if (s?.type === 'addRules' || s?.type === 'replaceRules')
    return (s.rules ?? []).map((r) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')
  if (s?.type === 'addDirectories') return (s.directories ?? []).join(', ')
  if (s?.type === 'setMode') return `mode: ${s.mode}`
  return s?.type ?? ''
}

function readClaudeSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw new Error(`~/.claude/settings.json could not be read: ${e.message}`)
  }
}

function hookInstalled(settings = readClaudeSettings()) {
  return (settings.hooks?.PermissionRequest ?? []).some((m) => (m.hooks ?? []).some((h) => h.url === HOOK_URL))
}

function createPermissions(emit, { onRequest } = {}) {
  /** id -> { request, res } */
  const pending = new Map()
  let seq = 0
  let server = null
  let listening = false
  let error = null

  const list = () => [...pending.values()].map((p) => p.request)
  const changed = () => emit('permissions:update', list())

  function respond(id, decision) {
    const p = pending.get(id)
    if (!p) return false
    pending.delete(id)
    p.res.writeHead(200, { 'content-type': 'application/json' })
    p.res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }))
    changed()
    return true
  }

  function onHook(req, res) {
    // browsers cannot send a JSON POST cross-origin without a preflight, which we never answer
    if (req.method !== 'POST' || req.url !== '/hook/permission' || !/^application\/json/.test(req.headers['content-type'] ?? '')) {
      res.writeHead(404).end()
      return
    }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => {
      body += c
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', () => {
      let input
      try {
        input = JSON.parse(body)
      } catch {
        res.writeHead(400).end()
        return
      }
      const id = `p${++seq}`
      const suggestions = Array.isArray(input.permission_suggestions) ? input.permission_suggestions : []
      const request = {
        id,
        sessionId: String(input.session_id ?? ''),
        cwd: input.cwd ?? null,
        project: input.cwd ? path.basename(input.cwd) : null,
        tool: String(input.tool_name ?? 'tool'),
        detail: describe(input.tool_name, input.tool_input),
        description: clip(input.tool_input?.description, 200) || null,
        always: suggestions.length ? suggestions.map(suggestionLabel).filter(Boolean).join(' · ') : null,
        at: Date.now(),
      }
      pending.set(id, { request, res, suggestions })
      // answered in the terminal (or Claude Code went away): forget it
      res.on('close', () => {
        if (pending.get(id)?.res === res) {
          pending.delete(id)
          changed()
        }
      })
      changed()
      onRequest?.(request)
    })
  }

  return {
    start() {
      server = http.createServer(onHook)
      server.on('error', (e) => {
        error = e.code === 'EADDRINUSE' ? `port ${PORT} is taken (another dashboard?)` : e.message
        emit('permissions:update', list())
      })
      server.listen(PORT, '127.0.0.1', () => {
        listening = true
      })
    },
    stop() {
      for (const id of [...pending.keys()]) pending.get(id).res.destroy()
      pending.clear()
      server?.close()
    },
    list,
    /** decision: allow | always | deny */
    decide(id, decision, message) {
      const p = pending.get(String(id))
      if (!p) return false
      if (decision === 'allow') return respond(p.request.id, { behavior: 'allow' })
      if (decision === 'always') return respond(p.request.id, { behavior: 'allow', updatedPermissions: p.suggestions })
      return respond(p.request.id, { behavior: 'deny', message: clip(message || 'Denied from the Agent Office dashboard.', 500) })
    },
    status() {
      let installed = false
      let settingsError = null
      try {
        installed = hookInstalled()
      } catch (e) {
        settingsError = e.message
      }
      return { installed, listening, error: error ?? settingsError, port: PORT }
    },
    /** add our HTTP hook to ~/.claude/settings.json, keeping everything else (backup next to it) */
    installHook() {
      const settings = readClaudeSettings()
      if (hookInstalled(settings)) return this.status()
      if (fs.existsSync(CLAUDE_SETTINGS)) fs.copyFileSync(CLAUDE_SETTINGS, `${CLAUDE_SETTINGS}.bak-agent-office-grid`)
      const hooks = (settings.hooks ??= {})
      ;(hooks.PermissionRequest ??= []).push({
        matcher: '*',
        hooks: [{ type: 'http', url: HOOK_URL, timeout: HOOK_TIMEOUT_S }],
      })
      fs.writeFileSync(CLAUDE_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`)
      return this.status()
    },
  }
}

module.exports = { createPermissions }
