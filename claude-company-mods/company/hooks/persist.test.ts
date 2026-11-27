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
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const END = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const

// Hooks here stand for the engine beneath the plugin.
function engine(on: On) {
  const models: Array<string | undefined> = []
  const statuses: Array<string | undefined> = []
  on('agent.spawn', (_, e) => (models.push(e.model), { model: e.model ?? 'inherit', agentId: `a${models.length}` }))
  on('agent.register', (_, e) => ({ value: { agent: `company:${e.name}` } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  return { models, statuses }
}

// $.store over an object the test reads.
function store(on: On, held: Record<string, unknown> = {}) {
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  return held
}

// $.state for company over an object the test reads, with versions as the host keeps them.
function state(on: On, held: Record<string, { value: unknown; version: number }>) {
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    const was = held[e.key] ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== was.version) return { value: { isSet: false, version: was.version } }
    held[e.key] = { value: e.value, version: was.version + 1 }
    return { value: { isSet: true, version: was.version + 1 } }
  })
  return held
}

function usageAt(on: On, five: number, week: number) {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: five },
        { kind: 'seven_day', percentUsed: week },
      ],
    },
  }) as never)
}

function stepSink(on: On) {
  const got: Array<{ model: string; effort?: unknown }> = []
  on('turn.step', async function* (_, e) {
    got.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  return got
}

test('ledger survives a reload', async ($, on) => {
  engine(on)
  store(on)
  mock.env(on, { COMPANY_OFF: 'graph' })
  // The harness cannot load the plugin twice, so `held` stands for the host's $.state as the
  // last load left it: $.state outlives a hot reload, and register runs again over it.
  const held = state(on, {
    ledger: { value: { shape: 'ledger-1', value: { diet: { added: 120, saved: 3400, acted: 7 } } }, version: 4 },
    health: { value: { shape: 'health-1', value: { rtk: { on: false, fails: 3, streak: 3, lastErr: 'Error: boom', off: 'errors' } } }, version: 4 },
  })
  await $.session.start({ ...START })
  await $.session.end({ ...END })

  // Read back what this load wrote: the earlier figures, not a blank copy over them.
  const ledger = (held.ledger!.value as { shape: string; value: Record<string, unknown> })
  const health = (held.health!.value as { shape: string; value: Record<string, unknown> })
  expect(ledger.shape).toBe('ledger-1')
  expect(ledger.value.diet).toEqual({ added: 120, saved: 3400, acted: 7 })
  expect(ledger.value.router).toEqual({ added: 0, saved: 0, acted: 0 })
  expect(health.value.rtk).toEqual({ on: false, fails: 3, streak: 3, lastErr: 'Error: boom', off: 'errors' })
  expect(health.value.graph).toMatchObject({ on: false, off: 'env' })
  expect(health.value.charter).toEqual({ on: true, fails: 0, streak: 0 })
})

test('economy stays on after reload at 87%', async ($, on) => {
  engine(on)
  // This session's earlier load stored economy on; 87% alone would not start it (it starts at 90%).
  store(on, { meter: { sessionId: 's1', economy: true, economySince: 1000, lastFiveHour: 88, lastWeek: 40 } })
  on('session.id', () => ({ value: 's1' }))
  usageAt(on, 87, 40)
  const got = stepSink(on)
  await $.session.start({ ...START })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'max', messageCount: 1, agentId: 'x1' })) void _
  expect(got[0]).toEqual({ model: 'opus', effort: 'xhigh' })
})

test('economy stored by another session is not restored', async ($, on) => {
  engine(on)
  // Every copy of company shares one store file: a record of session s0 says nothing about s1.
  store(on, { meter: { sessionId: 's0', economy: true, economySince: 1000, lastFiveHour: 88, lastWeek: 40 } })
  on('session.id', () => ({ value: 's1' }))
  usageAt(on, 87, 40)
  const got = stepSink(on)
  await $.session.start({ ...START })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'max', messageCount: 1, agentId: 'x1' })) void _
  expect(got[0]).toEqual({ model: 'opus', effort: 'max' })
})

test('two parallel spawns count 2 routes', async ($, on) => {
  engine(on)
  const held = store(on)
  on('clock.now', () => ({ value: 1000 }))
  await Promise.all([$.agent.spawn({ ...SPAWN, tool_use_id: 'tu1' }), $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })])
  await $.session.end({ ...END })
  expect((held.lifetime as { routes: Record<string, number> }).routes).toEqual({ haiku: 2, sonnet: 0, opus: 0, fable: 0, since: 1000 })
  // The old key is not written again.
  expect(held.routes).toBeUndefined()
})

test('another session that shares the store keeps its counts; the old routes tally moves into lifetime', async ($, on) => {
  const { statuses } = engine(on)
  const held = store(on, { routes: { haiku: 5, sonnet: 1, opus: 0, fable: 0, since: 10 } })
  const clock = mock.clock(on, { now: 1000 })
  await $.agent.spawn({ ...SPAWN })
  // The spawn does not wait for its write; let it land.
  await clock.settle()
  expect((held.lifetime as { routes: unknown }).routes).toEqual({ haiku: 6, sonnet: 1, opus: 0, fable: 0, since: 10 })
  expect(statuses[statuses.length - 1]).toContain('7 subagents routed')
  // A parallel session adds its own counts to the shared file meanwhile.
  held.lifetime = { routes: { haiku: 9, sonnet: 1, opus: 0, fable: 0, since: 10 } }
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2', description: 'Fix the failing login test' })
  await $.session.end({ ...END })
  expect((held.lifetime as { routes: unknown }).routes).toEqual({ haiku: 9, sonnet: 2, opus: 0, fable: 0, since: 10 })
  expect(held.routes).toEqual({ haiku: 5, sonnet: 1, opus: 0, fable: 0, since: 10 })
})

test('a failing store never blocks a spawn', async ($, on) => {
  const { models, statuses } = engine(on)
  on('store.get', () => {
    throw new Error('disk gone')
  })
  on('store.set', () => {
    throw new Error('disk full')
  })
  const r = await $.agent.spawn({ ...SPAWN })
  expect(r.deny).toBeUndefined()
  expect(r.agentId).toBe('a1')
  expect(models).toEqual(['haiku'])
  // Counted in memory all the same.
  expect(statuses[statuses.length - 1]).toContain('1 subagents routed')
  expect(await $.session.end({ ...END })).toEqual({ sessionId: 's1' })
})

test('a stored log line of the wrong shape is dropped on restore', async ($, on) => {
  engine(on)
  store(on)
  stepSink(on)
  const held = state(on, {
    panel: {
      value: {
        shape: 'panel-2',
        value: {
          version: '0.11.0', crew: 5, crewTotal: 5, roster: [], directives: [], economy: false, routed: 0, governed: 0, diet: 0,
          log: [{ n: 3, kind: 'start', text: 'company 0.11.0 on' }, 'junk', { n: 'x', kind: 'route', text: 'bad' }, null, { n: 9, kind: 'diet' }],
          runs: [],
        },
      },
      version: 2,
    },
  })
  // A hot reload: the first event is a step the governor fixes, which writes the pane.
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'sonnet', effort: 'max', messageCount: 1 })) void _
  const pane = (held.panel!.value as { value: { log: Array<{ n: number; kind: string }> } }).value
  expect(pane.log.map((l) => [l.n, l.kind])).toEqual([[3, 'start'], [4, 'governor']])
})

test('a step that comes first after a reload is governed from stored economy and keeps the pane', async ($, on) => {
  const { statuses } = engine(on)
  store(on, { meter: { sessionId: 's1', economy: true, economySince: 1000, lastFiveHour: 88, lastWeek: 40 } })
  on('session.id', () => ({ value: 's1' }))
  const dirs = ['ponytail', 'i-have-adhd', 'headroom', 'caveman'].map((name) => ({ name, on: true }))
  // A hot reload fires no session.start: the step is the first event of the new load.
  const held = state(on, {
    panel: {
      value: {
        shape: 'panel-2',
        value: {
          version: '0.11.0', crew: 5, crewTotal: 5, roster: [], directives: dirs, economy: true, routed: 0, governed: 0, diet: 0,
          log: [{ n: 3, kind: 'start', text: 'company 0.11.0 on' }], runs: [],
        },
      },
      version: 2,
    },
  })
  const got = stepSink(on)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'max', messageCount: 1, agentId: 'x1' })) void _
  expect(got[0]).toEqual({ model: 'opus', effort: 'xhigh' })
  const pane = (held.panel!.value as { value: Record<string, unknown> }).value
  expect(pane).toMatchObject({ version: '0.11.0', crew: 5, directives: dirs, economy: true, fiveHour: 88, week: 40 })
  expect((pane.log as Array<{ n: number; text: string }>).map((l) => l.n)).toEqual([3, 4])
  expect(statuses[statuses.length - 1]!.startsWith('ECONOMY · company · 5h 88% · week 40%')).toBe(true)
  expect(statuses[statuses.length - 1]).toContain('directives 4/4')
})

test('a hanging store read does not stall a spawn', async ($, on) => {
  const { models } = engine(on)
  const clock = mock.clock(on, { now: 1000 })
  on('store.get', () => new Promise(() => {}))
  on('store.set', () => ({ value: undefined }))
  let done = false
  const spawned = $.agent.spawn({ ...SPAWN }).then((r) => ((done = true), r))
  await clock.advance(1000)
  expect(done).toBe(false)
  await clock.advance(500)
  const r = await spawned
  expect(r.agentId).toBe('a1')
  expect(models).toEqual(['haiku'])
  // The wait is once per load: the next spawn does not wait again.
  done = false
  const again = $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' }).then((r) => ((done = true), r))
  await clock.settle()
  expect(done).toBe(true)
  await again
})

test('a count the 2 s gap held back is written when the gap ends', async ($, on) => {
  engine(on)
  const held = store(on)
  const clock = mock.clock(on, { now: 1000 })
  await $.agent.spawn({ ...SPAWN })
  await clock.settle()
  expect((held.lifetime as { routes: { haiku: number } }).routes.haiku).toBe(1)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })
  await clock.settle()
  expect((held.lifetime as { routes: { haiku: number } }).routes.haiku).toBe(1)
  await clock.advance(2000)
  expect((held.lifetime as { routes: { haiku: number } }).routes.haiku).toBe(2)
})

const COMPOSE = { model: 'opus', promptModel: 'opus', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

test('after /clear the meter is stored under the new session id', async ($, on) => {
  engine(on)
  const held = store(on)
  const clock = mock.clock(on, { now: 1000 })
  on('prompt.compose', () => ({ sections: [] }))
  let id = 's1'
  on('session.id', () => ({ value: id }))
  await $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91 }], changed: ['rateLimits'] } as never)
  await clock.settle()
  expect(held.meter).toMatchObject({ sessionId: 's1', economy: true })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  id = 's2'
  // The new conversation's first hook writes it; no timer has to outlive session.end.
  await $.prompt.compose({ ...COMPOSE })
  await clock.settle()
  expect(held.meter).toMatchObject({ sessionId: 's2', economy: true })
})

test('a restore that comes late keeps the health this load set meanwhile', async ($, on) => {
  engine(on)
  store(on)
  mock.env(on, { COMPANY_OFF: 'graph' })
  const clock = mock.clock(on, { now: 1000 })
  // The first atom read hangs past the wait (this hook sits above the state below it);
  // session.start goes on and sets graph off.
  let release = () => {}
  const late = new Promise<void>((r) => (release = r))
  on('state.get', { key: 'ledger' }, async (_, e, next) => (await late, next(e)))
  const held = state(on, {
    health: {
      value: {
        shape: 'health-1',
        value: { setup: { on: false, fails: 3, streak: 3, lastErr: 'Error: boom', off: 'errors' }, graph: { on: true, fails: 1, streak: 1 } },
      },
      version: 4,
    },
  })
  let done = false
  const started = $.session.start({ ...START }).then(() => (done = true))
  await clock.advance(1000)
  expect(done).toBe(false)
  await clock.advance(500)
  await started
  release()
  await clock.settle()
  await $.session.end({ ...END })
  const health = (held.health!.value as { value: Record<string, unknown> }).value
  expect(health.graph).toEqual({ on: false, fails: 1, streak: 1, off: 'env' })
  expect(health.setup).toEqual({ on: false, fails: 3, streak: 3, lastErr: 'Error: boom', off: 'errors' })
})

test('session.end writes at once, within its bound, when the store hangs', async ($, on) => {
  engine(on)
  const clock = mock.clock(on, { now: 1000 })
  let gets = 0
  on('store.get', () => (gets++, new Promise(() => {})))
  on('store.set', () => ({ value: undefined }))
  // session.end is the first hook of this load: it starts no restore and waits for none.
  const ended = $.session.end({ ...END })
  await clock.advance(1000)
  expect(await ended).toEqual({ sessionId: 's1' })
  expect(gets).toBe(0)
})

test('a pane that draws after a reload stops the chat notices', async ($, on) => {
  engine(on)
  store(on)
  const notices: string[] = []
  on('session.append', (_, e, next) => (notices.push(String((e.message.content as any)[0]?.text ?? '')), next(e)))
  const pane = await $.ui.mount({
    plugin: 'company', component: 'Pane', requestId: 'company', surface: 'desktop',
    props: { title: 'Company', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as never)
  await $.agent.spawn({ ...SPAWN })
  expect(notices).toEqual([])
  await pane.unmount()
})

test('a hanging store write never holds up session.measure', async ($, on) => {
  engine(on)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => new Promise(() => {}))
  const measure = (five: number) =>
    $.session.measure({ context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: five }], changed: ['rateLimits'] } as never)
  // The first write hangs; the next measure's write queues behind it, and neither hook waits.
  expect(await measure(50)).toEqual({ changed: ['rateLimits'] })
  expect(await measure(60)).toEqual({ changed: ['rateLimits'] })
})
