// Code graph of one repo for the topology globe. With the graphify CLI
// installed, a repo without a graphify export is mapped on first open
// (`graphify update`, code only, no LLM, ~1 s) and its graphify-out/ is listed
// in .git/info/exclude so git status stays clean. Without graphify, imports are
// read with regexes (JS/TS, Python, CSS, Markdown links): files as nodes.
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const MAX_FILES = 1500
const MAX_BYTES = 256 * 1024
const MAX_PACKAGES = 40
const JS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
const SOURCE = new Set([...JS, '.py', '.css', '.scss', '.md', '.vue', '.svelte'])

function listFiles(repo) {
  return new Promise((resolve, reject) =>
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, maxBuffer: 32 * 1024 * 1024, timeout: 10000 }, (err, out) =>
      err ? reject(err) : resolve(out.split('\0').filter(Boolean)),
    ),
  )
}

/** Import specifiers in one file, by language. */
function specifiers(rel, text) {
  const ext = path.extname(rel)
  const out = []
  const grab = (re) => {
    for (const m of text.matchAll(re)) out.push(m[1])
  }
  if (JS.includes(ext) || ext === '.vue' || ext === '.svelte') {
    grab(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)
    grab(/\bimport\s*['"]([^'"]+)['"]/g)
    grab(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  } else if (ext === '.py') {
    for (const m of text.matchAll(/^\s*from\s+(\.*[\w.]*)\s+import\s+([\w*, ()]+)/gm)) out.push(`py:${m[1]}|${m[2]}`)
    for (const m of text.matchAll(/^\s*import\s+([\w., ]+)/gm)) for (const mod of m[1].split(',')) out.push(`py:${mod.trim().split(/\s+as\s+/)[0]}|`)
  } else if (ext === '.css' || ext === '.scss') {
    grab(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)
  } else if (ext === '.md') {
    for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) out.push(`wiki:${m[1].trim()}`)
    grab(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)
  }
  return out
}

/** Package name of a bare specifier: react, @xyflow/react, node:fs → fs */
const packageOf = (spec) => {
  const s = spec.replace(/^node:/, '')
  return s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]
}

async function build(repo) {
  const all = (await listFiles(repo)).filter((f) => SOURCE.has(path.extname(f)))
  const files = all.slice(0, MAX_FILES)
  const fileSet = new Set(files)
  const byStem = new Map() // markdown wiki links: note name → file
  for (const f of files) if (f.endsWith('.md')) byStem.set(path.basename(f, '.md').toLowerCase(), f)

  const resolveRel = (from, spec) => {
    const base = spec.startsWith('/') ? spec.slice(1) : spec.startsWith('@/') ? path.join('src', spec.slice(2)) : path.join(path.dirname(from), spec)
    const p = path.normalize(base)
    const tries = [p, ...JS.map((e) => p + e), ...JS.map((e) => path.join(p, 'index' + e)), p + '.md', p + '.py']
    // TS sources import './x.js' meaning './x.ts'
    if (/\.(c|m)?js$/.test(p)) tries.push(...JS.map((e) => p.replace(/\.(c|m)?js$/, e)))
    return tries.find((t) => fileSet.has(t)) ?? null
  }

  const resolvePy = (from, mod, names) => {
    const dots = mod.match(/^\.*/)[0].length
    const rest = mod.slice(dots).split('.').filter(Boolean)
    const bases = dots ? [path.join(path.dirname(from), ...Array(dots - 1).fill('..'))] : ['', 'src', path.dirname(from)]
    for (const b of bases) {
      const p = path.join(b, ...rest)
      for (const t of [p + '.py', path.join(p, '__init__.py')]) if (fileSet.has(path.normalize(t))) return { file: path.normalize(t) }
      // `from pkg import module`
      for (const n of names.split(/[\s,()]+/).filter(Boolean)) {
        const t = path.normalize(path.join(p, n + '.py'))
        if (fileSet.has(t)) return { file: t }
      }
    }
    return dots ? null : { pkg: rest[0] }
  }

  const edges = new Map() // "a\0b" → kind
  const pkgUsers = new Map() // package → Set(file)
  const addEdge = (a, b) => {
    if (a === b) return
    edges.set(a < b ? `${a}\0${b}` : `${b}\0${a}`, true)
  }

  await Promise.all(
    files.map(async (rel) => {
      let text
      try {
        const handle = await fs.open(path.join(repo, rel), 'r')
        try {
          const buf = Buffer.alloc(Math.min((await handle.stat()).size, MAX_BYTES))
          await handle.read(buf, 0, buf.length, 0)
          text = buf.toString('utf8')
        } finally {
          await handle.close()
        }
      } catch {
        return
      }
      for (const spec of specifiers(rel, text)) {
        if (spec.startsWith('py:')) {
          const [mod, names] = spec.slice(3).split('|')
          const r = resolvePy(rel, mod, names)
          if (r?.file) addEdge(rel, r.file)
          else if (r?.pkg) (pkgUsers.get(r.pkg) ?? pkgUsers.set(r.pkg, new Set()).get(r.pkg)).add(rel)
        } else if (spec.startsWith('wiki:')) {
          const target = byStem.get(spec.slice(5).toLowerCase())
          if (target) addEdge(rel, target)
        } else if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) {
          const target = resolveRel(rel, decodeURIComponent(spec))
          if (target) addEdge(rel, target)
        } else if (!rel.endsWith('.md')) {
          const pkg = packageOf(spec)
          if (pkg) (pkgUsers.get(pkg) ?? pkgUsers.set(pkg, new Set()).get(pkg)).add(rel)
        }
      }
    }),
  )

  // only the most used packages, or the globe drowns in one-off imports
  const packages = [...pkgUsers].sort((a, b) => b[1].size - a[1].size).slice(0, MAX_PACKAGES)
  const nodes = files.map((rel) => ({ id: rel, label: path.basename(rel), path: path.join(repo, rel), group: rel.includes('/') ? rel.split('/')[0] : '.' }))
  for (const [pkg, users] of packages) {
    nodes.push({ id: `pkg:${pkg}`, label: pkg, path: null, group: 'packages' })
    for (const u of users) addEdge(u, `pkg:${pkg}`)
  }
  return {
    repo,
    name: path.basename(repo),
    source: 'imports',
    truncated: all.length > files.length,
    nodes,
    edges: [...edges.keys()].map((k) => k.split('\0')),
  }
}

/** graphify's export: networkx node-link JSON ({ nodes, links|edges }). */
async function fromGraphify(repo) {
  const file = path.join(repo, 'graphify-out', 'graph.json')
  const raw = JSON.parse(await fs.readFile(file, 'utf8'))
  const list = (raw.nodes ?? []).slice(0, MAX_FILES)
  const ids = new Set(list.map((n) => String(n.id)))
  const nodes = list.map((n) => {
    const src = n.source_file ?? n.file ?? n.path ?? null
    const label = String(n.label ?? n.name ?? n.id).slice(0, 60)
    return {
      id: String(n.id),
      label,
      path: src ? path.resolve(repo, src) : null,
      // graphify names each community after its most central node
      group: String(n.community_name ?? n.community ?? n.file_type ?? 'graph'),
      detail: [n.file_type, src && `${src}${n.source_location ? `:${String(n.source_location).replace(/^L/, '')}` : ''}`].filter(Boolean).join(' · '),
      // the node standing for the whole file (others are its functions, classes…)
      isFile: !!src && label === path.basename(src),
    }
  })
  const edges = (raw.links ?? raw.edges ?? [])
    .map((e) => [String(e.source?.id ?? e.source), String(e.target?.id ?? e.target)])
    .filter(([a, b]) => ids.has(a) && ids.has(b) && a !== b)
  return { repo, name: path.basename(repo), source: 'graphify', truncated: (raw.nodes ?? []).length > list.length, nodes, edges }
}

/** The graphify CLI (uv/pipx put it in ~/.local/bin, which a desktop launcher's PATH may lack). */
async function findGraphify() {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')]
  for (const d of dirs) {
    const bin = path.join(d, 'graphify')
    if (await fs.access(bin, fs.constants?.X_OK ?? 1).then(() => true, () => false)) return bin
  }
  return null
}

/** Keep graphify-out/ out of `git status` locally, unless the repo already decides (ignored or committed). */
async function excludeLocally(repo) {
  const tracked = await new Promise((resolve) =>
    execFile('git', ['ls-files', '--', 'graphify-out'], { cwd: repo, timeout: 5000 }, (err, out) => resolve(!err && out.trim() !== '')),
  )
  const ignored = await new Promise((resolve) =>
    execFile('git', ['check-ignore', '-q', 'graphify-out'], { cwd: repo, timeout: 5000 }, (err) => resolve(!err)),
  )
  if (tracked || ignored) return
  const gitDir = await new Promise((resolve, reject) =>
    execFile('git', ['rev-parse', '--git-common-dir'], { cwd: repo, timeout: 5000 }, (err, out) => (err ? reject(err) : resolve(path.resolve(repo, out.trim())))),
  )
  const file = path.join(gitDir, 'info', 'exclude')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const current = await fs.readFile(file, 'utf8').catch(() => '')
  await fs.appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}# graphify export (Agent Office Grid)\ngraphify-out/\n`)
}

function createCodeGraph(git) {
  async function top(repo) {
    const t = await git.repoOf(repo)
    if (!t) throw new Error(`Not a git repository: ${repo}`)
    return t
  }
  return {
    async build(repo) {
      const t = await top(repo)
      const hasGraphify = !!(await findGraphify())
      const graph = await fromGraphify(t).catch(() =>
        // first time: map with graphify, or fall back to the import scan
        hasGraphify ? this.runGraphify(t).catch(() => build(t)) : build(t),
      )
      return { ...graph, graphify: hasGraphify }
    },
    /** Run graphify's code-only (no LLM) extraction, which writes graphify-out/ into the repo. */
    async runGraphify(repo) {
      const t = await top(repo)
      const bin = await findGraphify()
      if (!bin) throw new Error('graphify is not installed (uv tool install graphifyy)')
      await excludeLocally(t).catch(() => {})
      await new Promise((resolve, reject) =>
        execFile(bin, ['update', t], { cwd: t, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) =>
          err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(),
        ),
      )
      return { ...(await fromGraphify(t)), graphify: true }
    },
  }
}

module.exports = { createCodeGraph }
