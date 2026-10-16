import type { ComponentType } from 'react'
import { ClaudeMetrics } from './ClaudeMetrics'
import { FileExplorer } from './FileExplorer'
import { GitIntel } from './GitIntel'
import { MusicControl } from './MusicControl'
import { NetworkPing } from './NetworkPing'
import { SystemTelemetry } from './SystemTelemetry'
import { TaskQueue } from './TaskQueue'
import { TerminalChat } from './TerminalChat'
import { AgentTopology } from './topology/AgentTopology'

/** Widget id → component. Ids are the keys used in saved layouts. */
export const WIDGETS = {
  explorer: FileExplorer,
  github: GitIntel,
  music: MusicControl,
  topology: AgentTopology,
  telemetry: SystemTelemetry,
  claude: ClaudeMetrics,
  network: NetworkPing,
  tasks: TaskQueue,
  terminal: TerminalChat,
} satisfies Record<string, ComponentType>

export type WidgetId = keyof typeof WIDGETS
