import { expect, test } from 'claude-code/testing'
import {
  addChunk,
  advance,
  createJob,
  escalateToFull,
  latestChecks,
  recordAgreement,
  recordCheck,
  reopen,
  setChunkStatus,
} from './jobs'
import type {
  CheckRecord,
  Chunk,
  ChunkStatus,
  Gate,
  Job,
} from '../types/index'
import type { JobResult } from './jobs'

const GATES: Gate[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']
const STATUSES: ChunkStatus[] = ['todo', 'doing', 'reported', 'rejected', 'accepted']

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function must(r: JobResult): Job {
  if (!r.ok) throw new Error(`expected success, got refusal: ${r.reason}`)
  return r.job
}

function refusedWith(r: JobResult): string {
  if (r.ok) throw new Error('expected a refusal, got success')
  return r.reason
}

const chunk = (id: string, over: Partial<Chunk> = {}): Chunk => ({
  id,
  title: `chunk ${id}`,
  owner: 'alice',
  model: 'model-a',
  effort: 'high',
  status: 'todo',
  evidence: [],
  ...over,
})

const check = (name: string, pass: boolean, at: number): CheckRecord => ({
  name,
  pass,
  at,
  evidence: `${name} ${pass ? 'passed' : 'failed'}`,
})

/** A full-mode job at G4, client not yet agreed. */
function fullAtG4(): Job {
  let j = createJob('f', 'Full job', 'full', 0)
  j = must(advance(j, 'G2', 1, 'assess'))
  j = must(advance(j, 'G3', 2, 'simulate'))
  return must(advance(j, 'G4', 3, 'client review'))
}

/** A full-mode job at G5, client agreed. */
function fullAtG5(): Job {
  return must(advance(must(recordAgreement(fullAtG4())), 'G5', 4, 'plan'))
}

/** A full-mode job at G6, client agreed. */
function fullAtG6(): Job {
  return must(advance(fullAtG5(), 'G6', 5, 'staff'))
}

/** A full-mode job at G7 with the given chunks, all still todo. */
function fullAtG7(chunks: Chunk[] = [chunk('c1')]): Job {
  let j = fullAtG6()
  for (const c of chunks) j = must(addChunk(j, c))
  return must(advance(j, 'G7', 6, 'execute'))
}

/** A solo job at G7. */
function soloAtG7(): Job {
  return must(advance(createJob('s', 'Solo job', 'solo', 0), 'G7', 1, 'execute'))
}

/** A full-mode job at G7 whose only chunk is in the given status. */
function chunkAt(status: ChunkStatus): Job {
  let j = fullAtG7()
  if (status === 'todo') return j
  j = must(setChunkStatus(j, 'c1', 'doing'))
  if (status === 'doing') return j
  j = must(setChunkStatus(j, 'c1', 'reported', 'e'))
  if (status === 'reported') return j
  if (status === 'accepted') return must(setChunkStatus(j, 'c1', 'accepted', 'e'))
  return must(setChunkStatus(j, 'c1', 'rejected'))
}

/** A full-mode job at G7 with one accepted chunk, ready for G8 once a check passes. */
function fullReadyForG8(): Job {
  let j = fullAtG7()
  j = must(setChunkStatus(j, 'c1', 'doing'))
  j = must(setChunkStatus(j, 'c1', 'reported', 'pr #1'))
  return must(setChunkStatus(j, 'c1', 'accepted', 'reviewed'))
}

// ---------------------------------------------------------------- rule 1

test('rule 1: createJob gives a G1 job, not agreed, empty, in the given mode', () => {
  const full = createJob('f', 'Full', 'full', 100)
  expect(full).toEqual({
    id: 'f',
    title: 'Full',
    mode: 'full',
    gate: 'G1',
    clientAgreed: false,
    chunks: [],
    checks: [],
    history: [],
  })
  const solo = createJob('s', 'Solo', 'solo', 100)
  expect(solo.mode).toBe('solo')
  expect(solo.gate).toBe('G1')
  expect(solo.clientAgreed).toBe(false)
  expect(solo.chunks).toEqual([])
  expect(solo.checks).toEqual([])
  expect(solo.history).toEqual([])
})

// ---------------------------------------------------------------- rule 2

test('rule 2: full-mode happy path from G1 to G8', () => {
  let j = createJob('j1', 'Job', 'full', 0)
  j = must(advance(j, 'G2', 10, 'assess'))
  expect(j.gate).toBe('G2')
  j = must(advance(j, 'G3', 11, 'simulate'))
  expect(j.gate).toBe('G3')
  j = must(advance(j, 'G4', 12, 'client review'))
  expect(j.gate).toBe('G4')
  j = must(recordAgreement(j))
  expect(j.clientAgreed).toBe(true)
  j = must(advance(j, 'G5', 20, 'plan'))
  j = must(advance(j, 'G6', 21, 'staff'))
  j = must(addChunk(j, chunk('c1')))
  j = must(advance(j, 'G7', 22, 'execute'))
  j = must(setChunkStatus(j, 'c1', 'doing'))
  j = must(setChunkStatus(j, 'c1', 'reported', 'pr #1'))
  j = must(setChunkStatus(j, 'c1', 'accepted', 'reviewed'))
  j = must(recordCheck(j, check('unit', true, 30)))
  j = must(advance(j, 'G8', 31, 'deliver'))

  expect(j.gate).toBe('G8')
  expect(j.history.map(h => `${h.from}>${h.to}`)).toEqual([
    'G1>G2',
    'G2>G3',
    'G3>G4',
    'G4>G5',
    'G5>G6',
    'G6>G7',
    'G7>G8',
  ])
  expect(j.chunks[0]!.status).toBe('accepted')
  expect(j.chunks[0]!.evidence).toEqual(['pr #1', 'reviewed'])
})

test('rule 2: full mode refuses any skip', () => {
  const j1 = createJob('j', 'Job', 'full', 0)
  refusedWith(advance(j1, 'G3', 1, 'skip'))
  refusedWith(advance(j1, 'G8', 1, 'skip'))
  const j2 = must(advance(j1, 'G2', 1, 'ok'))
  refusedWith(advance(j2, 'G4', 2, 'skip'))
  refusedWith(advance(j2, 'G5', 2, 'skip'))
})

test('rule 2: full mode refuses a move to the same or an earlier gate', () => {
  const j = must(advance(must(advance(createJob('j', 'Job', 'full', 0), 'G2', 1, 'a')), 'G3', 2, 'b'))
  refusedWith(advance(j, 'G3', 3, 'same'))
  refusedWith(advance(j, 'G2', 3, 'back'))
  refusedWith(advance(j, 'G1', 3, 'back'))
})

// ---------------------------------------------------------------- rule 3

test('rule 3: solo mode allows G1 to G7 and G7 to G8', () => {
  let j = createJob('s', 'Solo', 'solo', 0)
  j = must(advance(j, 'G7', 1, 'execute'))
  expect(j.gate).toBe('G7')
  j = must(recordCheck(j, check('unit', true, 2)))
  j = must(advance(j, 'G8', 3, 'deliver'))
  expect(j.gate).toBe('G8')
  expect(j.history.map(h => `${h.from}>${h.to}`)).toEqual(['G1>G7', 'G7>G8'])
})

test('rule 3: solo mode refuses every other move from G1', () => {
  const j = createJob('s', 'Solo', 'solo', 0)
  for (const to of GATES) {
    if (to === 'G7') continue
    refusedWith(advance(j, to, 1, 'nope'))
  }
})

test('rule 3: solo mode refuses every other move from G7', () => {
  const j = soloAtG7()
  for (const to of GATES) {
    if (to === 'G8') continue
    refusedWith(advance(j, to, 2, 'nope'))
  }
})

// ---------------------------------------------------------------- rule 4

test('rule 4: recordAgreement is refused before G4', () => {
  const j1 = createJob('f', 'Full', 'full', 0)
  refusedWith(recordAgreement(j1))
  const j2 = must(advance(j1, 'G2', 1, 'a'))
  refusedWith(recordAgreement(j2))
  const j3 = must(advance(j2, 'G3', 2, 'b'))
  refusedWith(recordAgreement(j3))
  expect(j3.clientAgreed).toBe(false)
})

test('rule 4: recordAgreement is refused after G4 and accepted at G4', () => {
  refusedWith(recordAgreement(fullAtG5()))
  const j = fullAtG4()
  const agreed = must(recordAgreement(j))
  expect(agreed.clientAgreed).toBe(true)
  expect(agreed.gate).toBe('G4')
})

// ---------------------------------------------------------------- rule 5

test('rule 5: full mode refuses G5 until the client has agreed', () => {
  const j = fullAtG4()
  const reason = refusedWith(advance(j, 'G5', 10, 'plan'))
  expect(reason.length).toBeGreaterThan(0)
  expect(j.gate).toBe('G4')
  const agreed = must(recordAgreement(j))
  expect(must(advance(agreed, 'G5', 11, 'plan')).gate).toBe('G5')
})

// ---------------------------------------------------------------- rule 6

test('rule 6: addChunk is refused outside G5 and G6', () => {
  refusedWith(addChunk(createJob('f', 'Full', 'full', 0), chunk('c1')))
  refusedWith(addChunk(createJob('s', 'Solo', 'solo', 0), chunk('c1')))
  refusedWith(addChunk(fullAtG4(), chunk('c1')))
  refusedWith(addChunk(fullAtG7(), chunk('c2')))
})

test('rule 6: addChunk is accepted at G5 and at G6', () => {
  const at5 = must(addChunk(fullAtG5(), chunk('c1')))
  expect(at5.chunks.map(c => c.id)).toEqual(['c1'])
  const at6 = must(addChunk(fullAtG6(), chunk('c1')))
  expect(at6.chunks.map(c => c.id)).toEqual(['c1'])
})

test('rule 6: addChunk is refused for a duplicate id', () => {
  const j = must(addChunk(fullAtG5(), chunk('c1')))
  refusedWith(addChunk(j, chunk('c1', { title: 'other' })))
  expect(j.chunks.length).toBe(1)
})

test('rule 6: addChunk is refused when owner, model or effort is empty', () => {
  const base = fullAtG5()
  refusedWith(addChunk(base, chunk('c1', { owner: '' })))
  refusedWith(addChunk(base, chunk('c1', { owner: '   ' })))
  refusedWith(addChunk(base, chunk('c1', { model: '' })))
  refusedWith(addChunk(base, chunk('c1', { model: '  ' })))
  refusedWith(addChunk(base, chunk('c1', { effort: '' })))
  refusedWith(addChunk(base, chunk('c1', { effort: '\t' })))
})

// ---------------------------------------------------------------- rule 7

test('rule 7: full mode refuses G7 with no chunks and allows it with one', () => {
  const j = fullAtG6()
  refusedWith(advance(j, 'G7', 10, 'execute'))
  expect(j.gate).toBe('G6')
  const withChunk = must(addChunk(j, chunk('c1')))
  expect(must(advance(withChunk, 'G7', 11, 'execute')).gate).toBe('G7')
})

// ---------------------------------------------------------------- rule 8

test('rule 8: setChunkStatus is refused unless the job is at G7', () => {
  const j = must(addChunk(fullAtG6(), chunk('c1')))
  refusedWith(setChunkStatus(j, 'c1', 'doing'))
  const g5 = must(addChunk(fullAtG5(), chunk('c1')))
  refusedWith(setChunkStatus(g5, 'c1', 'doing'))
})

test('rule 8: refused for an unknown chunk id', () => {
  refusedWith(setChunkStatus(fullAtG7(), 'nope', 'doing'))
})

test('rule 8: only todo->doing, doing->reported, reported->accepted/rejected, rejected->doing are allowed', () => {
  const allowed: Record<ChunkStatus, ChunkStatus[]> = {
    todo: ['doing'],
    doing: ['reported'],
    reported: ['accepted', 'rejected'],
    rejected: ['doing'],
    accepted: [],
  }
  const mismatches: string[] = []
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const r = setChunkStatus(chunkAt(from), 'c1', to, 'e')
      const expectOk = allowed[from].includes(to)
      if (r.ok !== expectOk) {
        mismatches.push(`${from}->${to}: expected ${expectOk ? 'ok' : 'refused'}, got ${r.ok ? 'ok' : 'refused'}`)
      }
    }
  }
  expect(mismatches).toEqual([])
})

test('rule 8: reported and accepted need evidence, rejected does not', () => {
  const doing = chunkAt('doing')
  refusedWith(setChunkStatus(doing, 'c1', 'reported'))
  refusedWith(setChunkStatus(doing, 'c1', 'reported', ''))
  refusedWith(setChunkStatus(doing, 'c1', 'reported', '   '))
  const reported = chunkAt('reported')
  refusedWith(setChunkStatus(reported, 'c1', 'accepted'))
  refusedWith(setChunkStatus(reported, 'c1', 'accepted', '  '))
  must(setChunkStatus(reported, 'c1', 'rejected'))
})

test('rule 8: evidence is appended', () => {
  let j = fullAtG7()
  j = must(setChunkStatus(j, 'c1', 'doing', 'started'))
  expect(j.chunks[0]!.evidence).toEqual(['started'])
  j = must(setChunkStatus(j, 'c1', 'reported', 'pr #1'))
  expect(j.chunks[0]!.evidence).toEqual(['started', 'pr #1'])
  j = must(setChunkStatus(j, 'c1', 'accepted', 'reviewed'))
  expect(j.chunks[0]!.evidence).toEqual(['started', 'pr #1', 'reviewed'])
})

// ---------------------------------------------------------------- rule 9

test('rule 9: G8 is refused with no check on record', () => {
  const j = fullReadyForG8()
  refusedWith(advance(j, 'G8', 40, 'deliver'))
  expect(j.gate).toBe('G7')
})

test('rule 9: G8 is refused when a latest check fails', () => {
  const j = must(recordCheck(fullReadyForG8(), check('unit', false, 40)))
  refusedWith(advance(j, 'G8', 41, 'deliver'))
})

test('rule 9: G8 is refused when any one of several latest checks fails', () => {
  let j = must(recordCheck(fullReadyForG8(), check('unit', true, 40)))
  j = must(recordCheck(j, check('lint', false, 41)))
  refusedWith(advance(j, 'G8', 42, 'deliver'))
})

test('rule 9: a failed check followed by a later passing check of the same name allows G8', () => {
  let j = must(recordCheck(fullReadyForG8(), check('unit', false, 40)))
  j = must(recordCheck(j, check('unit', true, 41)))
  expect(latestChecks(j).map(c => c.pass)).toEqual([true])
  expect(must(advance(j, 'G8', 42, 'deliver')).gate).toBe('G8')
})

test('rule 9: a passing check followed by a later failing check refuses G8', () => {
  let j = must(recordCheck(fullReadyForG8(), check('unit', true, 40)))
  j = must(recordCheck(j, check('unit', false, 41)))
  refusedWith(advance(j, 'G8', 42, 'deliver'))
})

test('rule 9: full mode refuses G8 unless every chunk is accepted', () => {
  let j = fullAtG7([chunk('c1'), chunk('c2')])
  j = must(setChunkStatus(j, 'c1', 'doing'))
  j = must(setChunkStatus(j, 'c1', 'reported', 'pr #1'))
  j = must(setChunkStatus(j, 'c1', 'accepted', 'ok'))
  j = must(recordCheck(j, check('unit', true, 50)))
  refusedWith(advance(j, 'G8', 51, 'deliver'))
  j = must(setChunkStatus(j, 'c2', 'doing'))
  j = must(setChunkStatus(j, 'c2', 'reported', 'pr #2'))
  refusedWith(advance(j, 'G8', 52, 'deliver'))
  j = must(setChunkStatus(j, 'c2', 'accepted', 'ok'))
  expect(must(advance(j, 'G8', 53, 'deliver')).gate).toBe('G8')
})

test('rule 9: solo mode reaches G8 with a passing check and no chunk acceptance', () => {
  let j = must(recordCheck(soloAtG7(), check('unit', true, 1)))
  expect(must(advance(j, 'G8', 2, 'deliver')).gate).toBe('G8')
})

// ---------------------------------------------------------------- rule 10

test('rule 10: reopen is refused when the target is not earlier than the current gate', () => {
  const j = fullAtG5()
  refusedWith(reopen(j, 'G5', 10, 'why'))
  refusedWith(reopen(j, 'G6', 10, 'why'))
  refusedWith(reopen(j, 'G8', 10, 'why'))
})

test('rule 10: reopen is refused with an empty note', () => {
  const j = fullAtG5()
  refusedWith(reopen(j, 'G3', 10, ''))
  refusedWith(reopen(j, 'G3', 10, '   '))
})

test('rule 10: reopen to G4 or earlier clears clientAgreed', () => {
  const j = fullAtG6()
  expect(j.clientAgreed).toBe(true)
  const toG4 = must(reopen(j, 'G4', 10, 'client changed scope'))
  expect(toG4.gate).toBe('G4')
  expect(toG4.clientAgreed).toBe(false)
  const toG2 = must(reopen(j, 'G2', 11, 'rethink'))
  expect(toG2.clientAgreed).toBe(false)
})

test('rule 10: reopen to G5 keeps clientAgreed', () => {
  const j = fullAtG6()
  const toG5 = must(reopen(j, 'G5', 10, 'replan phases'))
  expect(toG5.gate).toBe('G5')
  expect(toG5.clientAgreed).toBe(true)
})

// ---------------------------------------------------------------- rule 11

test('rule 11: escalateToFull turns a solo job into a full job at G2', () => {
  const fromG1 = must(escalateToFull(createJob('s', 'Solo', 'solo', 0), 5, 'needs client'))
  expect(fromG1.mode).toBe('full')
  expect(fromG1.gate).toBe('G2')
  const fromG7 = must(escalateToFull(soloAtG7(), 6, 'needs client'))
  expect(fromG7.mode).toBe('full')
  expect(fromG7.gate).toBe('G2')
})

test('rule 11: escalateToFull is refused on a full job', () => {
  refusedWith(escalateToFull(createJob('f', 'Full', 'full', 0), 1, 'again'))
  refusedWith(escalateToFull(fullAtG5(), 1, 'again'))
})

// ---------------------------------------------------------------- rule 12

test('rule 12: no function mutates its input', () => {
  const mutated: string[] = []
  const probe = (label: string, input: Job, run: (j: Job) => unknown) => {
    const before = clone(input)
    run(input)
    if (JSON.stringify(input) !== JSON.stringify(before)) mutated.push(label)
  }

  const g4 = fullAtG4()
  probe('recordAgreement (ok)', g4, j => recordAgreement(j))
  probe('recordAgreement (refused)', fullAtG5(), j => recordAgreement(j))

  const g5 = fullAtG5()
  probe('addChunk (ok)', g5, j => addChunk(j, chunk('c1', { evidence: ['x'] })))
  probe('addChunk (refused)', g5, j => addChunk(j, chunk('', { owner: '' })))

  const g7 = fullAtG7()
  probe('setChunkStatus (ok)', g7, j => setChunkStatus(j, 'c1', 'doing', 'start'))
  probe('setChunkStatus (refused)', g7, j => setChunkStatus(j, 'c1', 'accepted', ''))
  const reported = chunkAt('reported')
  probe('setChunkStatus accepted (ok)', reported, j => setChunkStatus(j, 'c1', 'accepted', 'ok'))

  probe('recordCheck', g7, j => recordCheck(j, check('unit', true, 1)))
  const withCheck = must(recordCheck(fullReadyForG8(), check('unit', true, 1)))
  probe('advance G8 (ok)', withCheck, j => advance(j, 'G8', 2, 'deliver'))
  probe('advance G8 (refused)', fullReadyForG8(), j => advance(j, 'G8', 2, 'deliver'))
  probe('advance G2 (ok)', createJob('f', 'Full', 'full', 0), j => advance(j, 'G2', 1, 'a'))
  probe('advance (refused)', createJob('f', 'Full', 'full', 0), j => advance(j, 'G5', 1, 'a'))
  probe('reopen (ok)', fullAtG6(), j => reopen(j, 'G4', 1, 'back'))
  probe('reopen (refused)', fullAtG6(), j => reopen(j, 'G6', 1, 'back'))
  probe('escalateToFull (ok)', createJob('s', 'Solo', 'solo', 0), j => escalateToFull(j, 1, 'up'))
  probe('escalateToFull (refused)', fullAtG5(), j => escalateToFull(j, 1, 'up'))
  probe('latestChecks', withCheck, j => latestChecks(j))

  // The chunk handed to addChunk must not be changed either.
  const input = chunk('c9', { evidence: ['keep'] })
  const snapshot = clone(input)
  addChunk(g5, input)
  expect(input).toEqual(snapshot)

  expect(mutated).toEqual([])
})

// ---------------------------------------------------------------- rule 13

test('rule 13: each successful advance, reopen and escalateToFull appends one history entry', () => {
  const start = createJob('j', 'Job', 'full', 0)
  const a = must(advance(start, 'G2', 7, 'assess'))
  expect(a.history).toEqual([{ at: 7, from: 'G1', to: 'G2', note: 'assess' }])

  const b = must(advance(a, 'G3', 8, 'simulate'))
  expect(b.history.length).toBe(2)
  expect(b.history[1]).toEqual({ at: 8, from: 'G2', to: 'G3', note: 'simulate' })

  const r = must(reopen(b, 'G2', 9, 'rework'))
  expect(r.history.length).toBe(3)
  expect(r.history[2]).toEqual({ at: 9, from: 'G3', to: 'G2', note: 'rework' })

  const e = must(escalateToFull(createJob('s', 'Solo', 'solo', 0), 10, 'up'))
  expect(e.history).toEqual([{ at: 10, from: 'G1', to: 'G2', note: 'up' }])
})

test('rule 13: refused calls append no history entry', () => {
  const j = createJob('j', 'Job', 'full', 0)
  expect(advance(j, 'G5', 1, 'skip').ok).toBe(false)
  expect(j.history).toEqual([])
  expect(reopen(j, 'G1', 1, 'nope').ok).toBe(false)
  expect(j.history).toEqual([])
  expect(escalateToFull(j, 1, 'nope').ok).toBe(false)
  expect(j.history).toEqual([])
})
