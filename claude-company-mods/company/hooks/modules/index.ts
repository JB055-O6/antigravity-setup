// Every module, in spec order. register.tsx calls each register<Name> in this same order.
// A module not yet built has meta only.
import type { ModuleMeta } from '../core'

export const MODULE_META: readonly ModuleMeta[] = [
  { id: 'charter', title: 'Charter', what: 'Puts the client charter into the system prompt.', caps: {} },
  { id: 'meter', title: 'Meter', what: 'Reads the five-hour and weekly limits and starts economy mode near them.', caps: {} },
  { id: 'router', title: 'Router', what: 'Sends each subagent to the cheapest model that fits its task.', caps: {} },
  { id: 'governor', title: 'Governor', what: 'Lowers wasteful effort on each model request.', caps: {} },
  { id: 'diet', title: 'Diet', what: 'Caps big file reads and search output, and tells subagents to report in short form.', caps: {} },
  { id: 'bashcap', title: 'Bash cap', what: 'Cuts huge Bash output and keeps its head, its tail and its error lines.', caps: {} },
  { id: 'rtk', title: 'RTK', what: 'Changes Bash commands to their RTK form, which prints less.', caps: {} },
  { id: 'graph', title: 'Graph', what: 'Builds and updates the code graph and adds one hint line.', caps: {} },
  { id: 'audit', title: 'Audit', what: 'Measures the cost of each system prompt section and tool description.', caps: {} },
  { id: 'nudge', title: 'Nudge', what: 'Suggests /compact when the context window is 60% full.', caps: {} },
  { id: 'install', title: 'Install', what: 'Installs RTK and graphify after you ask for them.', caps: {} },
  { id: 'dashboard', title: 'Dashboard', what: 'Shows the band, the pane and the /company text.', caps: {} },
]
