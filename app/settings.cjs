// Persistent desktop settings in ~/.config/Agent Office Grid/settings.json
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DASHBOARD = path.join(__dirname, '..')
const OFFICE = path.join(os.homedir(), 'agent-office')

const DEFAULTS = {
  // folders shown in the workspace explorer; git intel follows the selected one
  workspaceRoots: [DASHBOARD, OFFICE],
  // network.ping: tcp = connect time, http = time to first response
  networkTargets: [
    { name: 'PostgreSQL', kind: 'tcp', host: '127.0.0.1', port: 5432 },
    { name: 'Supabase', kind: 'http', url: 'https://mvcfomkwnqorotevtqzu.supabase.co/auth/v1/health' },
    { name: 'Node.js', kind: 'http', url: 'http://127.0.0.1:8787/' },
    { name: 'GitHub', kind: 'http', url: 'https://github.com/' },
    { name: 'GitHub API', kind: 'http', url: 'https://api.github.com/' },
    { name: 'Anthropic', kind: 'http', url: 'https://api.anthropic.com/' },
    { name: 'npm', kind: 'http', url: 'https://registry.npmjs.org/' },
    { name: 'YT Music', kind: 'http', url: 'https://music.youtube.com/' },
    { name: 'Cloudflare', kind: 'tcp', host: '1.1.1.1', port: 443 },
  ],
  // claude.metrics: API-equivalent spend per day shown against this budget
  dailyBudgetUsd: 50,
}

function create(userDataDir) {
  const file = path.join(userDataDir, 'settings.json')
  let data = { ...DEFAULTS }
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
    // targets added to the defaults after the file was written show up too
    const names = new Set(data.networkTargets.map((t) => t.name))
    data.networkTargets = [...data.networkTargets, ...DEFAULTS.networkTargets.filter((t) => !names.has(t.name))]
  } catch {
    /* first run or unreadable: defaults */
  }

  const save = () => {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(data, null, 2))
  }

  return {
    file,
    get: () => data,
    set(key, value) {
      data = { ...data, [key]: value }
      save()
    },
    // the configured folders first, then the home folder and the whole disk, so
    // any file on the computer can be browsed (read-only)
    roots: () => [...new Set([...data.workspaceRoots.map((p) => path.resolve(p)), os.homedir(), '/'])].filter((p) => fs.existsSync(p)),
    addRoot(p) {
      const abs = path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()))
      if (!fs.statSync(abs).isDirectory()) throw new Error(`${abs} is not a folder`)
      if (!data.workspaceRoots.includes(abs)) data.workspaceRoots = [...data.workspaceRoots, abs]
      save()
      return abs
    },
    removeRoot(p) {
      const abs = path.resolve(p)
      data.workspaceRoots = data.workspaceRoots.filter((r) => path.resolve(r) !== abs)
      save()
    },
  }
}

module.exports = { create }
