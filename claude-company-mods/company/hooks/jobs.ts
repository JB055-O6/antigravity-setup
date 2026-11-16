import type {
  CheckRecord,
  Chunk,
  ChunkStatus,
  Gate,
  Job,
  Mode,
} from '../types/index'

export type JobResult = { ok: true; job: Job } | { ok: false; reason: string }

const GATES: readonly Gate[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']

const gateIndex = (g: Gate): number => GATES.indexOf(g)

const refuse = (reason: string): JobResult => ({ ok: false, reason })
const accept = (job: Job): JobResult => ({ ok: true, job })

const CHUNK_MOVES: Record<ChunkStatus, readonly ChunkStatus[]> = {
  todo: ['doing'],
  doing: ['reported'],
  reported: ['accepted', 'rejected'],
  rejected: ['doing'],
  accepted: [],
}

export function createJob(id: string, title: string, mode: Mode, _now: number): Job {
  return {
    id,
    title,
    mode,
    gate: 'G1',
    clientAgreed: false,
    chunks: [],
    checks: [],
    history: [],
  }
}

export function recordAgreement(job: Job): JobResult {
  if (job.gate !== 'G4') {
    return refuse('Agreement can only be recorded at gate G4 (client review).')
  }
  return accept({ ...job, clientAgreed: true })
}

export function addChunk(job: Job, chunk: Chunk): JobResult {
  if (job.gate !== 'G5' && job.gate !== 'G6') {
    return refuse('Chunks can only be added at gate G5 or G6.')
  }
  if (job.chunks.some(c => c.id === chunk.id)) {
    return refuse(`A chunk with id ${chunk.id} already exists.`)
  }
  if (!chunk.owner.trim()) return refuse('A chunk needs an owner before work starts.')
  if (!chunk.model.trim()) return refuse('A chunk needs a model decided before work starts.')
  if (!chunk.effort.trim()) return refuse('A chunk needs an effort level decided before work starts.')
  return accept({ ...job, chunks: [...job.chunks, { ...chunk, evidence: [...chunk.evidence] }] })
}

export function setChunkStatus(
  job: Job,
  chunkId: string,
  status: ChunkStatus,
  evidence?: string,
): JobResult {
  if (job.gate !== 'G7') return refuse('Chunk status can only change at gate G7.')
  const chunk = job.chunks.find(c => c.id === chunkId)
  if (!chunk) return refuse(`No chunk with id ${chunkId} exists.`)
  if (!CHUNK_MOVES[chunk.status].includes(status)) {
    return refuse(`A chunk cannot move from ${chunk.status} to ${status}.`)
  }
  const text = evidence ?? ''
  if ((status === 'reported' || status === 'accepted') && !text.trim()) {
    return refuse(`Moving a chunk to ${status} requires evidence.`)
  }
  const next: Chunk = {
    ...chunk,
    status,
    evidence: text.trim() ? [...chunk.evidence, text] : [...chunk.evidence],
  }
  return accept({ ...job, chunks: job.chunks.map(c => (c.id === chunkId ? next : c)) })
}

export function recordCheck(job: Job, check: CheckRecord): JobResult {
  return accept({ ...job, checks: [...job.checks, { ...check }] })
}

export function latestChecks(job: Job): CheckRecord[] {
  const latest = new Map<string, CheckRecord>()
  for (const c of job.checks) {
    const prev = latest.get(c.name)
    // Later entries win ties, so the most recently recorded one is kept.
    if (!prev || c.at >= prev.at) latest.set(c.name, c)
  }
  return [...latest.values()]
}

export function advance(job: Job, to: Gate, now: number, note: string): JobResult {
  const from = job.gate
  if (job.mode === 'full') {
    if (gateIndex(to) !== gateIndex(from) + 1) {
      return refuse('Full mode only moves to the next gate, with no skipping.')
    }
    if (gateIndex(to) >= gateIndex('G5') && !job.clientAgreed) {
      return refuse('Full mode cannot move to G5 or later until the client has agreed.')
    }
    if (to === 'G7' && job.chunks.length === 0) {
      return refuse('Full mode cannot move to G7 without at least one chunk.')
    }
  } else {
    const ok = (from === 'G1' && to === 'G7') || (from === 'G7' && to === 'G8')
    if (!ok) return refuse('Solo mode only allows the path G1 to G7 to G8.')
  }
  if (to === 'G8') {
    if (job.checks.length === 0) return refuse('Delivery at G8 requires at least one recorded check.')
    if (!latestChecks(job).every(c => c.pass)) {
      return refuse('Delivery at G8 requires the latest run of every check to pass.')
    }
    if (job.mode === 'full' && !job.chunks.every(c => c.status === 'accepted')) {
      return refuse('Delivery at G8 in full mode requires every chunk to be accepted.')
    }
  }
  return accept({ ...job, gate: to, history: [...job.history, { at: now, from, to, note }] })
}

export function reopen(job: Job, to: Gate, now: number, note: string): JobResult {
  if (gateIndex(to) >= gateIndex(job.gate)) {
    return refuse('Reopening must go back to an earlier gate than the current one.')
  }
  if (!note.trim()) return refuse('Reopening requires a note saying why.')
  return accept({
    ...job,
    gate: to,
    clientAgreed: gateIndex(to) <= gateIndex('G4') ? false : job.clientAgreed,
    history: [...job.history, { at: now, from: job.gate, to, note }],
  })
}

export function escalateToFull(job: Job, now: number, note: string): JobResult {
  if (job.mode === 'full') return refuse('The job is already in full mode.')
  return accept({
    ...job,
    mode: 'full',
    gate: 'G2',
    history: [...job.history, { at: now, from: job.gate, to: 'G2', note }],
  })
}
