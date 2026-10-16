// Sound-design-ready UI event bus.
// Components emit semantic events; a future audio engine subscribes with
// `sfx.on(...)` and maps each event to a sample. Nothing here plays sound.

export type SfxEvent =
  | 'hover'
  | 'click'
  | 'toggle'
  | 'open'
  | 'close'
  | 'select'
  | 'drag-start'
  | 'drag-stop'
  | 'resize-stop'
  | 'key'
  | 'submit'
  | 'alert'

export interface SfxMeta {
  /** What emitted the event, e.g. "explorer.file" or "terminal.input" */
  source?: string
  [key: string]: unknown
}

type Listener = (event: SfxEvent, meta: SfxMeta) => void

const listeners = new Set<Listener>()

const debug = (() => {
  try {
    return localStorage.getItem('aod.sfx.debug') === '1'
  } catch {
    return false
  }
})()

export const sfx = {
  emit(event: SfxEvent, meta: SfxMeta = {}) {
    if (debug) console.debug('[sfx]', event, meta)
    for (const listener of listeners) listener(event, meta)
  },
  on(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Spread onto any interactive element to emit hover + click events. */
export function sfxProps(source: string) {
  return {
    onMouseEnter: () => sfx.emit('hover', { source }),
    onClickCapture: () => sfx.emit('click', { source }),
  }
}
