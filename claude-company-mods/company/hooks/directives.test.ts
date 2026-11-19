import { expect, test } from 'claude-code/testing'
import { CHARTER } from './charter'
import { DIET_BLOCK } from './diet'
import { directivesNote } from './directives'

test('the charter carries all four core directives and their precedence', () => {
  for (const name of ['ponytail (code)', 'headroom (big files)', 'i-have-adhd (replies to the client)', 'caveman (wording)']) {
    expect(CHARTER).toContain(name)
  }
  expect(CHARTER).toContain('Precedence: correctness')
})

test('every subagent block carries the core directives', () => {
  for (const name of ['ponytail', 'headroom', 'caveman', 'i-have-adhd', 'At most 25 lines']) expect(DIET_BLOCK).toContain(name)
})

test('boot check: all four on, some missing, unreadable settings', () => {
  const on = { 'ponytail@ponytail': true, 'i-have-adhd@i-have-adhd': true, 'headroom@synced': true, 'caveman@synced': true }
  expect(directivesNote(on)).toBe('directives 4/4')
  expect(directivesNote({ ...on, 'ponytail@ponytail': false })).toBe('directives 3/4, missing ponytail')
  expect(directivesNote({ 'caveman@x': true })).toBe('directives 1/4, missing ponytail, i-have-adhd, headroom')
  expect(directivesNote(undefined)).toBe('directives 0/4, missing ponytail, i-have-adhd, headroom, caveman')
})
