// Read-only file access, limited to the configured workspace roots.
const fs = require('node:fs/promises')
const path = require('node:path')

const IGNORED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv'])
const MAX_ENTRIES = 500
const SNIPPET_BYTES = 64 * 1024

function createWorkspace(settings) {
  /** Resolve symlinks and make sure the path stays inside a root. */
  async function guard(p) {
    if (typeof p !== 'string' || !p) throw new Error('Path is required')
    const real = await fs.realpath(path.resolve(p))
    for (const root of settings.roots()) {
      const realRoot = await fs.realpath(root).catch(() => null)
      if (realRoot && (real === realRoot || real.startsWith(realRoot + path.sep))) return real
    }
    throw new Error(`Outside the workspace: ${p}`)
  }

  return {
    async roots() {
      const out = []
      for (const root of settings.roots()) {
        const isGit = await fs
          .stat(path.join(root, '.git'))
          .then(() => true)
          .catch(() => false)
        out.push({ name: path.basename(root), path: root, isGit })
      }
      return out
    },

    /** One level of a folder: folders first, then files, alphabetically. */
    async readDir(p) {
      const dir = await guard(p)
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const list = entries
        // hide dotfiles and heavy generated folders
        .filter((e) => !IGNORED.has(e.name) && !e.name.startsWith('.'))
        .filter((e) => e.isDirectory() || e.isFile())
        .map((e) => ({ name: e.name, path: path.join(p, e.name), kind: e.isDirectory() ? 'dir' : 'file' }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
      return { entries: list.slice(0, MAX_ENTRIES), truncated: list.length > MAX_ENTRIES }
    },

    /** Start of a text file (first 64 KB). Binary files are reported, not returned. */
    async readFile(p) {
      const file = await guard(p)
      const handle = await fs.open(file, 'r')
      try {
        const { size } = await handle.stat()
        const buf = Buffer.alloc(Math.min(size, SNIPPET_BYTES))
        await handle.read(buf, 0, buf.length, 0)
        if (buf.includes(0)) return { binary: true, size, content: '', truncated: false }
        return { binary: false, size, content: buf.toString('utf8'), truncated: size > SNIPPET_BYTES }
      } finally {
        await handle.close()
      }
    },
  }
}

module.exports = { createWorkspace }
