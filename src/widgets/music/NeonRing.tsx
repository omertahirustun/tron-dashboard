import { useEffect, useRef } from 'react'
import { frameLoop } from '../../lib/frameClock'
import { native } from '../../native/api'

/**
 * Album art in a ring of neon light that moves with the song: mirrored spectrum
 * spokes around the cover, three orbiting arcs that speed up with the energy, and
 * a bass shockwave. Colours come from the cover art (or the title when the art
 * can't be read), pushed to neon.
 *
 * Canvas only, drawn at ≤30 fps and only while playing or still settling: when
 * paused it draws one still frame and stops, so an idle dashboard costs nothing.
 */

const FPS = 30
const CYAN_HUE = 187

interface Props {
  playing: boolean
  art: string
  title: string
}

/** dominant saturated hue of an image, or null if it can't be read (CORS) */
function artHue(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 24
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(img, 0, 0, 24, 24)
        const d = g.getImageData(0, 0, 24, 24).data
        // hue histogram weighted by saturation × brightness, so grey/black covers fall through
        const bins = new Float32Array(36)
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i] / 255, gr = d[i + 1] / 255, b = d[i + 2] / 255
          const max = Math.max(r, gr, b), min = Math.min(r, gr, b), c2 = max - min
          if (c2 < 0.12) continue
          let h = max === r ? ((gr - b) / c2) % 6 : max === gr ? (b - r) / c2 + 2 : (r - gr) / c2 + 4
          h = (h * 60 + 360) % 360
          bins[Math.floor(h / 10)] += c2 * max
        }
        let best = -1, w = 0
        bins.forEach((v, i) => {
          if (v > w) {
            w = v
            best = i
          }
        })
        resolve(best < 0 || w < 3 ? null : best * 10 + 5)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function titleHue(title: string) {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 360
}

export function NeonRing({ playing, art, title }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const target = useRef<number[]>([])
  const live = useRef({ playing, hue: CYAN_HUE, img: null as HTMLImageElement | null, lastData: 0 })
  const kick = useRef<() => void>(() => {})

  // spectrum from the YouTube Music window
  useEffect(() => {
    if (!native) return
    return native.onMusicSpectrum((bands) => {
      target.current = bands
      live.current.lastData = performance.now()
      kick.current()
    })
  }, [])

  // colour and cover for the current track
  useEffect(() => {
    let gone = false
    live.current.hue = title ? titleHue(title) : CYAN_HUE
    live.current.img = null
    if (art) {
      void artHue(art).then((h) => {
        if (gone) return
        if (h !== null) live.current.hue = h
        kick.current()
      })
      const img = new Image()
      img.referrerPolicy = 'no-referrer'
      img.onload = () => {
        if (gone) return
        live.current.img = img
        kick.current()
      }
      img.src = art
    }
    kick.current()
    return () => {
      gone = true
    }
  }, [art, title])

  useEffect(() => {
    const canvas = canvasRef.current!
    const g = canvas.getContext('2d')!
    let running = false
    let lastFrame = 0
    // on the shared clock (30 = every half tick of the 15 fps grid)
    const loop = frameLoop((now) => frame(now), { keepWhenIdle: true })
    let w = 0, h = 0, dpr = 1
    const levels: number[] = []
    let bass = 0
    let energy = 0
    let spin = 0
    let artSpin = 0
    let shock = 0
    let shockR = 0
    let prevBass = 0
    let hue = live.current.hue

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      draw(0)
    }

    function draw(dt: number) {
      const { img, playing: on } = live.current
      // ease toward the song's hue so track changes cross-fade
      const dh = ((live.current.hue - hue + 540) % 360) - 180
      hue = (hue + dh * Math.min(1, dt * 3) + 360) % 360

      const src = on && performance.now() - live.current.lastData < 500 ? target.current : []
      const n = src.length || levels.length || 48
      let sum = 0, low = 0
      for (let i = 0; i < n; i++) {
        const v = ((src[i] ?? 0) / 255) ** 1.6
        const cur = levels[i] ?? 0
        // fast attack, slower release
        levels[i] = cur + (v - cur) * Math.min(1, dt * (v > cur ? 22 : 7))
        sum += levels[i]
        if (i < 6) low += levels[i]
      }
      energy += (sum / n - energy) * Math.min(1, dt * 6)
      const b = low / 6
      bass += (b - bass) * Math.min(1, dt * 18)
      // a kick: bass jumps well above its recent level
      if (bass - prevBass > 0.08 && bass > 0.35 && shock < 0.2) {
        shock = 1
        shockR = 0
      }
      prevBass += (bass - prevBass) * Math.min(1, dt * 4)
      shock = Math.max(0, shock - dt * 1.6)
      shockR += dt
      spin += dt * (0.35 + energy * 3.2)
      if (on) artSpin += dt * 0.25

      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2
      const R = Math.min(w, h) / 2
      const rArt = R * 0.5 * (1 + bass * 0.06)
      const rBase = R * 0.58
      const maxLen = R * 0.38
      const neon = (hh: number, l: number, a: number) => `hsl(${hh} 100% ${l}% / ${a})`

      // bass shockwave
      if (shock > 0) {
        g.beginPath()
        g.arc(cx, cy, rBase + shockR * R * 0.9, 0, Math.PI * 2)
        g.strokeStyle = neon(hue, 70, shock * 0.5)
        g.lineWidth = 1.5
        g.stroke()
      }

      g.globalCompositeOperation = 'lighter'

      // mirrored spokes, top centre = bass, bottom = treble
      const spokes = levels.length * 2
      g.lineCap = 'round'
      for (let pass = 0; pass < 2; pass++) {
        g.lineWidth = pass === 0 ? Math.max(3, (Math.PI * 2 * rBase) / spokes * 0.9) : 1.4
        for (let s = 0; s < spokes; s++) {
          const i = s < levels.length ? s : spokes - 1 - s
          const v = levels[i] ?? 0
          const len = 2 + v * maxLen
          const a = -Math.PI / 2 + (s / spokes) * Math.PI * 2 + 0.5 / spokes * Math.PI * 2
          const hh = (hue + (i / levels.length) * 70) % 360
          g.strokeStyle = pass === 0 ? neon(hh, 55, 0.12 + v * 0.25) : neon(hh, 62 + v * 25, 0.45 + v * 0.55)
          const c = Math.cos(a), sn = Math.sin(a)
          g.beginPath()
          g.moveTo(cx + c * rBase, cy + sn * rBase)
          g.lineTo(cx + c * (rBase + len), cy + sn * (rBase + len))
          g.stroke()
        }
      }

      // orbiting arcs: two with the song colour, one cyan the other way round
      const arcs = [
        { r: rArt + R * 0.035, len: 1.1, dir: 1, hh: hue, wdt: 2 },
        { r: rArt + R * 0.035, len: 0.5, dir: 1, hh: hue, wdt: 2, off: Math.PI },
        { r: R * 0.985 - 2, len: 0.8 + energy * 1.4, dir: -0.6, hh: CYAN_HUE, wdt: 1.5 },
      ]
      for (const arc of arcs) {
        const start = spin * arc.dir + (arc.off ?? 0)
        for (let pass = 0; pass < 2; pass++) {
          g.beginPath()
          g.arc(cx, cy, arc.r, start, start + arc.len)
          g.lineWidth = pass === 0 ? arc.wdt * 4 : arc.wdt
          g.strokeStyle = neon(arc.hh, pass === 0 ? 55 : 75, pass === 0 ? 0.15 + energy * 0.3 : 0.7 + energy * 0.3)
          g.stroke()
        }
      }

      g.globalCompositeOperation = 'source-over'

      // the cover, turning slowly like a record
      g.save()
      g.translate(cx, cy)
      g.rotate(artSpin)
      g.beginPath()
      g.arc(0, 0, rArt, 0, Math.PI * 2)
      g.clip()
      if (img) {
        // centre square: video thumbnails are 4:3 with the cover in the middle
        const side = Math.min(img.naturalWidth, img.naturalHeight)
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, -rArt, -rArt, rArt * 2, rArt * 2)
      } else {
        // no cover: a dark disc with grooves
        g.fillStyle = '#071216'
        g.fill()
        g.strokeStyle = 'rgb(13 230 255 / 0.12)'
        g.lineWidth = 1
        for (let k = 0.35; k < 1; k += 0.09) {
          g.beginPath()
          g.arc(0, 0, rArt * k, 0, Math.PI * 2)
          g.stroke()
        }
        g.beginPath()
        g.moveTo(0, -rArt * 0.95)
        g.lineTo(0, -rArt * 0.4)
        g.strokeStyle = 'rgb(13 230 255 / 0.6)'
        g.stroke()
      }
      g.restore()

      // lit rim + spindle
      g.beginPath()
      g.arc(cx, cy, rArt, 0, Math.PI * 2)
      g.lineWidth = 1.5
      g.strokeStyle = neon(hue, 70, 0.55 + bass * 0.45)
      g.stroke()
      g.beginPath()
      g.arc(cx, cy, Math.max(2, rArt * 0.07), 0, Math.PI * 2)
      g.fillStyle = '#050505'
      g.fill()
      g.lineWidth = 1
      g.strokeStyle = neon(hue, 75, 0.9)
      g.stroke()

      return levels.some((v) => v > 0.004) || shock > 0 || Math.abs(dh) > 1
    }

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - (lastFrame || now - 33)) / 1000)
      lastFrame = now
      const moving = draw(dt)
      // keep going while playing or while the light dies down; otherwise rest
      running = live.current.playing || moving
      if (running) loop.slow(FPS)
    }

    kick.current = () => {
      if (!running) {
        running = true
        lastFrame = performance.now() - 1000 / FPS
        loop.slow(FPS)
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    kick.current()
    return () => {
      ro.disconnect()
      loop.stop()
      kick.current = () => {}
    }
  }, [])

  // start / stop with playback
  useEffect(() => {
    live.current.playing = playing
    kick.current()
  }, [playing])

  return <canvas ref={canvasRef} className="block size-full" aria-hidden />
}
