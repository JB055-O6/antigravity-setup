import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { DIET_BLOCK } from '../diet'

const ENGINE = { plugin: 'engine', tier: 'core' } as const
const SPAWN = {
  tool_use_id: 'tu1', prompt: 'Do it.', description: 'Find where the config is loaded', subagentType: 'general-purpose',
  provider: ENGINE, parentModel: 'opus', background: false, fork: false,
} as const
const PANE = {
  plugin: 'company', component: 'Pane', requestId: 'company',
  props: { title: 'Company', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const offer = (agent: string) => ({ agent, description: '', source: 'plugin', provider: { plugin: 'company', tier: 'user' } }) as const

// Hooks here stand for the engine beneath the plugin.
function quiet(on: On) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('agent.offer', () => ({ isOffered: true }))
  const registered: string[] = []
  on('agent.register', (_, e) => {
    registered.push(e.name)
    return { value: { agent: `company:${e.name}` } }
  })
  return registered
}
// $.state for company over an object the test reads: session.end writes health there.
function state(on: On) {
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    const was = held[e.key] ?? { value: undefined, version: 0 }
    held[e.key] = { value: e.value, version: was.version + 1 }
    return { value: { isSet: true, version: was.version + 1 } }
  })
  return () => (held.health?.value as { value: Record<string, { on: boolean; fails: number }> }).value
}
function engine(on: On) {
  const seen: Array<{ model?: string; prompt: string }> = []
  on('agent.spawn', (_, e) => {
    seen.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${seen.length}` }
  })
  return seen
}

test('a routeSpawn throw still adds the diet block', async ($, on) => {
  quiet(on)
  const health = state(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const seen = engine(on)
  // A null description makes the router throw.
  const r = await $.agent.spawn({ ...SPAWN, description: null } as never)
  expect(r.deny).toBeUndefined()
  expect(seen).toHaveLength(1)
  expect(seen[0]!.model).toBeUndefined()
  expect(seen[0]!.prompt).toContain(DIET_BLOCK)
  // The router's own fault is counted against it, and only it.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(health().router).toMatchObject({ on: true, fails: 1 })
  expect(health().diet).toMatchObject({ on: true, fails: 0 })
})

test('a background run closes on its completion and shows ended at session end', async ($, on) => {
  quiet(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `b${++n}` }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'launched' }) as never)
  on('agent.report', (_, e) => ({ text: e.text }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.agent.spawn({ ...SPAWN, background: true, description: 'Fix one' })
  await $.agent.spawn({ ...SPAWN, background: true, tool_use_id: 'tu2', description: 'Fix two' })
  // A background run's Agent call answers at once: the run goes on.
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1' } as never)
  const r = await $.agent.report({ agentId: 'b1', subagentType: 'general-purpose', provider: ENGINE, status: 'completed', text: 'ok' })
  expect(r.text).toBe('ok')
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /✓ done general-purpose on sonnet medium, 0 steps: Fix one/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /◆ background general-purpose on sonnet medium, 0 steps: Fix two/ })).toBeTruthy()
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /■ ended general-purpose on sonnet medium, 0 steps: Fix two/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /✓ done general-purpose on sonnet medium, 0 steps: Fix one/ })).toBeTruthy()
  await ui.unmount()
})

test('with a device attached off-machine, spawns are not rerouted', async ($, on) => {
  quiet(on)
  mock.env(on, { CLAUDE_CODE_REMOTE: 'true' })
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.agent.spawn({ ...SPAWN })
  expect((await $.agent.offer(offer('company:scout'))).isOffered).toBe(true)
  // The person's desktop app joins the cloud session: router and crew step aside.
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'tu2' })
  expect(seen.map((s) => s.model)).toEqual(['haiku', undefined])
  expect((await $.agent.offer(offer('company:scout'))).isOffered).toBe(false)
  expect((await $.agent.offer({ ...offer('Explore'), provider: ENGINE })).isOffered).toBe(true)
})

test('a device on the roster at start: no crew, no reroute', async ($, on) => {
  const registered = quiet(on)
  mock.env(on, { SSH_CONNECTION: '10.0.0.2 5000 10.0.0.1 22' })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }) as never)
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN })
  expect(registered).toEqual([])
  expect(seen[0]!.model).toBeUndefined()
})

test('on the person machine, an attached app changes nothing', async ($, on) => {
  const registered = quiet(on)
  mock.env(on, {})
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }) as never)
  const seen = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as never)
  await $.agent.spawn({ ...SPAWN })
  expect(registered).toHaveLength(5)
  expect(seen[0]!.model).toBe('haiku')
})
