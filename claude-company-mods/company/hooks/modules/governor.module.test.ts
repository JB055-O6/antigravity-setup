import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { EMPTY_PANEL } from '../panel'

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
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  // A stored pane whose log is no list: the first note and status after it throw.
  on('state.get', (_, e, next) =>
    e.plugin === 'company' && e.key === 'panel'
      ? { value: { value: { shape: 'panel-2', value: { ...EMPTY_PANEL, log: { length: 1 } } }, version: 1 } }
      : next(e),
  )
  const got = stepSink(on)
  await step($, { agentId: 'x1', model: 'fable', effort: 'high' })
  expect(got[0]).toEqual({ agentId: 'x1', model: 'opus', effort: 'max' })
  // The status path threw before it posted a line.
  expect(statuses).toEqual([])
})
