import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import { handleZoomKey, termFont } from '../../lib/termFont'
import { native } from '../../native/api'

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

export interface ShellViewProps {
  /** pane id; the main process keeps one shell per id */
  id: string
  /** focused pane: xterm takes the keyboard */
  focused: boolean
  /** keys the window handles itself (new / close / move focus); xterm ignores them */
  isWindowKey: (e: KeyboardEvent) => boolean
  onFocus: () => void
}

/** One real shell (fish, else bash) running in the main process via a PTY. */
export function ShellView({ id, focused, isWindowKey, onFocus }: ShellViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // latest callbacks without re-creating the terminal
  const cb = useRef({ isWindowKey, onFocus, focused })
  useEffect(() => {
    cb.current = { isWindowKey, onFocus, focused }
  }, [isWindowKey, onFocus, focused])

  useEffect(() => {
    const el = host.current
    if (!native || !el) return
    const api = native
    let disposed = false
    let exited = false
    let replaying = false
    const cleanups: Array<() => void> = []

    // looks like the user's own terminal (foot): JetBrains Mono Nerd Font for the
    // prompt/eza/fastfetch icons, a thin beam cursor, bold not brightened. Colours
    // stay the Grid's (see the OSC filter below)
    const term = new Terminal({
      fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace",
      fontSize: termFont.get(),
      lineHeight: 1,
      theme: THEME,
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      drawBoldTextInBrightColors: false,
      scrollback: 10000,
      // programs that size images (fastfetch's logo) ask for pixel sizes
      windowOptions: { getWinSizePixels: true, getCellSizePixels: true, getWinSizeChars: true },
    })
    termRef.current = term
    // The user's config.fish re-colours the terminal (caelestia's OSC sequences).
    // Keep the Grid's background, text, cursor and 16 ANSI colours (the background
    // stays see-through), but let the extended colours 16+ through: fastfetch's
    // icons use those, so it looks as in the user's own terminal.
    for (const osc of [10, 11, 12, 17, 19, 104, 110, 111, 112]) term.parser.registerOscHandler(osc, () => true)
    term.parser.registerOscHandler(4, (data) => {
      const indexes = data.split(';').filter((_, i) => i % 2 === 0)
      return indexes.every((n) => Number(n) < 16) // true = swallowed, false = xterm applies it
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // zoom keys and the window's own keys never reach the shell
    term.attachCustomKeyEventHandler((e) => !handleZoomKey(e) && !cb.current.isWindowKey(e))

    // pixel size of the character grid, for the PTY's TIOCGWINSZ (image tools need it)
    const pixels = (): [number, number] => {
      const screen = el.querySelector<HTMLElement>('.xterm-screen')
      return [screen?.clientWidth ?? 0, screen?.clientHeight ?? 0]
    }
    const resize = () => api.resizeShell(id, term.cols, term.rows, ...pixels())

    const start = async () => {
      const { backlog } = await api.startShell(id, term.cols, term.rows, ...pixels())
      if (disposed) return
      if (!backlog) return
      // the backlog holds old terminal queries (cursor position, pixel size…);
      // xterm answers them while replaying, and those answers must not reach the
      // shell as typed input
      replaying = true
      term.write(backlog, () => {
        replaying = false
      })
    }

    // fonts must be ready before xterm measures its character cell
    void document.fonts.ready.then(() => {
      if (disposed) return
      term.open(el)
      // sixel and iTerm inline images (fastfetch's picture logo)
      term.loadAddon(new ImageAddon({ sixelSupport: true, iipSupport: true }))
      fit.fit()
      // focused before xterm existed (a pane that just opened): take the keyboard now
      if (cb.current.focused) term.focus()
      term.textarea?.addEventListener('focus', () => cb.current.onFocus())
      cleanups.push(api.onShellData((e) => e.id === id && term.write(e.data)))
      cleanups.push(
        api.onShellExit((e) => {
          if (e.id !== id) return
          exited = true
          term.write(`\r\n\x1b[38;2;255;140;0m[process exited with code ${e.code ?? '?'}; press Enter for a new shell]\x1b[0m\r\n`)
        }),
      )
      const input = term.onData((data) => {
        if (replaying) return
        if (!exited) return api.writeShell(id, data)
        if (data === '\r') {
          exited = false
          term.clear()
          void start()
        }
      })
      cleanups.push(() => input.dispose())
      void start()

      // keep the PTY size in step with the pane
      let raf = 0
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          if (!el.clientWidth || !el.clientHeight) return
          fit.fit()
          resize()
        })
      })
      ro.observe(el)
      cleanups.push(() => {
        ro.disconnect()
        cancelAnimationFrame(raf)
      })

      // font size: shared setting, refit so the PTY gets the new rows/columns
      cleanups.push(
        termFont.subscribe(() => {
          term.options.fontSize = termFont.get()
          fit.fit()
          resize()
        }),
      )
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return
        e.preventDefault()
        e.stopPropagation() // not a scroll for xterm
        termFont.step(e.deltaY < 0 ? 1 : -1)
      }
      // capture: before xterm's own wheel handling
      el.addEventListener('wheel', onWheel, { passive: false, capture: true })
      cleanups.push(() => el.removeEventListener('wheel', onWheel, { capture: true }))
    })

    return () => {
      disposed = true
      api.unwatchShell(id)
      termRef.current = null
      cleanups.forEach((c) => c())
      term.dispose()
    }
  }, [id])

  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  if (!native)
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-dim">
        The live shell runs in the desktop app (npm run app).
      </div>
    )

  return <div ref={host} className="h-full w-full px-2 pt-1" aria-label="Shell" onMouseDown={onFocus} />
}
