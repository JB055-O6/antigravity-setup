import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TEXT = (n: number) => `Context is ${n} % full. Type /compact to make it smaller.`
const KEPT: SessionMessage[] = [{ role: 'user', text: 'summary', toolUses: [] }]
const COMPACT = { trigger: 'manual' as const, messages: KEPT }

// Hooks here stand for the engine beneath the plugin: the context fill is what `fill` holds.
// `{}` lets them sit beneath a module copy that a test registers first.
function engine(on: On) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  const fill: { window: number; percent?: number } = { window: 200000 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...fill }, rateLimits: [] } }) as never)
  on('turn.complete', {}, (_, e) => ({ text: e.answer }))
  on('session.compact', {}, () => ({ messages: KEPT }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { fill, toasts }
}
async function turn($: any, fill: { percent?: number }, percent: number | undefined, agentId?: string) {
  fill.percent = percent
  return $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })
}

test('nudge: toast at 61%, not again at 65%, again after 40% and then 62%', async ($, on) => {
  const { fill, toasts } = engine(on)
  expect(await turn($, fill, 61)).toMatchObject({ text: 'done' })
  expect(toasts).toEqual([TEXT(61)])
  await turn($, fill, 65)
  expect(toasts).toHaveLength(1)
  // 55% is under the toast line but not under the re-arm line.
  await turn($, fill, 55)
  await turn($, fill, 63)
  expect(toasts).toHaveLength(1)
  await turn($, fill, 40)
  await turn($, fill, 62)
  expect(toasts).toEqual([TEXT(61), TEXT(62)])
})

test('nudge: window 0, no fill yet, or no reading: no toast, no error', async ($, on) => {
  const { fill, toasts } = engine(on)
  fill.window = 0
  await turn($, fill, 90)
  fill.window = 200000
  await turn($, fill, undefined)
  expect(toasts).toEqual([])
})

test('nudge: a session.usage that throws leaves the turn as it was', async ($, on) => {
  mock.store(on)
  on('session.usage', () => {
    throw new Error('no reading')
  })
  on('turn.complete', {}, (_, e) => ({ text: e.answer }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  expect(await turn($, {}, 0)).toMatchObject({ text: 'done' })
  expect(toasts).toEqual([])
})

test('nudge: a subagent turn gives no toast and keeps the main loop armed', async ($, on) => {
  const { fill, toasts } = engine(on)
  await turn($, fill, 80, 'a1')
  expect(toasts).toEqual([])
  await turn($, fill, 70)
  expect(toasts).toEqual([TEXT(70)])
})

test('nudge: a main compaction re-arms, a subagent or precompute one does not; each toast counts', async ($, on) => {
  const { fill, toasts } = engine(on)
  // $.state for company over an object the test reads: the ledger lands there.
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    held[e.key] = { value: e.value, version: (held[e.key]?.version ?? 0) + 1 }
    return { value: { isSet: true, version: held[e.key]!.version } }
  })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await turn($, fill, 61)
  await $.session.compact({ ...COMPACT, trigger: 'precompute' })
  await $.session.compact({ ...COMPACT, agentId: 'a1' })
  await turn($, fill, 61)
  expect(toasts).toHaveLength(1)
  await $.session.compact({ ...COMPACT })
  await turn($, fill, 61)
  expect(toasts).toEqual([TEXT(61), TEXT(61)])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  const ledger = held.ledger!.value as { value: Record<string, unknown> }
  expect(ledger.value.nudge).toEqual({ added: 0, saved: 0, acted: 2 })
})
