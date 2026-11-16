export type Mode = 'solo' | 'full'

/** G1 Intake, G2 Assessment and questions, G3 Simulation of consequences,
 *  G4 Client review and agreement, G5 Plan into phases and chunks,
 *  G6 Staffing, G7 Execution reports checks rework, G8 Proof and delivery. */
export type Gate = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8'

export type ChunkStatus = 'todo' | 'doing' | 'reported' | 'rejected' | 'accepted'

export interface Chunk {
  id: string
  title: string
  owner: string
  model: string
  effort: string
  status: ChunkStatus
  evidence: string[]
}

export interface CheckRecord {
  name: string
  pass: boolean
  at: number
  evidence: string
}

export interface HistoryEntry {
  at: number
  from: Gate
  to: Gate
  note: string
}

export interface Job {
  id: string
  title: string
  mode: Mode
  gate: Gate
  clientAgreed: boolean
  chunks: Chunk[]
  checks: CheckRecord[]
  history: HistoryEntry[]
}

declare module 'claude-code' {
  interface PluginState {
    company: { jobs: Job[]; currentJobId: string | null }
  }
}
