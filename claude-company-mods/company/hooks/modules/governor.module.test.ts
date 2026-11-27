import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared, type Ctx } from '../core'
import { MODULE_META } from '.'
import { registerGovernor } from './governor'

// The engine beneath the plugin: records each step that reached it.
function stepSink(on: On) {
  const got: Array<{ agentId?: string; model: string; effort?: unknown }> = []
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

test('main loop Opus low stays low', async ($, on) => {
  mock.store(on)
  const got = stepSink(on)
  await step($, { model: 'opus', effort: 'low' })
  await step($, { model: 'claude-opus-4-7', effort: 'low' })
  expect(got.map((g) => g.effort)).toEqual(['low', 'low'])
})

test('subagent Opus low goes to medium', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const got = stepSink(on)
  await step($, { agentId: 'x1', model: 'opus', effort: 'low' })
  expect(got[0]).toEqual({ agentId: 'x1', model: 'opus', effort: 'medium' })
})

test('a bookkeeping throw after a Fable reroute keeps the reroute', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The plugin's own governor is off; this copy runs beneath it with a ledger that refuses writes.
  mock.env(on, { COMPANY_OFF: 'governor' })
  const ctx: Ctx = { id: 'governor', caps: {}, shared: createShared(MODULE_META.map((m) => m.id)) }
  ctx.shared.ledger.governor = Object.freeze({ added: 0, saved: 0, acted: 0 })
  registerGovernor(on, ctx)
  const got = stepSink(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await step($, { agentId: 'x1', model: 'fable', effort: 'high' })
  expect(got[0]).toEqual({ agentId: 'x1', model: 'opus', effort: 'max' })
  // The count threw before the note; the throw is not the module's failure.
  expect(ctx.shared.log).toEqual([])
  expect(ctx.shared.health.governor).toMatchObject({ on: true, fails: 0 })
})
