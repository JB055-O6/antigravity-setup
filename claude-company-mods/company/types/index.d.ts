export type PanelLine = { n: number; kind: string; text: string }
export type CrewRun = { id: string; type: string; model: string; effort: string; task: string; steps: number; status: 'running' | 'done' | 'failed' | 'background' }
export type Panel = {
  version: string
  crew: number
  crewTotal: number
  roster: { name: string; model: string; effort: string; does: string }[]
  directives: { name: string; on: boolean }[]
  fiveHour?: number
  week?: number
  economy: boolean
  routed: number
  governed: number
  diet: number
  log: PanelLine[]
  runs: CrewRun[]
}

declare module 'claude-code' {
  interface PluginState {
    company: { panel: Shaped<Panel> }
  }
}
