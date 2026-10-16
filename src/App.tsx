import { MotionConfig } from 'framer-motion'
import { Dashboard } from './layout/Dashboard'

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Dashboard />
    </MotionConfig>
  )
}
