export interface TreeNode {
  name: string
  children?: TreeNode[]
}

// Placeholder workspace; later this comes from the local agent (fs + vault index).
export const TREE: TreeNode[] = [
  {
    name: 'vault',
    children: [
      { name: 'inbox', children: [{ name: 'agent ideas.md' }, { name: 'reading list.md' }] },
      {
        name: 'projects',
        children: [{ name: 'architecture.md' }, { name: 'agent-office.md' }, { name: 'arapca-video.md' }, { name: 'calendar-app.md' }],
      },
      { name: 'daily', children: [{ name: '2026-10-15.md' }, { name: '2026-10-16.md' }] },
      { name: 'brain.canvas' },
    ],
  },
  {
    name: 'agent-office-dashboard',
    children: [
      {
        name: 'src',
        children: [
          { name: 'widgets', children: [{ name: 'FileExplorer.tsx' }, { name: 'SystemTelemetry.tsx' }, { name: 'TerminalChat.tsx' }] },
          { name: 'layout', children: [{ name: 'Dashboard.tsx' }, { name: 'defaultLayouts.ts' }] },
          { name: 'index.css' },
          { name: 'main.tsx' },
        ],
      },
      { name: 'package.json' },
      { name: 'README.md' },
    ],
  },
  { name: 'CLAUDE.md' },
]

/** All ancestor folder paths of a file path, e.g. a/b/c.md → [a, a/b]. */
export function parentPaths(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}
