// Git status for any repo on the computer. Commands run with execFile and
// fixed arguments (no shell), inside a folder git itself reports as a repo top.
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const SEP = '\x1f'

// GIT_OPTIONAL_LOCKS=0: `git status` would otherwise refresh .git/index, which
// the watcher below sees as a change and answers with another status: a loop
// that kept spawning git several times a second.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: GIT_ENV, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trimEnd()),
    )
  })
}

/** git@github.com:a/b.git or https://…/a/b.git → https://github.com/a/b (null for non-web remotes) */
function webUrl(remote) {
  if (!remote) return null
  const ssh = remote.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  const http = remote.match(/^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/)
  return http ? `https://${http[1]}` : null
}

function createGit() {
  const watchers = new Map() // repo -> { close }

  /** Top folder of the repo containing `p` (a file or folder), or null. */
  async function repoOf(p) {
    const abs = path.resolve(String(p))
    const dir = await fs.promises
      .stat(abs)
      .then((st) => (st.isDirectory() ? abs : path.dirname(abs)))
      .catch(() => null)
    if (!dir) return null
    return git(dir, ['rev-parse', '--show-toplevel']).catch(() => null)
  }

  async function assertRepo(repo) {
    const top = await repoOf(repo)
    if (!top || top !== path.resolve(String(repo))) throw new Error(`Not a git repository: ${repo}`)
    return top
  }

  async function status(repo) {
    const cwd = await assertRepo(repo)
    const [branch, log, porcelain, aheadBehind, remote] = await Promise.all([
      git(cwd, ['branch', '--show-current']).catch(() => ''),
      git(cwd, ['log', '-n', '5', `--format=%h${SEP}%s${SEP}%an${SEP}%ar${SEP}%P`]).catch(() => ''),
      git(cwd, ['status', '--porcelain']).catch(() => ''),
      git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => null),
      git(cwd, ['remote', 'get-url', 'origin']).catch(() => ''),
    ])
    const commits = log
      ? log.split('\n').map((line) => {
          const [hash, subject, author, when, parents] = line.split(SEP)
          return { hash, subject, author, when, merge: parents.split(' ').length > 1 }
        })
      : []
    const [behind, ahead] = aheadBehind ? aheadBehind.split(/\s+/).map(Number) : [null, null]
    return {
      repo: cwd,
      name: path.basename(cwd),
      branch: branch || '(detached)',
      changed: porcelain ? porcelain.split('\n').length : 0,
      ahead,
      behind,
      commits,
      remote: webUrl(remote),
    }
  }

  /** Uncommitted changes to one file (what Claude or you changed since the last commit). */
  async function diff(file) {
    const abs = path.resolve(String(file))
    const repo = await repoOf(abs)
    if (!repo) return { repo: null, rel: abs, state: 'no-repo', diff: '' }
    const rel = path.relative(repo, abs)
    const tracked = await git(repo, ['ls-files', '--error-unmatch', '--', rel]).then(() => true, () => false)
    if (!tracked) return { repo, rel, state: 'untracked', diff: '' }
    // HEAD may not exist yet in a fresh repo; fall back to the index
    const out = await git(repo, ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', rel]).catch(() =>
      git(repo, ['diff', '--no-color', '--no-ext-diff', '--', rel]).catch(() => ''),
    )
    const MAX = 200 * 1024
    return { repo, rel, state: out ? 'modified' : 'clean', diff: out.length > MAX ? `${out.slice(0, MAX)}\n… (diff truncated)` : out }
  }

  /** Notify on checkout, commit, stage and fetch by watching git's own files. */
  async function watch(repo, onChange) {
    const cwd = await assertRepo(repo)
    if (watchers.has(cwd)) return
    const gitDir = path.join(cwd, '.git')
    let timer = null
    const fire = (_event, file) => {
      // lock files come and go around every git command, ours included
      if (typeof file === 'string' && file.endsWith('.lock')) return
      clearTimeout(timer)
      timer = setTimeout(() => onChange(cwd), 300)
    }
    const handles = []
    for (const target of [gitDir, path.join(gitDir, 'logs'), path.join(gitDir, 'refs', 'heads')]) {
      try {
        handles.push(fs.watch(target, fire))
      } catch {
        /* folder may not exist yet (fresh repo) */
      }
    }
    // working-tree edits don't touch .git; poll for the changed-file count
    const poll = setInterval(fire, 15000)
    watchers.set(cwd, {
      close() {
        clearTimeout(timer)
        clearInterval(poll)
        handles.forEach((h) => h.close())
      },
    })
  }

  function closeAll() {
    watchers.forEach((w) => w.close())
    watchers.clear()
  }

  return { status, watch, closeAll, repoOf, diff }
}

module.exports = { createGit }
