# Agent Office Grid

A desktop dashboard for watching and driving local AI agent work, styled after
the Tron "Grid": glass panels on a perspective floor, neon cyan for structure,
orange for anything running or needing attention.

Nine draggable, resizable panels: workspace explorer, git, YT Music, agent
topology, system telemetry, Claude metrics, network ping, task queue, and a
command center with a real shell next to the Claude chat.

## Run

```sh
npm install
npm run app        # build, then open the desktop app (system electron43)
npm run app:dev    # desktop app against the Vite dev server (start `npm run dev` first)
npm run dev        # browser only: widgets fall back to sample data
```

A launcher is installed at `~/.local/share/applications/agent-office-grid.desktop`.

## How it is put together

- `src/` React 19 + TypeScript + Tailwind v4. Layout: react-grid-layout 1.5
  (one grid per breakpoint, free placement). Shared state: zustand
  (`src/store/useOfficeStore.ts`). Topology: React Flow.
- `app/main.cjs` Electron main process. Renders on the NVIDIA GPU (PRIME
  offload + XWayland) and answers IPC from the page.
- `app/preload.cjs` the only bridge: `window.api` with a fixed set of methods.
  Every call is checked to come from the app's own page.
- `app/ipc/` native features:
  - `workspace.cjs` read-only file access, limited to the workspace roots
  - `pty.cjs` + `pty_bridge.py` the shell (fish, else bash) in a real PTY,
    without native Node modules
  - `git.cjs` branch, changes and commits; watches `.git` for updates
  - `metrics.cjs` CPU per thread, RAM, temperature, VRAM (one long-lived
    `nvidia-smi`)
  - `tasks.cjs` runs the task queue commands, each in its own process group
  - `network.cjs` TCP/HTTP latency probes
  - `claude-usage.cjs` context fill and daily usage from Claude Code transcripts
  - `sessions.cjs` live Claude Code sessions, their subagents and touched
    files, which drive the topology graph

Settings (workspace folders, tasks, probe targets, daily budget) live in
`~/.config/Agent Office Grid/settings.json`.

## Terminal

The input line has two modes, switched with Ctrl+K: **shell** sends the line
to fish, **claude** sends it to the chat. Dashboard commands start with `:`
(`:help` lists them), so they never collide with shell input.

## Performance note

Every panel blurs what is behind it (`backdrop-filter`), and any motion on
screen makes all of those blurs re-render each frame. Idle motion is therefore
kept rare: the floor steps at 15 fps, the selected agent's glow pulses in
steps, and topology edges only flow while a session or subagent is working
(activity in the last 30 seconds).
