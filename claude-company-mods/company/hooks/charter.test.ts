import { expect, test } from 'claude-code/testing'

test('prompt.compose carries the charter, last, beside the engine sections', async ($, on) => {
  // Nothing sits beneath the plugin: this hook stands for the engine.
  on('prompt.compose', () => ({
    sections: [
      { id: 'intro', text: 'engine intro', scope: 'shared' },
      { id: 'tone', text: 'engine tone', scope: 'session' },
    ],
  }))

  const { sections } = await $.prompt.compose({
    model: 'test-model',
    promptModel: 'test-model',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  const ids = sections.map(s => s.id)

  expect(ids).toContain('intro')
  expect(ids).toContain('tone')

  const last = sections[sections.length - 1]!
  expect(last.scope).toBe('session')
  expect(last.text).toContain('## The 21 rules')
  expect(last.text).toContain(
    'Every mistake has a consequence, for everyone, without exception.',
  )
})
