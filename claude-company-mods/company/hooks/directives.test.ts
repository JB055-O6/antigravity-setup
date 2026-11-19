import { expect, test } from 'claude-code/testing'
import { CHARTER } from './charter'
import { DIET_BLOCK } from './diet'

test('the charter carries all four core directives and their precedence', () => {
  for (const name of ['ponytail (code)', 'headroom (big files)', 'i-have-adhd (replies to the client)', 'caveman (wording)']) {
    expect(CHARTER).toContain(name)
  }
  expect(CHARTER).toContain('Precedence: correctness')
})

test('every subagent block carries the core directives', () => {
  for (const name of ['ponytail', 'headroom', 'caveman', 'At most 25 lines']) expect(DIET_BLOCK).toContain(name)
})
