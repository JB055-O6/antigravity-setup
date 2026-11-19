import { expect, test } from 'claude-code/testing'
import { decideMode } from './mode'

const LABELLED: Array<[number, string, 'solo' | 'full']> = [
  [1, 'rename the variable tmp to total in utils.py', 'solo'],
  [2, 'what does this error mean: TypeError: undefined is not a function', 'solo'],
  [3, 'fix the typo in the README title', 'solo'],
  [4, 'add a docstring to the parse function', 'solo'],
  [5, 'run the tests and tell me which fail', 'solo'],
  [6, 'change the button colour to blue', 'solo'],
  [7, 'explain how the cache works in this file', 'solo'],
  [8, 'bump the version number to 1.4.2', 'solo'],
  [9, 'sort the imports in main.py', 'solo'],
  [10, 'convert this list to a set to remove duplicates', 'solo'],
  [11, 'build a login page with email validation and password reset', 'full'],
  [12, 'refactor the payment module to use the new API', 'full'],
  [13, 'delete all the old log files on the server', 'full'],
  [14, 'deploy the latest changes to production', 'full'],
  [15, 'design the database schema for the booking system', 'full'],
  [16, 'make the app better somehow, you decide', 'full'],
  [17, 'update src/a.ts, src/b.ts and lib/c.ts to use the new logger', 'full'],
  [18, '- add a search box\n- add filters\n- add pagination', 'full'],
  [19, '!project rename the variable tmp to total', 'full'],
  [20, '!solo build a tiny script that prints hello', 'solo'],
]

for (const [n, text, mode] of LABELLED) {
  test(`labelled prompt ${n} is ${mode}`, () => {
    expect(decideMode({ text }).mode).toBe(mode)
  })
}

test('!project beats a small clean request', () => {
  const d = decideMode({ text: '!project fix the typo' })
  expect(d.mode).toBe('full')
  expect(d.reasons).toEqual(['client forced full process'])
})

test('!solo beats every signal', () => {
  const d = decideMode({
    text: '!solo delete production and rewrite the whole system',
    checkFailed: true,
    failureOnRecord: true,
  })
  expect(d.mode).toBe('solo')
  expect(d.reasons).toEqual(['client forced solo'])
})

test('prefix is case-insensitive and allows leading whitespace', () => {
  expect(decideMode({ text: '  !PROJECT hi' }).mode).toBe('full')
  expect(decideMode({ text: '\n!Solo deploy' }).mode).toBe('solo')
})

test('prefix and following whitespace are removed from text', () => {
  expect(decideMode({ text: '!project   rename tmp' }).text).toBe('rename tmp')
  expect(decideMode({ text: '  !solo\n build it' }).text).toBe('build it')
})

test('text is unchanged when there is no prefix', () => {
  expect(decideMode({ text: '  rename tmp  ' }).text).toBe('  rename tmp  ')
})

test('checkFailed forces full', () => {
  const d = decideMode({ text: 'rename tmp', checkFailed: true })
  expect(d.mode).toBe('full')
  expect(d.reasons).toEqual(['a check failed (in a bind)'])
})

test('failureOnRecord forces full', () => {
  const d = decideMode({ text: 'rename tmp', failureOnRecord: true })
  expect(d.mode).toBe('full')
  expect(d.reasons).toEqual(['this kind of task has a failure on record'])
})

test('solo reason for a clean request', () => {
  const d = decideMode({ text: 'rename tmp' })
  expect(d.reasons).toEqual(['small, clear, reversible task'])
})

test('signal c reason names the matched term', () => {
  expect(decideMode({ text: 'please delete the cache' }).reasons).toEqual([
    'irreversible or high-risk action: delete',
  ])
  expect(decideMode({ text: 'run git reset --hard now' }).reasons).toEqual([
    'irreversible or high-risk action: reset --hard',
  ])
  expect(decideMode({ text: 'do a force-push' }).reasons).toEqual([
    'irreversible or high-risk action: force-push',
  ])
})

test('signal d reason names the matched term', () => {
  expect(decideMode({ text: 'refactor the parser' }).reasons).toEqual([
    'large scope: refactor',
  ])
  expect(decideMode({ text: 'do it end-to-end' }).reasons).toEqual([
    'large scope: end-to-end',
  ])
  expect(decideMode({ text: 'start from scratch' }).reasons).toEqual([
    'large scope: from scratch',
  ])
})

test('signal e reason for three list items, numbered and bulleted', () => {
  const d = decideMode({ text: '1. one\n2) two\n* three' })
  expect(d.reasons).toEqual(['three or more separate requirements'])
})

test('two list items are not enough', () => {
  expect(decideMode({ text: '- one\n- two' }).mode).toBe('solo')
})

test('signal f reason for more than 120 words', () => {
  const long = Array.from({ length: 121 }, () => 'word').join(' ')
  expect(decideMode({ text: long }).reasons).toEqual(['long request'])
  const exactly = Array.from({ length: 120 }, () => 'word').join(' ')
  expect(decideMode({ text: exactly }).mode).toBe('solo')
})

test('signal g reason for three distinct files', () => {
  expect(decideMode({ text: 'touch a/b c/d README.md' }).reasons).toEqual([
    'touches three or more files',
  ])
})

test('repeated file path counts once', () => {
  expect(decideMode({ text: 'edit a.ts then a.ts then a.ts' }).mode).toBe('solo')
})

test('signal h reason for unclear request', () => {
  expect(decideMode({ text: 'tidy up, you decide' }).reasons).toEqual(['unclear request'])
  expect(decideMode({ text: 'Do What\'s Best' }).reasons).toEqual(['unclear request'])
})

test('multiple signals give multiple reasons', () => {
  const d = decideMode({ text: 'delete the whole thing', checkFailed: true })
  expect(d.reasons).toEqual([
    'a check failed (in a bind)',
    'irreversible or high-risk action: delete',
    'large scope: whole',
  ])
})

test('word boundary: product does not match prod', () => {
  expect(decideMode({ text: 'rename the product label' }).mode).toBe('solo')
  expect(decideMode({ text: 'push to prod' }).mode).toBe('full')
})

test('word boundary: rebuild does not match build', () => {
  expect(decideMode({ text: 'rebuild the index' }).mode).toBe('solo')
})

test('word boundary: designer does not match design', () => {
  expect(decideMode({ text: 'ask the designer' }).mode).toBe('solo')
})

test('word boundary: matching is case-insensitive', () => {
  expect(decideMode({ text: 'DEPLOY it' }).mode).toBe('full')
})

test('a prefix must be a whole word: !soloist and !projector are not prefixes', () => {
  expect(decideMode({ text: '!soloist build the whole platform' }).mode).toBe('full')
  expect(decideMode({ text: '!projector rename x' }).mode).toBe('solo')
  expect(decideMode({ text: '!solo' }).reasons).toEqual(['client forced solo'])
})
