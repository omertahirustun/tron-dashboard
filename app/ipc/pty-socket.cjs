// Where the PTY host listens. AOD_PTY_SOCKET overrides it (a test instance
// next to the real app must not share the user's terminals).
const os = require('node:os')
const path = require('node:path')

const runtime = process.env.XDG_RUNTIME_DIR || os.tmpdir()
const SOCKET = process.env.AOD_PTY_SOCKET || path.join(runtime, `agent-office-grid-pty-${process.getuid?.() ?? 'u'}.sock`)
/** bumped when the protocol changes; an older host keeps serving the terminals it has */
const VERSION = 1

module.exports = { SOCKET, VERSION }
