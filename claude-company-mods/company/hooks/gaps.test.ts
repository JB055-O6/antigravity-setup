import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

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

const BIG = 300 * 1024

function quiet(on: On) {
  mock.store(on)
  const statuses: Array<string | undefined> = []
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return statuses
}

function bigFile(on: On, result: Record<string, unknown>) {
  on('fs.stat', () => ({ value: { kind: 'file', size: BIG, mtimeMs: 0, isLink: false } }))
  on('tool.call', { tool: 'Read' }, () => result as never)
}

test('read cap leaves an error result untouched', async ($, on) => {
  quiet(on)
  bigFile(on, { result: 'boom', isError: true })
  const r = await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  expect(r.isError).toBe(true)
  expect(JSON.stringify(r.context ?? [])).not.toContain('[company-diet]')
})

test('read cap leaves a denied result untouched', async ($, on) => {
  quiet(on)
  bigFile(on, { deny: 'no' })
  const r = await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  expect(r.deny).toBe('no')
  expect(r.context).toBeUndefined()
})

test('grep cap does not count an error result', async ($, on) => {
  const statuses = quiet(on)
  on('tool.call', { tool: 'Grep' }, () => ({ result: 'boom', isError: true }) as never)
  await $.tool.call({ tool: 'Grep', pattern: 'x', output_mode: 'content' })
  expect(statuses.at(-1) ?? '').not.toContain(' diet')
})

test('a failed Agent call marks the run failed', async ($, on) => {
  quiet(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: 'boom', isError: true }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN })
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1' } as never)
  const r = await $.command.run({ command: 'company', args: '' } as never)
  expect(r.text).toContain('✗ general-purpose')
})

test('a workflow or resume spawn is not routed', async ($, on) => {
  quiet(on)
  const seen: Array<{ model?: string }> = []
  on('agent.spawn', (_, e) => {
    seen.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${seen.length}` }
  })
  await $.agent.spawn({ ...SPAWN, workflow: true } as never)
  await $.agent.spawn({ ...SPAWN, resume: 'x' } as never)
  expect(seen).toHaveLength(2)
  expect(seen[0]!.model).toBeUndefined()
  expect(seen[1]!.model).toBeUndefined()
})

test('diet count is exact', async ($, on) => {
  const statuses = quiet(on)
  on('fs.stat', () => ({ value: { kind: 'file', size: BIG, mtimeMs: 0, isLink: false } }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok', text: 'ok' }) as never)
  await $.tool.call({ tool: 'Read', file_path: '/a.log' })
  await $.tool.call({ tool: 'Read', file_path: '/b.log' })
  expect(statuses.at(-1)).toMatch(/ · 2 diet$/)
})
