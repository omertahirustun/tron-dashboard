import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { native } from '../../native/api'
import { useOfficeStore } from '../../store/useOfficeStore'

// "The Grid" palette mapped onto the 16 ANSI colours
const THEME = {
  background: '#00000000',
  foreground: '#b8d6dc',
  cursor: '#ff8c00',
  cursorAccent: '#050505',
  selectionBackground: 'rgba(13, 230, 255, 0.3)',
  black: '#0b1418',
  red: '#ff2e4d',
  green: '#3dffa8',
  yellow: '#ffb340',
  blue: '#3d9bff',
  magenta: '#b99cff',
  cyan: '#0de6ff',
  white: '#b8d6dc',
  brightBlack: '#5b7a82',
  brightRed: '#ff6b81',
  brightGreen: '#7dffc4',
  brightYellow: '#ffd27a',
  brightBlue: '#7dbcff',
  brightMagenta: '#d4c2ff',
  brightCyan: '#7ff2ff',
  brightWhite: '#ffffff',
}

/** Real shell (fish, else bash) running in the main process via a PTY. */
export function ShellView() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!native || !el) return
    const api = native
    let disposed = false
    let exited = false
    const cleanups: Array<() => void> = []

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12,
      lineHeight: 1.15,
      theme: THEME,
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)

    const start = async () => {
      const { backlog, shell, restarted } = await api.startShell(term.cols, term.rows)
      if (disposed) return
      if (backlog) term.write(backlog)
      if (restarted) useOfficeStore.getState().addTerminalLog(`[LOG] ${shell} session started`, { source: 'pty', level: 'ok' })
    }

    // fonts must be ready before xterm measures its character cell
    void document.fonts.ready.then(() => {
      if (disposed) return
      term.open(el)
      fit.fit()
      cleanups.push(api.onShellData((data) => term.write(data)))
      cleanups.push(
        api.onShellExit(({ code }) => {
          exited = true
          term.write(`\r\n\x1b[38;2;255;140;0m[process exited with code ${code ?? '?'}; press Enter to start a new shell]\x1b[0m\r\n`)
          useOfficeStore.getState().addTerminalLog(`[LOG] shell exited (${code ?? '?'})`, { source: 'pty', level: 'warn' })
        }),
      )
      const input = term.onData((data) => {
        if (!exited) return api.writeShell(data)
        if (data === '\r') {
          exited = false
          term.clear()
          void start()
        }
      })
      cleanups.push(() => input.dispose())
      void start()

      // keep the PTY size in step with the panel
      let raf = 0
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          if (!el.clientWidth || !el.clientHeight) return
          fit.fit()
          api.resizeShell(term.cols, term.rows)
        })
      })
      ro.observe(el)
      cleanups.push(() => {
        ro.disconnect()
        cancelAnimationFrame(raf)
      })
    })

    return () => {
      disposed = true
      cleanups.forEach((c) => c())
      term.dispose()
    }
  }, [])

  if (!native)
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-dim">
        The live shell runs in the desktop app (npm run app). In the browser, type a message to chat with Claude.
      </div>
    )

  return <div ref={host} className="no-drag h-full w-full px-2 pt-1" aria-label="Shell" />
}
