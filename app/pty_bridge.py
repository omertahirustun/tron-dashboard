#!/usr/bin/env python3
"""PTY bridge: runs a command in a real pseudo-terminal without native Node modules
(same approach as ~/agent-office/app/pty_bridge.py).

Usage: pty_bridge.py COLS ROWS COMMAND [ARGS...]
  stdin  -> written to the terminal, terminal output -> stdout
  fd 3   -> resize messages: "COLS ROWS\\n"
"""
import fcntl, os, pty, select, signal, struct, sys, termios

cols, rows = int(sys.argv[1]), int(sys.argv[2])
cmd = sys.argv[3:]


def set_size(fd, c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))


pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.environ['COLORTERM'] = 'truecolor'
    try:
        os.execvp(cmd[0], cmd)
    except Exception:
        os._exit(127)

set_size(fd, cols, rows)
signal.signal(signal.SIGTERM, lambda *_: (os.kill(pid, signal.SIGHUP), None))
inputs = [fd, 0, 3]
ctl_buf = b''
try:
    while True:
        ready, _, _ = select.select(inputs, [], [])
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                os.kill(pid, signal.SIGHUP)
                inputs.remove(0)
            else:
                os.write(fd, data)
        if 3 in ready and 3 in inputs:
            data = os.read(3, 4096)
            if not data:
                inputs.remove(3)
            else:
                ctl_buf += data
                while b'\n' in ctl_buf:
                    line, ctl_buf = ctl_buf.split(b'\n', 1)
                    try:
                        c, r = (int(x) for x in line.split())
                        set_size(fd, max(2, min(c, 500)), max(2, min(r, 200)))
                    except Exception:
                        pass
except KeyboardInterrupt:
    pass

try:
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
except ChildProcessError:
    code = 0
sys.exit(code if code >= 0 else 1)
