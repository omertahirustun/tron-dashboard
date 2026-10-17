import type { ComponentType } from 'react'
import { AgentsLive } from './AgentsLive'
import { ClaudeMetrics } from './ClaudeMetrics'
import { FileExplorer } from './FileExplorer'
import { GitIntel } from './GitIntel'
import { MusicControl } from './MusicControl'
import { NetworkPing } from './NetworkPing'
import { SystemTelemetry } from './SystemTelemetry'
import { TodoList } from './TodoList'
import { AgentTopology } from './topology/AgentTopology'

/** Widget id → component. Ids are the keys used in saved layouts. */
export const WIDGETS = {
  explorer: FileExplorer,
  github: GitIntel,
  music: MusicControl,
  agents: AgentsLive,
  topology: AgentTopology,
  telemetry: SystemTelemetry,
  claude: ClaudeMetrics,
  network: NetworkPing,
  todo: TodoList,
} satisfies Record<string, ComponentType>

export type WidgetId = keyof typeof WIDGETS
