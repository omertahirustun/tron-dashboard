// Offline stand-in for the Claude API. Keep the signature when wiring the real
// thing: call your own backend (never ship an API key to the browser) and
// yield text deltas from the streaming response.

const CANNED = [
  'Offline mode: no backend is connected yet, so this reply is simulated. Wire `streamReply` in src/services/claude.ts to your server to talk to the real model.',
  'Noted. Once the API is connected I can read the open file from the explorer and the task queue as context.',
  'The layout is yours to change: drag a panel by its header, resize from the corner, then lock it from the toolbar.',
]

let turn = 0

export async function* streamReply(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  void prompt
  const text = CANNED[turn++ % CANNED.length]
  for (const word of text.split(/(?<=\s)/)) {
    if (signal?.aborted) return
    await new Promise((r) => setTimeout(r, 28 + Math.random() * 50))
    yield word
  }
}
