// Git status for workspace repos. Commands run with execFile and fixed
// arguments (no shell), inside a folder that must be a workspace root.
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const SEP = '\x1f'

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trimEnd()),
    )
  })
}

function createGit(settings) {
  const watchers = new Map() // repo -> { close }

  function assertRoot(repo) {
    const abs = path.resolve(String(repo))
    if (!settings.roots().includes(abs)) throw new Error(`Not a workspace root: ${repo}`)
    return abs
  }

  async function status(repo) {
    const cwd = assertRoot(repo)
    const [branch, log, porcelain, aheadBehind] = await Promise.all([
      git(cwd, ['branch', '--show-current']).catch(() => ''),
      git(cwd, ['log', '-n', '5', `--format=%h${SEP}%s${SEP}%an${SEP}%ar${SEP}%P`]).catch(() => ''),
      git(cwd, ['status', '--porcelain']).catch(() => ''),
      git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => null),
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
    }
  }

  /** Notify on checkout, commit, stage and fetch by watching git's own files. */
  function watch(repo, onChange) {
    const cwd = assertRoot(repo)
    if (watchers.has(cwd)) return
    const gitDir = path.join(cwd, '.git')
    let timer = null
    const fire = () => {
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

  return { status, watch, closeAll }
}

module.exports = { createGit }
