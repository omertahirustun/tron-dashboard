import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The desktop bridge can run shell commands, so the built page only runs its
// own files. Dev mode skips this (Vite's HMR needs inline scripts and eval).
const CSP = [
  "default-src 'self' file:",
  // 'wasm-unsafe-eval': the terminal's sixel decoder is WebAssembly (no JS eval)
  "script-src 'self' file: 'wasm-unsafe-eval'",
  "style-src 'self' file: 'unsafe-inline'",
  // album art from YouTube Music
  "img-src 'self' file: data: https://*.googleusercontent.com https://*.ggpht.com https://i.ytimg.com",
  "font-src 'self' file: data:",
  "connect-src 'self' file:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// https://vite.dev/config/
export default defineConfig({
  // relative asset paths so the build also loads from file:// in the desktop app
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  server: { port: 5191, strictPort: true },
})
