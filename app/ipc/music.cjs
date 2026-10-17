// YouTube Music in its own (normally hidden) window. The dashboard widget drives
// it: play/pause, next/previous, seek, volume and search-and-play. Sign-in and
// cookies live in the window's own persistent partition, so a login sticks.
// The page is remote, so it gets no preload and never sees the native API; the
// main process talks to it only through executeJavaScript.
const { BrowserWindow, session } = require('electron')
const path = require('node:path')

const HOME = 'https://music.youtube.com/'
const PARTITION = 'persist:ytmusic'
// Google refuses sign-in from embedded browsers it recognises (Electron's UA,
// or Chromium client hints without the Chrome brand). Present the window as
// desktop Firefox, which YouTube Music fully supports and which sends no hints.
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'

let sessionReady = false
function prepareSession() {
  const ses = session.fromPartition(PARTITION)
  if (sessionReady) return ses
  sessionReady = true
  ses.setUserAgent(BROWSER_UA)
  ses.webRequest.onBeforeSendHeaders((details, done) => {
    const headers = { ...details.requestHeaders, 'User-Agent': BROWSER_UA }
    for (const h of Object.keys(headers)) if (/^sec-ch-ua/i.test(h)) delete headers[h]
    done({ requestHeaders: headers })
  })
  return ses
}

// Library playlists, read from /library/playlists in a throwaway hidden window
// (the player window keeps playing). Liked music is always first.
const READ_PLAYLISTS = `(() => {
  const items = [...document.querySelectorAll('ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer')]
  const out = []
  for (const el of items) {
    const a = el.querySelector('a[href*="list="]')
    if (!a) continue
    const id = new URL(a.href, location.origin).searchParams.get('list')
    const title = (el.querySelector('.title')?.textContent || a.title || a.textContent || '').trim()
    if (!id || !title || out.some((p) => p.id === id)) continue
    const img = el.querySelector('img')
    out.push({ id, title, sub: (el.querySelector('.subtitle, .secondary-flex-columns')?.textContent || '').replace(/\\s+/g, ' ').trim(), art: img?.src || '' })
  }
  return { signedIn: !document.querySelector('ytmusic-guide-signin-promo-renderer, a[href*="ServiceLogin"]'), items: out }
})()`
const POLL_MS = 1000
const SPECTRUM_MS = 33
const BANDS = 48

// The <video> that is actually playing. YouTube Music can keep a second element
// to preload the next track, so the first one in the page may be the old song.
const ACTIVE_VIDEO = `(() => {
  const all = [...document.querySelectorAll('video')]
  return all.find((v) => !v.paused && !v.ended && v.readyState > 2) || document.querySelector('#movie_player video') || all[0] || null
})()`

// Runs inside music.youtube.com: routes every <video> through one Web Audio analyser
// (each element once; YouTube feeds them through MediaSource from its own origin,
// so the data isn't tainted) and returns BANDS log-spaced levels 0..255. Playback
// keeps going through the graph, so it is built once and only ever added to.
const READ_SPECTRUM = `(() => {
  const video = ${ACTIVE_VIDEO}
  if (!video) return null
  let tap = window.__aodTap
  try {
    if (!tap) {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.72
      analyser.connect(ctx.destination)
      tap = window.__aodTap = { ctx, analyser, tapped: new WeakSet(), bins: new Uint8Array(analyser.frequencyBinCount) }
    }
    for (const v of document.querySelectorAll('video')) {
      if (tap.tapped.has(v)) continue
      tap.ctx.createMediaElementSource(v).connect(tap.analyser)
      tap.tapped.add(v)
    }
  } catch (e) {
    return null
  }
  if (tap.ctx.state !== 'running') void tap.ctx.resume()
  tap.analyser.getByteFrequencyData(tap.bins)
  const n = tap.bins.length, out = new Array(${BANDS})
  // 40 Hz .. 16 kHz, log spaced; every band at least one bin of its own
  if (!tap.edges) {
    const hz = tap.ctx.sampleRate / 2 / n
    tap.edges = [Math.max(1, Math.floor(40 / hz))]
    for (let b = 1; b <= ${BANDS}; b++) tap.edges[b] = Math.min(n, Math.max(tap.edges[b - 1] + 1, Math.floor(40 * Math.pow(400, b / ${BANDS}) / hz)))
  }
  // the analyser hears the element after its volume; undo that (bins are dB, -100..-30
  // over 0..255) so the lights don't fade when the music is turned down
  const comp = video.volume > 0.01 ? (-20 * Math.log10(video.volume) / 70) * 255 : 0
  for (let b = 0; b < ${BANDS}; b++) {
    let m = 0
    for (let i = tap.edges[b]; i < tap.edges[b + 1]; i++) if (tap.bins[i] > m) m = tap.bins[i]
    out[b] = m ? Math.min(255, Math.round(m + comp)) : 0
  }
  return out
})()`

// Runs inside music.youtube.com. Reads the player bar and media session.
const READ_STATE = `(() => {
  const video = ${ACTIVE_VIDEO}
  // the player's own clock is per track (the element's can run on across tracks)
  const player = document.querySelector('#movie_player')
  const pt = player && player.getCurrentTime ? Number(player.getCurrentTime()) : NaN
  const pd = player && player.getDuration ? Number(player.getDuration()) : NaN
  const meta = navigator.mediaSession && navigator.mediaSession.metadata
  const bar = document.querySelector('ytmusic-player-bar')
  const title = (meta && meta.title) || bar?.querySelector('.title')?.textContent?.trim() || ''
  const artist = (meta && meta.artist) || bar?.querySelector('.byline')?.textContent?.trim() || ''
  const art = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : ''
  return {
    ready: !!bar,
    title,
    artist,
    album: (meta && meta.album) || '',
    art,
    playing: !!video && !video.paused && !video.ended && video.readyState > 2,
    current: isFinite(pt) ? pt : video ? video.currentTime : 0,
    duration: isFinite(pd) && pd > 0 ? pd : video && isFinite(video.duration) ? video.duration : 0,
    volume: video ? Math.round(video.volume * 100) : 100,
    // YouTube plays ads without Premium; the widget says so instead of showing the ad as a track
    ad: !!document.querySelector('#movie_player.ad-showing'),
    signedIn: !!document.querySelector('ytmusic-settings-button img, #avatar-button img, ytmusic-settings-button yt-img-shadow'),
  }
})()`

const click = (selector) => `(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (b) b.click(); return !!b })()`

// first play button in the page's results (search page or home "quick picks")
const PLAY_FIRST = `(() => {
  // the home page stays in the DOM under the search page, so search results come first
  const onSearch = location.pathname.startsWith('/search')
  const root = (onSearch ? document.querySelector('ytmusic-tabbed-search-results-renderer') : document.querySelector('ytmusic-browse-response')) || document
  const btn = root.querySelector('ytmusic-card-shelf-renderer ytmusic-play-button-renderer, ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer, ytmusic-play-button-renderer')
  if (!btn) return false
  btn.click()
  return true
})()`

function createMusic(send, { icon }) {
  let win = null
  let timer = null
  let last = null
  let quitting = false
  let spectrumTimer = null
  let reading = false

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win
    prepareSession()
    win = new BrowserWindow({
      width: 1100,
      height: 760,
      show: false,
      title: 'YouTube Music · Tron Dashboard',
      icon,
      backgroundColor: '#030303',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // keeps playing and answering polls while hidden
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    win.webContents.setUserAgent(BROWSER_UA)
    // YouTube Music sets a "leave site?" handler while playing; Electron shows no
    // dialog and silently cancels the navigation, which blocked going to the
    // Google sign-in page (and loading a search or playlist). Always allow it.
    win.webContents.on('will-prevent-unload', (e) => e.preventDefault())
    // closing the window only hides it, so the music keeps going
    win.on('close', (e) => {
      if (quitting) return
      e.preventDefault()
      win.hide()
    })
    win.on('closed', () => {
      win = null
    })
    // stay on YouTube Music / Google sign-in; anything else opens in the browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      require('electron').shell.openExternal(url)
      return { action: 'deny' }
    })
    void win.loadURL(HOME)
    startPolling()
    return win
  }

  async function run(js) {
    const w = ensureWindow()
    if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-stop-loading', r))
    return w.webContents.executeJavaScript(js, true)
  }

  async function poll() {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return
    try {
      last = { ...(await win.webContents.executeJavaScript(READ_STATE, true)), visible: win.isVisible(), at: Date.now() }
      send('music:state', last)
    } catch {
      /* page navigating */
    }
  }

  /** ~30 Hz levels for the widget's visualizer, only while something plays. */
  async function readSpectrum() {
    if (reading || !last?.playing || last.ad || !win || win.isDestroyed() || win.webContents.isLoading()) return
    reading = true
    try {
      const bands = await win.webContents.executeJavaScript(READ_SPECTRUM, true)
      if (bands) send('music:spectrum', bands)
    } catch {
      /* page navigating */
    } finally {
      reading = false
    }
  }

  function startPolling() {
    if (timer) return
    timer = setInterval(poll, POLL_MS)
    spectrumTimer = setInterval(readSpectrum, SPECTRUM_MS)
  }

  /** Retry until the results page has a play button (it renders after load). */
  async function playFirst(timeoutMs = 12000) {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (await run(PLAY_FIRST)) return true
      await new Promise((r) => setTimeout(r, 400))
    }
    return false
  }

  return {
    state: () => last,
    async open() {
      ensureWindow()
      return last
    },
    show() {
      const w = ensureWindow()
      if (w.isVisible() && w.isFocused()) w.hide()
      else {
        w.show()
        w.focus()
      }
      void poll()
    },
    async toggle() {
      const s = last ?? (await run(READ_STATE))
      // nothing loaded yet: start the first pick on the page
      if (!s.title) return playFirst()
      return run(click('ytmusic-player-bar #play-pause-button'))
    },
    next: () => run(click('ytmusic-player-bar .next-button')),
    previous: () => run(click('ytmusic-player-bar .previous-button')),
    seek: (fraction) =>
      run(`(() => {
        const f = ${Math.max(0, Math.min(1, Number(fraction) || 0))}
        const p = document.querySelector('#movie_player')
        if (p && p.seekTo && p.getDuration && p.getDuration() > 0) return p.seekTo(p.getDuration() * f, true)
        const v = ${ACTIVE_VIDEO}
        if (v && isFinite(v.duration)) v.currentTime = v.duration * f
      })()`),
    volume: (pct) =>
      run(`(() => { const p = document.querySelector('#movie_player'); const n = ${Math.max(0, Math.min(100, Math.round(Number(pct) || 0)))}; if (p && p.setVolume) p.setVolume(n); for (const v of document.querySelectorAll('video')) v.volume = n / 100 })()`),
    async search(query) {
      const q = String(query).trim()
      if (!q) return false
      const w = ensureWindow()
      await w.loadURL(`${HOME}search?q=${encodeURIComponent(q)}`)
      return playFirst()
    },
    /** the signed-in account's playlists (empty with signedIn false when logged out) */
    async playlists() {
      prepareSession()
      const reader = new BrowserWindow({
        show: false,
        webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'user-gesture-required' },
      })
      reader.webContents.setAudioMuted(true)
      try {
        reader.webContents.setUserAgent(BROWSER_UA)
        await reader.loadURL(`${HOME}library/playlists`)
        // the shelf renders after load; wait until the count stops changing
        let last = { signedIn: false, items: [] }
        for (let i = 0, stable = 0; i < 30 && stable < 3; i++) {
          await new Promise((r) => setTimeout(r, 400))
          const next = await reader.webContents.executeJavaScript(READ_PLAYLISTS, true)
          stable = next.items.length && next.items.length === last.items.length ? stable + 1 : 0
          last = next
        }
        return last
      } finally {
        reader.destroy()
      }
    },
    /** play a playlist from the start (LM = liked music) */
    async playPlaylist(id) {
      const list = String(id)
      if (!/^[\w-]+$/.test(list)) throw new Error('Bad playlist id')
      const w = ensureWindow()
      await w.loadURL(`${HOME}watch?list=${list}`)
      return true
    },
    stop() {
      quitting = true
      clearInterval(timer)
      clearInterval(spectrumTimer)
      timer = spectrumTimer = null
      if (win && !win.isDestroyed()) win.destroy()
    },
  }
}

module.exports = { createMusic, MUSIC_ICON: path.join(__dirname, '..', 'icon.png') }
