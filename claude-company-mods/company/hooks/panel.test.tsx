import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { directivesNote } from './directives'
import { EMPTY_PANEL, panelRows } from './panel'

const PANE = {
  plugin: 'company',
  component: 'Pane',
  requestId: 'company',
  props: { title: 'Company', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

function setup(on: On, five = 98, week = 13) {
  mock.store(on)
  const opened: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.register', (_, e) => ({ value: { agent: `company:${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  // Like the person's account: ponytail and i-have-adhd in settings, caveman and headroom synced.
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true, 'i-have-adhd@i-have-adhd': true } } }))
  on('fs.read', () => ({ value: '{"version":"0.9.0"}' }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('command.list', () => ({
    value: [
      { name: 'caveman:caveman', description: '', source: 'plugin', plugin: 'caveman' },
      { name: 'headroom:peek', description: '', source: 'plugin' },
    ],
  }) as never)
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: five }, { kind: 'seven_day', percentUsed: week }] },
  }) as never)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  return opened
}

test('account-synced caveman and headroom count as on (the 2/4 bug)', () => {
  expect(directivesNote({ 'ponytail@ponytail': true, 'i-have-adhd@i-have-adhd': true }, ['caveman', 'headroom'])).toBe('directives 4/4')
})

test('panel rows: all seven parts, economy explained', () => {
  const rows = panelRows({ ...EMPTY_PANEL, crew: 5, economy: true, fiveHour: 98, week: 13, directives: [{ name: 'ponytail', on: true }] })
  expect(rows.map((r) => r.name)).toEqual(['Charter', 'Router', 'Governor', 'Meter', 'Diet', 'Crew', 'Directives'])
  expect(rows[3]!.text).toContain('ECONOMY ON: near your limit')
})

test('desktop start opens the pane; it shows ACTIVE, 4/4 directives and live activity', async ($, on) => {
  const opened = setup(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toContain('company')
  await $.agent.spawn({
    tool_use_id: 'tu1', prompt: 'Do it.', description: 'Find where the config is loaded', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: false, fork: false,
  } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /ACTIVE: all 7 parts on/ }))?.text).toContain('company 0.9.0')
  expect((await ui.find({ type: 'Text', text: /caveman on/ }))?.text).toContain('headroom on')
  expect((await ui.find({ type: 'Text', text: /ECONOMY ON/ }))).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /route: Explore → haiku medium/ }))).toBeTruthy()
  await ui.unmount()
})

test('terminal start does not open the pane; /company opens it', async ($, on) => {
  const opened = setup(on, 40, 20)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(opened).toHaveLength(0)
  const r = await $.command.run({ command: 'company', args: '' } as never)
  expect(opened).toContain('company')
  expect(r.text).toContain('directives 4/4')
})
