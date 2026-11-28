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
  expect(by.sage).toMatchObject({ model: 'opus', effort: 'max' })
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
    // Each spawn also took the context diet's report block (the ` · n diet` suffix).
    'company · 1 subagents routed · 0 efforts governed · 1 diet',
    'company · 2 subagents routed · 0 efforts governed · 2 diet',
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

test('the tally under `lifetime.routes` counts per model, and a failing store never blocks', async ($, on) => {
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
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  engine(on)
  await $.agent.spawn({ ...SPAWN })
  await $.agent.spawn({ ...SPAWN, description: 'Find the loader again' })
  await $.agent.spawn({ ...SPAWN, description: 'Fix the bug' })
  // Writes are at most one per 2 s; session.end writes the rest.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  const last = sets[sets.length - 1]!
  expect(last.key).toBe('lifetime')
  expect((last.value as unknown as { routes: unknown }).routes).toEqual({ haiku: 2, sonnet: 1, opus: 0, fable: 0, since: 1234 })

  failing = true
  const r = await $.agent.spawn({ ...SPAWN })
  expect(r.deny).toBeUndefined()
})

// ---- effort governor and limit meter ----

type Chunk = { agentId?: string; model: string; effort?: unknown }
function stepSink(on: On) {
  const got: Chunk[] = []
  on('turn.step', async function* (_, e) {
    got.push({ agentId: e.agentId, model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  return got
}
async function step($: any, over: Record<string, unknown>) {
  const base = { turnId: 't', index: 0, model: 'opus', effort: 'high', messageCount: 1 }
  for await (const _ of $.turn.step({ ...base, ...over })) void _
}
function usageAt(on: On, five: number | null, week = 10) {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits:
        five === null
          ? []
          : [
              { kind: 'five_hour', percentUsed: five },
              { kind: 'seven_day', percentUsed: week },
            ],
    },
  }) as never)
}
function quiet(on: On) {
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.register', (_, e) => ({ value: { agent: `company:${e.name}` } }))
}
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('governor: main loop sonnet max -> high, opus low kept (never raised), opus medium untouched', async ($, on) => {
  mock.store(on)
  const got = stepSink(on)
  await step($, { model: 'sonnet', effort: 'max' })
  await step($, { model: 'claude-sonnet-5-5', effort: 'xhigh' })
  await step($, { model: 'opus', effort: 'low' })
  await step($, { model: 'opus', effort: 'medium' })
  await step($, { model: 'fable', effort: 'xhigh' })
  await step($, { model: 'haiku', effort: 'max' })
  await step($, { model: 'sonnet', effort: undefined })
  expect(got.map(g => [g.model, g.effort])).toEqual([
    ['sonnet', 'high'],
    ['claude-sonnet-5-5', 'high'],
    ['opus', 'low'],
    ['opus', 'medium'],
    ['fable', 'high'],
    ['haiku', 'max'],
    ['sonnet', undefined],
  ])
})

test('governor: a routed subagent gets its routed effort, then the governor', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  engine(on)
  const got = stepSink(on)
  // 'Design ...' routes opus/xhigh (a1); 'Find ...' routes haiku/medium (a2).
  await $.agent.spawn({ ...SPAWN, description: 'Design the cache layer' })
  await $.agent.spawn({ ...SPAWN })
  // The step is on sonnet: routed xhigh is then governed to high.
  await step($, { agentId: 'a1', model: 'sonnet', effort: 'low' })
  // Routed medium on opus is untouched by the governor.
  await step($, { agentId: 'a2', model: 'opus', effort: 'low' })
  expect(got[0]).toMatchObject({ agentId: 'a1', model: 'sonnet', effort: 'high' })
  expect(got[1]).toMatchObject({ agentId: 'a2', model: 'opus', effort: 'medium' })
})

test('economy: seeded at 91% five-hour, a fable subagent step goes out as opus xhigh; main loop model untouched', async ($, on) => {
  quiet(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  usageAt(on, 91)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const got = stepSink(on)
  await $.session.start({ ...START })
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('91%')
  expect(statuses[statuses.length - 1]).toBe(
    'ECONOMY · company · 5h 91% · week 10% · 0 subagents routed · 0 efforts governed',
  )

  await step($, { agentId: 'sage1', model: 'fable', effort: 'high' })
  await step($, { agentId: 'r1', model: 'claude-fable-1', effort: 'max' })
  await step($, { model: 'fable', effort: 'high' })
  await step($, { model: 'opus', effort: 'max' })
  await step($, { agentId: 'b1', model: 'sonnet', effort: 'high' })
  expect(got[0]).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(got[1]).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(got[2]).toMatchObject({ model: 'fable', effort: 'high' })
  // economy governor on the main loop: opus max -> xhigh, model kept
  expect(got[3]).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(got[4]).toMatchObject({ model: 'sonnet', effort: 'high' })
})

test('meter: session.measure turns economy on and off with hysteresis; one toast each; stored', async ($, on) => {
  const held: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  const clock = mock.clock(on, { now: 5000 })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // The hook does not wait for its store write; settle lets it land.
  const measure = async (five: number, week: number) => {
    await $.session.measure({
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: five },
        { kind: 'seven_day', percentUsed: week },
      ],
      changed: ['rateLimits'],
    } as never)
    await clock.settle()
  }
  await measure(50, 50)
  expect(toasts).toHaveLength(0)
  await measure(74, 50)
  expect(toasts).toHaveLength(0)
  await measure(75, 50)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('five-hour')
  expect(held.meter).toEqual({ economy: true, economySince: 5000, lastFiveHour: 75, lastWeek: 50 })
  await measure(72, 50)
  await measure(70, 50)
  expect(toasts).toHaveLength(1)
  await measure(69, 50)
  expect(toasts).toHaveLength(2)
  expect(toasts[1]).toContain('off')
  expect(held.meter).toEqual({ economy: false, lastFiveHour: 69, lastWeek: 50 })
  await measure(10, 75)
  expect(toasts).toHaveLength(3)
  expect(toasts[2]).toContain('weekly')
  expect(statuses[statuses.length - 1]!.startsWith('ECONOMY · company · 5h 10% · week 75%')).toBe(true)
})

test('status: normal mode with windows, and without (API key)', async ($, on) => {
  quiet(on)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  usageAt(on, 23.4, 7)
  await $.session.start({ ...START })
  expect(statuses[statuses.length - 1]).toBe(
    'company · 5h 23% · week 7% · 0 subagents routed · 0 efforts governed',
  )
  // An empty reading later keeps the last known windows (see the meter test below).
  await $.session.measure({ context: { window: 1 }, rateLimits: [], changed: ['rateLimits'] } as never)
  expect(statuses[statuses.length - 1]).toBe('company · 5h 23% · week 7% · 0 subagents routed · 0 efforts governed')
})

test('status: API key session (never any window) shows no limits', async ($, on) => {
  quiet(on)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  usageAt(on, null)
  await $.session.start({ ...START })
  expect(statuses[statuses.length - 1]).toBe('company · 0 subagents routed · 0 efforts governed')
})

test('a throwing usage read changes nothing and blocks nothing', async ($, on) => {
  quiet(on)
  on('session.usage', () => {
    throw new Error('no usage')
  })
  on('ui.status', () => ({ value: undefined }))
  const got = stepSink(on)
  const r = await $.session.start({ ...START })
  expect(r.cwd).toBe('/')
  // Economy unknown: the no-credits reroute still applies (Opus max, not lowered).
  await step($, { agentId: 'x', model: 'fable', effort: 'high' })
  expect(got[0]).toMatchObject({ model: 'opus', effort: 'max' })
})

test('no credits: outside economy a fable subagent step goes out as opus max; main-loop fable kept, toast once', async ($, on) => {
  quiet(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  usageAt(on, 10)
  const got = stepSink(on)
  await $.session.start({ ...START })
  await step($, { agentId: 's1', model: 'claude-fable-5-2', effort: 'high' })
  await step($, { model: 'fable', effort: 'high' })
  await step($, { model: 'fable', effort: 'high' })
  expect(got[0]).toMatchObject({ model: 'opus', effort: 'max' })
  expect(got[1]).toMatchObject({ model: 'fable', effort: 'high' })
  expect(toasts.filter(t => t.includes('usage credits'))).toHaveLength(1)
})

test('/company: registered at start; running it boots again and reports what is on', async ($, on) => {
  quiet(on)
  const cmds: string[] = []
  on('command.register', (_, e) => {
    cmds.push(e.name)
    return { value: { command: e.name } }
  })
  on('settings.read', () => ({ value: { 'ponytail@p': true, 'i-have-adhd@a': true, 'headroom@s': true, 'caveman@s': true } }))
  usageAt(on, 40, 20)
  await $.session.start({ ...START })
  expect(cmds).toContain('company')
  const r = await $.command.run({ command: 'company', args: '' } as never)
  expect(r.text).toContain('✓ CHARTER')
  expect(r.text).toContain('5/5 ready')
  expect(r.text).toContain('5h 40% · week 20% · economy off')
})
