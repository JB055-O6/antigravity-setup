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

// As stored, per module id (core.ts holds the exact types; persist.ts checks what it reads back).
export type StoredEntry = { added: number; saved: number; acted: number }
export type StoredHealth = { on: boolean; fails: number; streak: number; lastErr?: string; off?: string }

declare module 'claude-code' {
  interface PluginState {
    company: {
      panel: Shaped<Panel>
      // This session's; hooks/persist.ts writes both.
      ledger: Shaped<Partial<Record<string, StoredEntry>>>
      health: Shaped<Partial<Record<string, StoredHealth>>>
    }
  }
}
