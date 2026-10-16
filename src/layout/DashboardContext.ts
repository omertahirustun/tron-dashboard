import { createContext, useContext } from 'react'

export interface DashboardControls {
  locked: boolean
  setLocked: (locked: boolean) => void
  resetLayout: () => void
}

export const DashboardContext = createContext<DashboardControls | null>(null)

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used inside <Dashboard>')
  return ctx
}
