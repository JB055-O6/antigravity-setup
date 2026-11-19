import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { DIET_BLOCK } from './diet'

const SPAWN = {
  tool_use_id: 'tu1',
  prompt: 'Do it.',
  description: 'Fix the failing login test',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'opus',
  background: false,
  fork: false,
} as const

function engine(on: On) {
  const seen: Array<{ model?: string; prompt: string; subagentType: string }> = []
  on('agent.spawn', (_, e) => {
    seen.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${seen.length}` }
  })
  return seen
}

function quiet(on: On) {
  mock.store(on)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return statuses
}

test('the block is appended once to a general-purpose spawn, with routing in the same rewrite', async ($, on) => {
  quiet(on)
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN })
  expect(seen[0]!.prompt).toBe(`Do it.\n\n${DIET_BLOCK}`)
  expect(seen[0]!.model).toBe('sonnet')
})

test('an Explore spawn and a crew agent spawn get the block; routing differs per kind', async ($, on) => {
  quiet(on)
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'company:builder' })
  expect(seen[0]!.prompt.endsWith(DIET_BLOCK)).toBe(true)
  expect(seen[0]!.model).toBe('haiku')
  expect(seen[1]!.prompt.endsWith(DIET_BLOCK)).toBe(true)
  expect(seen[1]!.model).toBeUndefined()
})

test('the block is not appended twice', async ($, on) => {
  quiet(on)
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN })
  await $.agent.spawn({ ...SPAWN, prompt: seen[0]!.prompt })
  expect(seen[1]!.prompt).toBe(seen[0]!.prompt)
  expect(seen[1]!.prompt.split('[company-diet]')).toHaveLength(2)
})

test('a fork, a teammate and a resume are left alone', async ($, on) => {
  quiet(on)
  const seen = engine(on)
  await $.agent.spawn({ ...SPAWN, subagentType: 'fork', fork: true })
  await $.agent.spawn({ ...SPAWN, isTeammate: true })
  expect(seen[0]!.prompt).toBe('Do it.')
  expect(seen[1]!.prompt).toBe('Do it.')
})

// The engine beneath: answers stat for given sizes, records what Read reached it.
function files(on: On, sizes: Record<string, number>, failing = false) {
  on('fs.stat', (_, e) => {
    if (failing || !(e.path in sizes)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: sizes[e.path]!, mtimeMs: 0, isLink: false } }
  })
  const reached: Array<Record<string, unknown>> = []
  on('tool.call', { tool: 'Read' }, (_, e) => {
    reached.push(e as never)
    return { result: 'ok' as never, text: 'ok' } as never
  })
  return reached
}

const BIG = 300 * 1024

test('a main-loop Read of a 300 KB text file gets limit 600 and the note', async ($, on) => {
  const statuses = quiet(on)
  const reached = files(on, { '/a.log': BIG })
  const r = await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  expect(reached[0]!.limit).toBe(600)
  expect(r.context?.[0]).toContain('[company-diet] This file is 300 KB; only its first 600 lines')
  expect(r.context?.[0]).toContain('scout subagent')
  expect(statuses.at(-1)).toContain(' · 1 diet')
})

test('Reads that must pass untouched', async ($, on) => {
  quiet(on)
  const reached = files(on, { '/a.log': BIG, '/b.pdf': BIG, '/s.txt': 1000 })
  await $.tool.call({ tool: 'Read', file_path: '/a.log', limit: 50 })
  await $.tool.call({ tool: 'Read', file_path: '/a.log', offset: 10 })
  await $.tool.call({ tool: 'Read', file_path: '/a.log', agentId: 'a9' })
  await $.tool.call({ tool: 'Read', file_path: '/b.pdf' })
  await $.tool.call({ tool: 'Read', file_path: '/s.txt' })
  expect(reached.map(r => r.limit)).toEqual([50, undefined, undefined, undefined, undefined])
  expect(reached[1]!.offset).toBe(10)
})

test('a stat failure passes the Read untouched', async ($, on) => {
  quiet(on)
  const reached = files(on, {}, true)
  const r = await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  expect(reached[0]!.limit).toBeUndefined()
  expect(r.deny).toBeUndefined()
  expect(r.context).toBeUndefined()
})

test('main-loop Grep content without head_limit gets 200; the rest is untouched', async ($, on) => {
  const statuses = quiet(on)
  const reached: Array<Record<string, unknown>> = []
  on('tool.call', { tool: 'Grep' }, (_, e) => {
    reached.push(e as never)
    return { result: 'ok' as never, text: 'ok' } as never
  })
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content', head_limit: 5 })
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'files_with_matches' })
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content', agentId: 'a9' })
  expect(reached.map(r => r.head_limit)).toEqual([200, 5, undefined, undefined, undefined])
  expect(statuses.at(-1)).toContain(' · 1 diet')
})

test('the status line shows the diet count', async ($, on) => {
  const statuses = quiet(on)
  engine(on)
  await $.agent.spawn({ ...SPAWN })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' })
  expect(statuses.at(-1)).toMatch(/ · \d+ diet$/)
})
