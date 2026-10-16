// Persistent desktop settings in ~/.config/Agent Office Grid/settings.json
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DASHBOARD = path.join(__dirname, '..')
const OFFICE = path.join(os.homedir(), 'agent-office')

const DEFAULTS = {
  // folders shown in the workspace explorer; git intel follows the selected one
  workspaceRoots: [DASHBOARD, OFFICE],
  // task.queue: real commands, run with bash -lc in `cwd`
  tasks: [
    { id: 'typecheck', name: 'type check', command: 'npx tsc -b', cwd: DASHBOARD },
    { id: 'lint', name: 'lint', command: 'npm run lint', cwd: DASHBOARD },
    { id: 'build', name: 'build', command: 'npm run build', cwd: DASHBOARD },
    { id: 'office', name: 'agent-office server', command: 'npm run server', cwd: OFFICE, longRunning: true },
    { id: 'fetch', name: 'git fetch', command: 'git fetch --all --prune', cwd: OFFICE },
  ],
  // network.ping: tcp = connect time, http = time to first response
  networkTargets: [
    { name: 'PostgreSQL', kind: 'tcp', host: '127.0.0.1', port: 5432 },
    { name: 'Supabase', kind: 'http', url: 'https://mvcfomkwnqorotevtqzu.supabase.co/auth/v1/health' },
    { name: 'Node.js', kind: 'http', url: 'http://127.0.0.1:8787/' },
  ],
  // claude.metrics: API-equivalent spend per day shown against this budget
  dailyBudgetUsd: 50,
}

function create(userDataDir) {
  const file = path.join(userDataDir, 'settings.json')
  let data = { ...DEFAULTS }
  try {
    data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }
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
    roots: () => data.workspaceRoots.map((p) => path.resolve(p)).filter((p) => fs.existsSync(p)),
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
