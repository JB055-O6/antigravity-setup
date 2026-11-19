import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { directivesNote } from './directives'
import { EMPTY_PANEL, panelBlocks } from './panel'

const PANE = {
  plugin: 'company',
  component: 'Pane',
  requestId: 'company',
  props: { title: 'Company', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const SPAWN = {
  tool_use_id: 'tu1', prompt: 'Do it.', description: 'Find where the config is loaded', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false,
} as const

function setup(on: On, opts: { five?: number; week?: number; placed?: boolean } = {}) {
  mock.store(on)
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.register', (_, e) => ({ value: { agent: `company:${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: opts.placed === false ? { isPlaced: false, reason: 'no-surface: none attached' } : { isPlaced: true } }
  })
  // Like the person's account: ponytail and i-have-adhd in settings, caveman and headroom synced.
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true, 'i-have-adhd@i-have-adhd': true } } }))
  on('fs.read', () => ({ value: '{"version":"0.10.0"}' }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('command.list', () => ({
    value: [
      { name: 'caveman:caveman', description: '', source: 'plugin', plugin: 'caveman' },
      { name: 'headroom:peek', description: '', source: 'plugin' },
    ],
  }) as never)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: opts.five ?? 98 }, { kind: 'seven_day', percentUsed: opts.week ?? 13 }] },
  }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }) as never)
  return opened
}

test('account-synced caveman and headroom count as on (the 2/4 bug)', () => {
  expect(directivesNote({ 'ponytail@ponytail': true, 'i-have-adhd@i-have-adhd': true }, ['caveman', 'headroom'])).toBe('directives 4/4')
})

test('seven blocks, economy explained', () => {
  const b = panelBlocks({ ...EMPTY_PANEL, crew: 5, economy: true, fiveHour: 98, week: 13, directives: [{ name: 'ponytail', on: true }] })
  expect(b.map((x) => x.name)).toEqual(['CHARTER', 'ROUTER', 'GOVERNOR', 'METER', 'DIET', 'CREW', 'DIRECTIVES'])
  expect(b[3]!.lines[1]).toContain('Economy: ON')
})

test('desktop: pane opens; blocks show ACTIVE, the route, and the crew run from running to done', async ($, on) => {
  const opened = setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toContain('company')
  await $.agent.spawn(SPAWN as never)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ACTIVE: all 7 parts on/ }))?.text).toContain('company 0.10.0')
  expect(await ui.find({ type: 'Text', text: /Explore → haiku medium/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /▶ running Explore on haiku medium, 0 steps: Find where the config is loaded/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /caveman ON/ })).toBeTruthy()
  await ui.unmount()
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'x', prompt: 'x' } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /✓ done Explore on haiku medium/ })).toBeTruthy()
  await ui.unmount()
})

test('a desktop app attaching later opens the pane', async ($, on) => {
  const opened = setup(on)
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toHaveLength(0)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  expect(opened).toContain('company')
})

test('/company prints every block and says why the pane is not shown', async ($, on) => {
  setup(on, { five: 40, week: 20, placed: false })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'company', args: '' } as never)
  for (const b of ['CHARTER', 'ROUTER', 'GOVERNOR', 'METER', 'DIET', 'CREW', 'DIRECTIVES']) expect(r.text).toContain(`[✓ ${b}]`)
  expect(r.text).toContain('Panel: not shown here (no-surface: none attached)')
  expect(r.text).toContain('Limits: 5-hour 40% · week 20%')
  expect(r.text).toContain('caveman ON')
})
