import { expect, test } from 'claude-code/testing'
import { classifyTask, routeSpawn } from './router'

const cases: Record<string, string[]> = {
  lookup: [
    'Find where the config is loaded',
    'List all files that import the logger',
    'Summarise the README',
    'Which files mention the retry policy?',
    'Look up the version of the dependency',
  ],
  review: [
    'Code review of the auth change',
    'Audit the upload handler',
    'Security pass on the login flow',
    'Find bugs in the parser',
    'Check the diff before merge',
  ],
  architecture: [
    'Architecture of the sync engine',
    'Design the cache layer',
    'Weigh the trade-off between queues',
    'Build the service from scratch',
    'Planning the migration order',
  ],
  research: [
    'Research prior work on CRDTs',
    'Investigate why latency grew',
    'Read the papers on consensus',
    'Benchmark the three parsers',
    'Deep dive into the scheduler',
  ],
  code: [
    'Fix the failing login test',
    'Implement the export button',
    'Refactor the store module',
    'Update the dashboard colours',
    'Find the config loader and fix its default',
  ],
}

for (const [cls, list] of Object.entries(cases)) {
  for (const text of list) {
    test(`classify ${cls}: ${text}`, () => {
      expect(classifyTask(text)).toBe(cls)
    })
  }
}

test('precedence: review beats architecture, research, code and lookup', () => {
  expect(classifyTask('Design review of the plan')).toBe('review')
  expect(classifyTask('Security research and fix')).toBe('review')
  expect(classifyTask('Audit and find the files')).toBe('review')
})

test('precedence: architecture beats research, code and lookup', () => {
  expect(classifyTask('Research the architecture')).toBe('architecture')
  expect(classifyTask('Plan and implement the feature')).toBe('architecture')
  expect(classifyTask('Search for a design')).toBe('architecture')
})

test('precedence: research beats code and lookup', () => {
  expect(classifyTask('Investigate and fix the leak')).toBe('research')
  expect(classifyTask('Find the paper')).toBe('research')
})

test('precedence: a code-signal word with lookup words is code', () => {
  expect(classifyTask('Find the handler and edit it')).toBe('code')
  expect(classifyTask('Search the repo and add a test')).toBe('code')
})

test('no listed word is code; matching is case-insensitive', () => {
  expect(classifyTask('Do the thing')).toBe('code')
  expect(classifyTask('')).toBe('code')
  expect(classifyTask('FIND THE FILE')).toBe('lookup')
  expect(classifyTask('Code Review please')).toBe('review')
})

test('word boundaries: near-words do not count', () => {
  expect(classifyTask('Ask the designer')).toBe('code')
  expect(classifyTask('Ask the finder')).toBe('code')
  expect(classifyTask('Ask the reviewer')).toBe('code')
  expect(classifyTask('Reading material')).toBe('code')
  expect(classifyTask('The planet')).toBe('code')
  expect(classifyTask('Insecurity')).toBe('code')
  expect(classifyTask('Adding things')).toBe('code')
})

const base = {
  subagentType: 'general-purpose',
  description: 'Find where the config is loaded',
  prompt: 'Look it up.',
  providerIsEngine: true,
}

test('routeSpawn null: caller gave a model', () => {
  expect(routeSpawn({ ...base, model: 'opus' })).toBeNull()
})

test('routeSpawn null: fork', () => {
  expect(routeSpawn({ ...base, subagentType: 'fork' })).toBeNull()
})

test('routeSpawn null: not a built-in (plugin agent)', () => {
  expect(routeSpawn({ ...base, subagentType: 'lab:runner', providerIsEngine: false })).toBeNull()
})

test('routeSpawn null: crew names', () => {
  for (const n of ['scout', 'builder', 'reviewer', 'architect', 'sage']) {
    expect(routeSpawn({ ...base, subagentType: n })).toBeNull()
    expect(routeSpawn({ ...base, subagentType: `company:${n}` })).toBeNull()
  }
})

test('routeSpawn: Explore is haiku medium', () => {
  expect(routeSpawn({ ...base, subagentType: 'Explore', description: 'Fix everything' })).toEqual({
    model: 'haiku',
    effort: 'medium',
    reason: 'Explore is read-only search',
  })
})

test('routeSpawn: general-purpose by class', () => {
  const r = (description: string) => routeSpawn({ ...base, description, prompt: '' })
  expect(r('Find the loader')).toMatchObject({ model: 'haiku', effort: 'medium' })
  expect(r('Fix the login test')).toMatchObject({ model: 'sonnet', effort: 'medium' })
  expect(r('Security audit')).toMatchObject({ model: 'opus', effort: 'max' })
  expect(r('Architecture of sync')).toMatchObject({ model: 'opus', effort: 'xhigh' })
  expect(r('Research CRDTs')).toMatchObject({ model: 'opus', effort: 'max' })
  expect(r('Security audit')!.reason).toContain('review')
})

test('routeSpawn: any other built-in type is routed by class', () => {
  expect(routeSpawn({ ...base, subagentType: 'Plan', description: 'Fix the bug', prompt: '' })).toMatchObject({
    model: 'sonnet',
  })
})

test('routeSpawn: the prompt counts as well as the description', () => {
  expect(routeSpawn({ ...base, description: 'Task', prompt: 'Review the diff for bugs. Audit it.' })).toMatchObject({
    model: 'opus',
  })
})
