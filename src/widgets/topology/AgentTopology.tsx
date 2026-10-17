import { Globe, Share2, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { TronButton } from '../../components/TronButton'
import { Widget } from '../../components/Widget'
import { native } from '../../native/api'
import { useOfficeStore } from '../../store/useOfficeStore'
import { CodeGlobe } from './globes'

// The graphify panel: the selected repo's code graph (graphify's own export, or
// an import scan until it has one) as a globe or as a flat dot graph.

const VIEW_KEY = 'aod.topology.view.v2'
type View = 'globe' | 'flat'
const VIEWS: Array<{ id: View; Icon: typeof Globe; label: string }> = [
  { id: 'globe', Icon: Globe, label: 'Graph on a globe' },
  { id: 'flat', Icon: Waypoints, label: 'Flat dot graph' },
]
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'flat' ? 'flat' : 'globe'
  } catch {
    return 'globe'
  }
}

export function AgentTopology() {
  const [view, setViewState] = useState<View>(savedView)
  const repo = useOfficeStore((s) => s.activeRepo)
  const setView = (next: View) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // storage blocked: the choice just isn't remembered
    }
  }
  return (
    <Widget
      title="graphify"
      icon={Share2}
      flush
      actions={VIEWS.map(({ id, Icon, label }) => (
        <TronButton key={id} sfxSource={`topology.view.${id}`} variant={view === id ? 'solid' : 'ghost'} onClick={() => setView(id)} aria-label={label} aria-pressed={view === id} title={label}>
          <Icon size={12} />
        </TronButton>
      ))}
      status={
        <span className="max-w-[260px] truncate text-cyan" title={repo ?? ''}>
          {!native && <span className="text-orange">sample </span>}
          {repo ? repo.replace(/^\/home\/[^/]+/, '~') : 'no repo'}
        </span>
      }
    >
      <CodeGlobe flat={view === 'flat'} />
    </Widget>
  )
}
