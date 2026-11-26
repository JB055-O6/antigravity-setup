import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { CHARTER } from '../charter'
import { estimateTokens } from '../core'
import { readNote } from '../diet'

const BIG = 300 * 1024
const END = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const

// Hooks here stand for the engine beneath the plugin.
function quiet(on: On) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
}

// $.state for company over an object the test reads: session.end writes the ledger there.
function state(on: On) {
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    const was = held[e.key] ?? { value: undefined, version: 0 }
    held[e.key] = { value: e.value, version: was.version + 1 }
    return { value: { isSet: true, version: was.version + 1 } }
  })
  return () => (held.ledger?.value as { value: Record<string, { added: number; saved: number; acted: number }> }).value
}

function bigRead(on: On, text = 'ok') {
  on('fs.stat', () => ({ value: { kind: 'file', size: BIG, mtimeMs: 0, isLink: false } }))
  const limits: unknown[] = []
  on('tool.call', { tool: 'Read' }, (_, e) => {
    limits.push(e.limit)
    return { result: 'ok', text } as never
  })
  return limits
}

function greps(on: On) {
  const heads: unknown[] = []
  on('tool.call', { tool: 'Grep' }, (_, e) => {
    heads.push(e.head_limit)
    return { result: 'ok', text: 'ok' } as never
  })
  return heads
}

test('a subagent Read of a 300 KB file is capped at 600 lines', async ($, on) => {
  quiet(on)
  const limits = bigRead(on)
  const r = await $.tool.call({ tool: 'Read', file_path: '/a.log', agentId: 'a1' })
  expect(limits).toEqual([600])
  expect(r.context?.[0]).toBe(readNote(BIG))
})

test('a subagent Grep without head_limit gets 200', async ($, on) => {
  quiet(on)
  const heads = greps(on)
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content', agentId: 'a1' })
  expect(heads).toEqual([200])
})

test('an explicit head_limit 0 is kept', async ($, on) => {
  quiet(on)
  const heads = greps(on)
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content', head_limit: 0 })
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content', head_limit: 0, agentId: 'a1' })
  expect(heads).toEqual([0, 0])
})

test('a capped read adds saved tokens to the ledger', async ($, on) => {
  quiet(on)
  const ledger = state(on)
  bigRead(on, 'x'.repeat(1000))
  await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  await $.session.end({ ...END })
  expect(ledger().diet).toEqual({ added: estimateTokens(readNote(BIG).length), saved: estimateTokens(BIG - 1000), acted: 1 })
})

test('the charter adds its chars to the ledger once per compose', async ($, on) => {
  quiet(on)
  const ledger = state(on)
  on('prompt.compose', () => ({ sections: [] }))
  const compose = () =>
    $.prompt.compose({ model: 'test-model', promptModel: 'test-model', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  await compose()
  await compose()
  await $.session.end({ ...END })
  expect(ledger().charter).toEqual({ added: 2 * estimateTokens(CHARTER.length), saved: 0, acted: 0 })
})
