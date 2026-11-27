import { expect, mock, test } from 'claude-code/testing'
import { createShared, type Ctx } from '../core'
import { MODULE_META } from '.'
import { registerAudit } from './audit'

const SECTIONS = [
  { id: 'intro', text: 'a'.repeat(300), scope: 'shared' },
  { id: 'system', text: 'b'.repeat(1200), scope: 'shared' },
  { id: 'doing_tasks', text: 'c'.repeat(50), scope: 'shared' },
  { id: 'tools', text: 'ünï 🙂\n\n  trailing  ', scope: 'shared' },
  { id: 'memory', text: 'd'.repeat(800), scope: 'session' },
  { id: 'env', text: 'e'.repeat(2000), scope: 'session' },
] as const
const COMPOSE = { model: 'opus', promptModel: 'opus', surfaces: ['terminal'], tools: ['Bash'], outputStyle: null, traits: [] } as const
const ENGINE = { plugin: 'engine', tier: 'core' } as const

test('audit: sections and tool descriptions pass through byte-identical, in order; top5 sorted by size', async ($, on) => {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The plugin's own audit and charter are off; this copy runs beneath them, with a Shared the test reads.
  mock.env(on, { COMPANY_OFF: 'audit,charter' })
  const ctx: Ctx = { id: 'audit', caps: {}, shared: createShared(MODULE_META.map((m) => m.id)) }
  registerAudit(on, ctx)
  on('prompt.compose', () => ({ sections: SECTIONS.map((s) => ({ ...s })) }))
  on('tool.describe', {}, (_, e) => ({ description: e.description }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await $.prompt.compose(COMPOSE)).toEqual({ sections: SECTIONS })
  const bash = 'Run a command.\n'.repeat(100)
  expect(await $.tool.describe({ tool: 'Bash', description: bash, provider: ENGINE } as never)).toEqual({ description: bash })
  expect(await $.tool.describe({ tool: 'Read', description: 'r'.repeat(900), provider: ENGINE } as never)).toEqual({ description: 'r'.repeat(900) })

  expect(ctx.shared.top5).toEqual([
    { id: 'prompt:env', chars: 2000 },
    { id: 'tool:Bash', chars: 1500 },
    { id: 'prompt:system', chars: 1200 },
    { id: 'tool:Read', chars: 900 },
    { id: 'prompt:memory', chars: 800 },
  ])
  // A later render of a section replaces its size.
  await $.tool.describe({ tool: 'Read', description: 'r'.repeat(5000), provider: ENGINE } as never)
  expect(ctx.shared.top5.map((t) => t.id)).toEqual(['tool:Read', 'prompt:env', 'tool:Bash', 'prompt:system', 'prompt:memory'])
  expect(ctx.shared.health.audit).toMatchObject({ on: true, fails: 0 })
})

test('audit: the plugin passes the engine sections through ahead of the charter', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: SECTIONS.map((s) => ({ ...s })) }))
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.slice(0, SECTIONS.length)).toEqual(SECTIONS)
  expect(out.sections.slice(SECTIONS.length).map((s) => s.id)).toEqual(['company:charter'])
})
