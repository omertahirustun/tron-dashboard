import { MotionConfig } from 'framer-motion'
import { Dashboard } from './layout/Dashboard'
import { TerminalWindow } from './terminal/TerminalWindow'

// The terminal window loads the same page with #terminal
const isTerminalWindow = window.location.hash === '#terminal'

export default function App() {
  return <MotionConfig reducedMotion="user">{isTerminalWindow ? <TerminalWindow /> : <Dashboard />}</MotionConfig>
}
