export type PanelLine = { n: number; kind: string; text: string }
export type Panel = {
  version: string
  crew: number
  crewTotal: number
  directives: { name: string; on: boolean }[]
  fiveHour?: number
  week?: number
  economy: boolean
  routed: number
  governed: number
  diet: number
  log: PanelLine[]
}

declare module 'claude-code' {
  interface PluginState {
    company: { panel: Shaped<Panel> }
  }
}
