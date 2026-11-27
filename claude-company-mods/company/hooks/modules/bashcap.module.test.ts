import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared, estimateTokens, type Ctx } from '../core'
import { MODULE_META } from '.'
import { registerBashcap } from './bashcap'

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const END = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const
const OUT = /^\/sp\/company-out\/[\w-]+\.txt$/

function lines(chars: number, from = 0): string {
  let s = ''
  for (let i = from; s.length < chars; i++) s += `line ${String(i).padStart(6, '0')} ok\n`
  return s.slice(0, chars)
}

// Hooks here stand for the engine beneath the plugin.
function quiet(on: On) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
}

// Bash answers `stdout` (with `rec` beside it); the scratchpad is /sp unless `sp` says otherwise.
function engine(on: On, stdout: string, o: { sp?: string | null; writeFails?: boolean; rec?: object } = {}) {
  const writes: Array<{ path: string; text: string }> = []
  const sp = o.sp === undefined ? '/sp' : o.sp
  on('session.info', () => ({ value: { transcriptPath: '', ...(sp === null ? {} : { scratchpadDir: sp }) } }))
  on('fs.write', (_, e) => {
    if (o.writeFails) throw new Error('EACCES: permission denied')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout, stderr: '', interrupted: false, ...o.rec } }) as never)
  return writes
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

async function bash($: any, agentId?: string): Promise<{ stdout: string } & Record<string, unknown>> {
  const r = await $.tool.call({ tool: 'Bash', command: 'make test', ...(agentId ? { agentId } : {}) })
  expect(r.deny).toBeUndefined()
  return r.result
}

test('a 20 KB output is cut, and the whole of it is saved under the scratchpad', async ($, on) => {
  quiet(on)
  const ledger = state(on)
  const stdout = lines(9000) + 'Traceback (most recent call last):\n' + lines(11_000, 7000)
  const writes = engine(on, stdout)
  const got = await bash($)
  expect(writes).toHaveLength(1)
  expect(writes[0]!.path).toMatch(OUT)
  expect(writes[0]!.text).toBe(stdout)
  expect(got.stdout).toContain(`\n[company: 10 KB cut. Full output: ${writes[0]!.path}]\nTraceback (most recent call last):\n`)
  expect(got.stdout.startsWith(stdout.slice(0, 5000))).toBe(true)
  expect(got.stdout.endsWith(stdout.slice(-5000))).toBe(true)
  expect(got.interrupted).toBe(false)
  await $.session.end({ ...END })
  expect(ledger().bashcap).toEqual({ added: 0, saved: estimateTokens(stdout.length - got.stdout.length), acted: 1 })
})

test('a subagent output is cut too', async ($, on) => {
  quiet(on)
  engine(on, lines(20_000))
  expect((await bash($, 'a1')).stdout).toContain('\n[company: 10 KB cut. Full output: /sp/company-out/')
})

test('a failed write: the marker says not saved and holds no path', async ($, on) => {
  quiet(on)
  engine(on, lines(20_000), { writeFails: true })
  const got = await bash($)
  expect(got.stdout).toContain('\n[company: 10 KB cut. Full output: not saved]\n')
  expect(got.stdout).not.toContain('/sp')
})

test('no scratchpad: nothing is written, and the output is still cut', async ($, on) => {
  quiet(on)
  const writes = engine(on, lines(20_000), { sp: null })
  expect((await bash($)).stdout).toContain('Full output: not saved]')
  expect(writes).toEqual([])
})

test('a relative scratchpad would land in the project: it counts as none', async ($, on) => {
  quiet(on)
  const writes = engine(on, lines(20_000), { sp: 'scratch' })
  expect((await bash($)).stdout).toContain('Full output: not saved]')
  expect(writes).toEqual([])
})

test('an output under the threshold passes unchanged, and nothing is written', async ($, on) => {
  quiet(on)
  const stdout = lines(12_000)
  const writes = engine(on, stdout)
  expect((await bash($)).stdout).toBe(stdout)
  expect(writes).toEqual([])
})

test('an output the engine saved itself passes unchanged', async ($, on) => {
  quiet(on)
  const writes = engine(on, lines(30_000), { rec: { persistedOutputPath: '/p/tool-results/x.txt', persistedOutputSize: 100_001 } })
  expect((await bash($)).stdout).toBe(lines(30_000))
  expect(writes).toEqual([])
})

test('an errored result passes unchanged', async ($, on) => {
  quiet(on)
  // The engine refuses a string where Bash's record goes, so an errored result is never changed.
  const err = `Error: Exit code 1\n${lines(20_000)}`
  on('fs.write', () => {
    throw new Error('no write expected')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: err, text: err }) as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'make test' })
  expect(r).toMatchObject({ isError: true, result: err })
})

test('economy halves the threshold', async ($, on) => {
  quiet(on)
  // The plugin's own bashcap is off; this copy runs beneath it with economy on.
  mock.env(on, { COMPANY_OFF: 'bashcap' })
  const ctx: Ctx = { id: 'bashcap', caps: {}, shared: createShared(MODULE_META.map((m) => m.id)) }
  ctx.shared.economy = true
  registerBashcap(on, ctx)
  engine(on, lines(7000))
  await $.session.start({ ...START })
  // The test's own copy may not call $.fs (the host scans the test file), so it saves nothing.
  expect((await bash($)).stdout).toContain('\n[company: 2 KB cut. Full output: ')
  expect(ctx.shared.ledger.bashcap.acted).toBe(1)
})

test('session end deletes the saved outputs', async ($, on) => {
  quiet(on)
  engine(on, lines(20_000))
  const runs: Array<readonly string[]> = []
  let there = true
  on('fs.exists', (_, e) => ({ value: e.path === '/sp/company-out' && there }))
  on('process.run', (_, e) => {
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await bash($)
  expect(await $.session.end({ ...END })).toEqual({ sessionId: 's1' })
  expect(runs).toEqual([['rm', '-rf', '--', '/sp/company-out']])
  there = false
  await $.session.end({ ...END })
  expect(runs).toHaveLength(1)
})

test('a failed delete never disturbs session end', async ($, on) => {
  quiet(on)
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: '/sp' } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => {
    throw new Error('spawn rm ENOENT')
  })
  expect(await $.session.end({ ...END })).toEqual({ sessionId: 's1' })
})
