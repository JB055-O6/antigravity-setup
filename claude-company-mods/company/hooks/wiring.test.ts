import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'Do it.',
  description: 'Find where the config is loaded',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
} as const

// A hook here stands for the engine beneath the plugin: it records what reached it.
function engine(on: On) {
  const seen: Array<{ model?: string; subagentType: string }> = []
  on('agent.spawn', (_, e) => {
    seen.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${seen.length}` }
  })
  return seen
}

test('session.start registers the five crew agents', async ($, on) => {
  const specs: Array<Record<string, unknown>> = []
  on('agent.register', (_, e) => {
    specs.push(e as unknown as Record<string, unknown>)
    return { value: { agent: `company:${e.name}` } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const by = Object.fromEntries(specs.map(s => [s.name as string, s]))
  expect(Object.keys(by).sort()).toEqual(['architect', 'builder', 'reviewer', 'sage', 'scout'])
  expect(by.scout).toMatchObject({ model: 'haiku', effort: 'medium' })
  expect(by.builder).toMatchObject({ model: 'sonnet', effort: 'medium' })
  expect(by.reviewer).toMatchObject({ model: 'opus', effort: 'max' })
  expect(by.architect).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(by.sage).toMatchObject({ model: 'fable', effort: 'high' })
  expect(by.scout!.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'])
  expect(by.reviewer!.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash'])
  expect(by.builder!.tools).toBeUndefined()
  expect(String(by.scout!.prompt)).toContain('Never change files.')
  for (const s of specs) expect(String(s.prompt).split(/\s+/).length).toBeLessThan(120)
})

test('a failing registration does not stop the others or the session', async ($, on) => {
  const names: string[] = []
  on('agent.register', (_, e) => {
    if (e.name === 'scout') throw new Error('refused')
    names.push(e.name)
    return { value: { agent: `company:${e.name}` } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const r = await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(r.cwd).toBe('/')
  expect(names).toEqual(['builder', 'reviewer', 'architect', 'sage'])
})

test('routed spawns are sent on with the model, and tallied', async ($, on) => {
  mock.store(on)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN })
  await $.agent.spawn({ ...SPAWN, description: 'Fix the failing login test' })

  expect(seen[0]!.model).toBe('haiku')
  expect(seen[1]!.model).toBe('sonnet')
  expect(statuses).toEqual([
    'company: router on · 1 subagents routed',
    'company: router on · 2 subagents routed',
  ])
})

test('explicit model, fork and plugin agent pass through unchanged', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN, model: 'opus' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'fork' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'lab:runner', provider: { plugin: 'lab', tier: 'user' } } as never)

  expect(seen[0]!.model).toBe('opus')
  expect(seen[1]!.model).toBeUndefined()
  expect(seen[2]!.model).toBeUndefined()
})

test('a routed agent steps with its effort; the main loop is untouched', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  engine(on)
  const efforts: Array<{ agentId?: string; model: string; effort?: unknown }> = []
  on('turn.step', async function* (_, e) {
    efforts.push({ agentId: e.agentId, model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  // 'Find ...' is routed haiku/medium; its first agent id is a1.
  await $.agent.spawn({ ...SPAWN })

  const step = { turnId: 't', index: 0, model: 'opus', effort: 'high', messageCount: 1 } as const
  for await (const _ of $.turn.step({ ...step, agentId: 'a1' })) void _
  for await (const _ of $.turn.step({ ...step })) void _
  for await (const _ of $.turn.step({ ...step, agentId: 'other' })) void _

  expect(efforts[0]).toEqual({ agentId: 'a1', model: 'opus', effort: 'medium' })
  expect(efforts[1]).toEqual({ agentId: undefined, model: 'opus', effort: 'high' })
  expect(efforts[2]).toEqual({ agentId: 'other', model: 'opus', effort: 'high' })
})

test('if routing throws, the spawn goes ahead unchanged', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const seen = engine(on)
  // A null description makes the router throw.
  const r = await $.agent.spawn({ ...SPAWN, description: null } as never)
  expect(seen).toHaveLength(1)
  expect(seen[0]!.model).toBeUndefined()
  expect(r.deny).toBeUndefined()
})

test('the tally under `routes` counts per model, and a failing store never blocks', async ($, on) => {
  const sets: Array<{ key: string; value: Record<string, number> }> = []
  let held: unknown
  on('store.get', () => ({ value: held }))
  let failing = false
  on('store.set', (_, e) => {
    if (failing) throw new Error('disk full')
    held = e.value
    sets.push(e as never)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1234 }))
  engine(on)
  await $.agent.spawn({ ...SPAWN })
  await $.agent.spawn({ ...SPAWN, description: 'Find the loader again' })
  await $.agent.spawn({ ...SPAWN, description: 'Fix the bug' })
  const last = sets[sets.length - 1]!
  expect(last.key).toBe('routes')
  expect(last.value).toEqual({ haiku: 2, sonnet: 1, opus: 0, fable: 0, since: 1234 })

  failing = true
  const r = await $.agent.spawn({ ...SPAWN })
  expect(r.deny).toBeUndefined()
})
