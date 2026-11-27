import type { On, PromptComposeSection } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared, type Shared } from '../core'
import { MODULE_META } from '.'
import { registerAudit } from './audit'
import { registerCharter } from './charter'

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
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

// The plugin's own audit and charter are off; copies run beneath them on one Shared the test reads.
// Hooks after them stand for the engine: it answers `engine.sections` and echoes each description.
function copies(on: On, withCharter: boolean) {
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.env(on, { COMPANY_OFF: 'audit,charter' })
  const shared: Shared = createShared(MODULE_META.map((m) => m.id))
  if (withCharter) registerCharter(on, { id: 'charter', caps: { section: 4800 }, shared })
  registerAudit(on, { id: 'audit', caps: {}, shared })
  const engine: { sections: readonly PromptComposeSection[] } = { sections: SECTIONS }
  on('prompt.compose', {}, () => ({ sections: engine.sections.map((s) => ({ ...s })) }))
  on('tool.describe', {}, (_, e) => ({ description: e.description }))
  return { shared, engine }
}

test('audit: sections and tool descriptions pass through byte-identical, in order; top5 sorted by size', async ($, on) => {
  const { shared } = copies(on, false)
  await $.session.start({ ...START })

  expect(await $.prompt.compose(COMPOSE)).toEqual({ sections: SECTIONS })
  const bash = 'Run a command.\n'.repeat(100)
  expect(await $.tool.describe({ tool: 'Bash', description: bash, provider: ENGINE } as never)).toEqual({ description: bash })
  expect(await $.tool.describe({ tool: 'Read', description: 'r'.repeat(900), provider: ENGINE } as never)).toEqual({ description: 'r'.repeat(900) })

  expect(shared.top5).toEqual([
    { id: 'prompt:env', chars: 2000 },
    { id: 'tool:Bash', chars: 1500 },
    { id: 'prompt:system', chars: 1200 },
    { id: 'tool:Read', chars: 900 },
    { id: 'prompt:memory', chars: 800 },
  ])
  // A later description of a tool replaces its size.
  await $.tool.describe({ tool: 'Read', description: 'r'.repeat(5000), provider: ENGINE } as never)
  expect(shared.top5.map((t) => t.id)).toEqual(['tool:Read', 'prompt:env', 'tool:Bash', 'prompt:system', 'prompt:memory'])
  expect(shared.health.audit).toMatchObject({ on: true, fails: 0 })
})

test('audit: with the charter on, top5 holds the charter section at its real length', async ($, on) => {
  const { shared } = copies(on, true)
  await $.session.start({ ...START })
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.slice(0, SECTIONS.length)).toEqual(SECTIONS)
  const charter = out.sections[SECTIONS.length]!
  expect(charter.id).toBe('company:charter')
  expect(charter.text.length).toBeGreaterThan(2000)
  expect(shared.top5).toContainEqual({ id: 'prompt:company:charter', chars: charter.text.length })
})

test('audit: a main render replaces the prompt part; /context and teammate renders change nothing; tools stay', async ($, on) => {
  const { shared, engine } = copies(on, false)
  await $.session.start({ ...START })
  await $.prompt.compose(COMPOSE)
  await $.tool.describe({ tool: 'Bash', description: 'x'.repeat(1500), provider: ENGINE } as never)
  const before = shared.top5
  engine.sections = [{ id: 'huge', text: 'h'.repeat(9000), scope: 'session' }]
  await $.prompt.compose({ ...COMPOSE, traits: ['analysis'] })
  await $.prompt.compose({ ...COMPOSE, traits: ['teammate'] })
  expect(shared.top5).toEqual(before)
  engine.sections = SECTIONS.filter((s) => s.id !== 'env')
  await $.prompt.compose(COMPOSE)
  expect(shared.top5.map((t) => t.id)).toEqual(['tool:Bash', 'prompt:system', 'prompt:memory', 'prompt:intro', 'prompt:doing_tasks'])
})

test('audit: the plugin passes the engine sections through ahead of the charter', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => ({ sections: SECTIONS.map((s) => ({ ...s })) }))
  const out = await $.prompt.compose(COMPOSE)
  expect(out.sections.slice(0, SECTIONS.length)).toEqual(SECTIONS)
  expect(out.sections.slice(SECTIONS.length).map((s) => s.id)).toEqual(['company:charter'])
})
