import type { EngineInterface, MatchedHook, On, StreamHook } from 'claude-code'
import { expect, mock, test, type Plugin } from 'claude-code/testing'
import { beneath, createShared, fail, isOn, ok, setOff, type Ctx } from './core'
import { MODULE_META } from './modules'
import { MODULE_CALLS, register } from './register'

// ---- the engine: a throw in a plugin's hooks never runs the tool or the step twice ----

// Two modules in one plugin above the engine, as company's modules are: `command` (Bash)
// or `turnId` (turn.step) says which hook throws and where. Inline plugins see nothing of
// this file, so this one is self-contained.
const MODS: Plugin = {
  name: 'mods',
  register(on) {
    on('tool.call', { tool: 'Bash' }, async (_, e, next) => {
      if (e.command === 'outer-before') throw new Error('outer before')
      const r = await next(e)
      if (e.command === 'outer-after') throw new Error('outer after')
      return r
    })
    on('tool.call', { tool: 'Bash' }, async (_, e, next) => {
      if (e.command === 'inner-before') throw new Error('inner before')
      const r = await next({ ...e, command: `${e.command} +inner` })
      if (e.command === 'inner-after') throw new Error('inner after')
      return r
    })
    on('turn.step', async function* (_, e, next) {
      for await (const c of next(e)) {
        yield c
        if (e.turnId === 'mid') throw new Error('mid stream')
      }
    })
  },
}

// The engine beneath the plugins: counts each Bash run and the command that reached it.
function bashEngine(on: On) {
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.push(e.command)
    return { result: { stdout: `run ${seen.length}`, stderr: '', interrupted: false } } as never
  })
  return seen
}

const STEP = { turnId: 't', index: 0, model: 'opus', effort: 'medium', messageCount: 1 } as const

test('a throw before next runs the tool once', { plugins: [MODS] }, async ($, on) => {
  const seen = bashEngine(on)
  expect((await $.tool.call({ tool: 'Bash', command: 'outer-before' })).result).toMatchObject({ stdout: 'run 1' })
  expect((await $.tool.call({ tool: 'Bash', command: 'inner-before' })).result).toMatchObject({ stdout: 'run 2' })
  // Once each, with the original input: every hook of the failed plugin is left out.
  expect(seen).toEqual(['outer-before', 'inner-before'])
})

test('a throw after next returns the first result and runs the tool once', { plugins: [MODS] }, async ($, on) => {
  const seen = bashEngine(on)
  expect((await $.tool.call({ tool: 'Bash', command: 'outer-after' })).result).toMatchObject({ stdout: 'run 1' })
  expect((await $.tool.call({ tool: 'Bash', command: 'inner-after' })).result).toMatchObject({ stdout: 'run 2' })
  expect(seen).toEqual(['outer-after +inner', 'inner-after +inner'])
})

test('a throw in the middle of a turn.step stream does not repeat the step', { plugins: [MODS] }, async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  let pulls = 0
  on('turn.step', async function* (_, e) {
    pulls += 1
    yield { kind: 'text', index: 0, text: 'a' }
    yield { kind: 'text', index: 0, text: 'b' }
    return { turnId: e.turnId, index: e.index, answer: 'ab', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  const text: string[] = []
  for await (const c of $.turn.step({ ...STEP, turnId: 'mid' })) if (c.kind === 'text') text.push(c.text)
  expect(pulls).toBe(1)
  expect(text).toEqual(['a', 'b'])
})

// ---- the guard form and the breaker ----

// Where the probe's helper throws: never, before its `next`, after it, after the first chunk,
// or the same Error object on every call (as a cached failed start would).
type How = { mode: 'pass' | 'before' | 'after' | 'mid' | 'cached' }
const CACHED = new Error('probe start failed')
type BashHook = MatchedHook<'tool.call', { readonly tool: 'Bash' }>
type StepHook = StreamHook<'turn.step'>

// A module in the exact guard form of the global constraints.
function registerProbe(on: On, ctx: Ctx, how: How): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isOn(ctx)) return next(e)
    try { const r = await probeCall($, e, beneath(next), how); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('turn.step', {}, async function* ($, e, next) {
    if (!isOn(ctx)) return yield* next(e)
    try { const r = yield* probeStep($, e, beneath(next), how); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

async function probeCall(_$: EngineInterface, e: Parameters<BashHook>[1], next: Parameters<BashHook>[2], how: How) {
  if (how.mode === 'before') throw new Error('probe broke before next')
  if (how.mode === 'cached') throw CACHED
  const r = await next({ ...e, command: `${e.command} # probe` })
  if (how.mode === 'after') throw new Error('probe broke after next')
  return r
}

async function* probeStep(_$: EngineInterface, e: Parameters<StepHook>[1], next: Parameters<StepHook>[2], how: How) {
  if (how.mode !== 'mid') return yield* next(e)
  for await (const c of next(e)) {
    yield c
    throw new Error('probe broke mid stream')
  }
}

// The probe and the engine stub share the test's registrar, which the engine treats as one
// plugin: when the probe throws, the engine leaves out the stub too and the bare bottom
// answers with an error. So a call the probe breaks rejects here; with company over core it runs once.
function probe(on: On, $: { tool: { call: (e: { tool: 'Bash'; command: string }) => Promise<unknown> } }, mode: How['mode']) {
  const ctx: Ctx = { id: 'bashcap', caps: {}, shared: createShared(MODULE_META.map((m) => m.id)) }
  const how: How = { mode }
  registerProbe(on, ctx, how)
  const seen = bashEngine(on)
  const bash = () => $.tool.call({ tool: 'Bash', command: 'ls' }).then(() => 'ran', (err) => String(err))
  return { ctx, how, seen, bash, health: () => ctx.shared.health.bashcap }
}

test('the guard counts a throw, passes it on, and never calls next twice', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const p = probe(on, $, 'before')
  let pulls = 0
  on('turn.step', async function* (_, e) {
    pulls += 1
    yield { kind: 'text', index: 0, text: 'a' }
    return { turnId: e.turnId, index: e.index, answer: 'a', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  expect(await p.bash()).toContain('no implementation for tool.call')
  expect(p.seen).toEqual([])
  p.how.mode = 'after'
  expect(await p.bash()).toContain('no implementation for tool.call')
  expect(p.seen).toEqual(['ls # probe'])
  expect(p.health()).toMatchObject({ on: true, fails: 2, streak: 2 })
  p.how.mode = 'mid'
  for await (const _ of $.turn.step({ ...STEP })) void _
  expect(pulls).toBe(1)
  expect(p.health().fails).toBe(3)
})

test('three failures turn the module off; two do not', async ($, on) => {
  const p = probe(on, $, 'before')
  await p.bash()
  await p.bash()
  expect(p.health().on).toBe(true)
  await p.bash()
  expect(p.health()).toMatchObject({ on: false, off: 'errors', fails: 3, streak: 3 })
  expect(p.health().lastErr).toContain('probe broke before next')
})

test('an off module passes through untouched', async ($, on) => {
  const p = probe(on, $, 'pass')
  expect(await p.bash()).toBe('ran')
  setOff(p.ctx, 'env')
  p.how.mode = 'before'
  expect(await p.bash()).toBe('ran')
  expect(p.seen).toEqual(['ls # probe', 'ls'])
  expect(p.health()).toMatchObject({ on: false, off: 'env', fails: 0 })
})

test('a success resets the streak', async ($, on) => {
  const p = probe(on, $, 'before')
  await p.bash()
  await p.bash()
  p.how.mode = 'pass'
  expect(await p.bash()).toBe('ran')
  p.how.mode = 'before'
  await p.bash()
  expect(p.health()).toMatchObject({ on: true, fails: 3, streak: 1 })
})

// An inner module's error also rejects the outer guard's `next`: only the inner one counts it.
test('an inner module failure counts once, against the inner module only', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const shared = createShared(MODULE_META.map((m) => m.id))
  const inner: How = { mode: 'before' }
  registerProbe(on, { id: 'bashcap', caps: {}, shared }, { mode: 'pass' })
  registerProbe(on, { id: 'rtk', caps: {}, shared }, inner)
  bashEngine(on)
  on('turn.step', async function* (_, e) {
    yield { kind: 'text', index: 0, text: 'a' }
    return { turnId: e.turnId, index: e.index, answer: 'a', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'ls' }).catch(() => undefined)
  inner.mode = 'after'
  await $.tool.call({ tool: 'Bash', command: 'ls' }).catch(() => undefined)
  inner.mode = 'mid'
  for await (const _ of $.turn.step({ ...STEP })) void _
  expect(shared.health.rtk).toMatchObject({ on: false, off: 'errors', fails: 3, streak: 3 })
  expect(shared.health.rtk.lastErr).toBe('Error: probe broke mid stream')
  expect(shared.health.bashcap).toEqual({ on: true, fails: 0, streak: 0 })
})

test('one Error object thrown on three calls turns the module off', async ($, on) => {
  const p = probe(on, $, 'cached')
  await p.bash()
  await p.bash()
  await p.bash()
  expect(p.health()).toMatchObject({ on: false, off: 'errors', fails: 3, lastErr: 'Error: probe start failed' })
})

// Core, an API error or an abort beneath the module: its guard passes the error on uncounted.
test('errors from beneath next never count against the module', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const ctx: Ctx = { id: 'rtk', caps: {}, shared: createShared(MODULE_META.map((m) => m.id)) }
  registerProbe(on, ctx, { mode: 'pass' })
  on('tool.call', { tool: 'Bash' }, () => {
    throw new Error('core broke')
  })
  on('turn.step', async function* () {
    yield { kind: 'text', index: 0, text: 'a' }
    throw new Error('stream broke')
  })
  // The stubs share the probe's registrar, so each broken call also rejects here.
  for (let i = 0; i < 3; i++) {
    expect(await $.tool.call({ tool: 'Bash', command: 'ls' }).then(() => 'ran', String)).toContain('Error')
    let stepErr = ''
    try {
      for await (const _ of $.turn.step({ ...STEP })) void _
    } catch (err) {
      stepErr = String(err)
    }
    expect(stepErr).toContain('Error')
  }
  expect(ctx.shared.health.rtk).toEqual({ on: true, fails: 0, streak: 0 })
})

test('beneath(next) reads every property of next unchanged', async ($, on) => {
  const same: Record<string, boolean> = {}
  on('tool.call', { tool: 'Bash' }, async (_, e, next) => {
    const b = beneath(next)
    for (const k of ['called', 'signal', 'origin', 'event', 'to', 'is']) same[k] = Reflect.get(b, k) === Reflect.get(next, k)
    return b(e)
  })
  const seen = bashEngine(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(same).toEqual({ called: true, signal: true, origin: true, event: true, to: true, is: true })
  expect(seen).toEqual(['ls'])
  expect(r.result).toMatchObject({ stdout: 'run 1' })
})

// ---- the host ----

// Modules share an event through `{}` on every hook after the first: both must fire.
test('a plain hook and a {} hook on one event both fire on every event', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const fired: string[] = []
  on('turn.step', async function* (_, e, next) {
    fired.push('step plain')
    return yield* next(e)
  })
  on('turn.step', {}, async function* (_, e) {
    fired.push('step {}')
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('tool.call', async (_, e, next) => {
    fired.push('call plain')
    return next(e)
  })
  on('tool.call', {}, () => {
    fired.push('call {}')
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  for (let i = 0; i < 2; i++) {
    for await (const _ of $.turn.step({ ...STEP })) void _
    await $.tool.call({ tool: 'Bash', command: 'ls' })
  }
  expect(fired).toEqual(['step plain', 'step {}', 'call plain', 'call {}', 'step plain', 'step {}', 'call plain', 'call {}'])
})

test('register.tsx calls the module register functions in MODULE_META order', () => {
  const ids = MODULE_META.map((m) => m.id)
  expect(ids).toEqual(['charter', 'meter', 'router', 'governor', 'diet', 'bashcap', 'rtk', 'graph', 'audit', 'nudge', 'setup', 'dashboard'])
  // This file's own copy of the module: registering fills MODULE_CALLS from the real calls.
  register((() => ({})) as never, {} as never)
  // The ported modules are called, in spec order among themselves; then every call keeps META order.
  expect(MODULE_CALLS.filter((id) => ['charter', 'meter', 'diet'].includes(id))).toEqual(['charter', 'meter', 'diet'])
  expect(MODULE_CALLS.filter((id) => ['router', 'governor'].includes(id))).toEqual(['router', 'governor'])
  expect(MODULE_CALLS).toEqual(ids.filter((id) => MODULE_CALLS.includes(id)))
})

test('session.end after /clear or resume passes through', async ($, on) => {
  const ended: string[] = []
  on('session.end', (_, e) => {
    ended.push(e.reason)
    return { sessionId: e.sessionId }
  })
  for (const reason of ['clear', 'resume', 'prompt_input_exit'] as const) {
    expect(await $.session.end({ reason, sessionId: 's1', resume: { id: 's1' } })).toEqual({ sessionId: 's1' })
  }
  expect(ended).toEqual(['clear', 'resume', 'prompt_input_exit'])
})

test('COMPANY_OFF=rtk turns rtk off with reason env', async ($, on) => {
  mock.store(on)
  mock.env(on, { COMPANY_OFF: 'rtk' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  const notices: string[] = []
  on('session.append', (_, e, next) => {
    notices.push(String((e.message.content as any)[0]?.text ?? ''))
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(notices).toContain('company · RTK · off: env COMPANY_OFF')
  expect(notices.some((n) => n.includes('GRAPH'))).toBe(false)
})
