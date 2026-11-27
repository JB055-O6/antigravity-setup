import { expect, test } from 'claude-code/testing'
import { LOCK_MS, excludeWithLine, lockState } from './graphlock'

const NOW = 10_000_000

test('lock: none is free; a live holder inside 15 min is held; older, or a dead holder, is stale', () => {
  expect(LOCK_MS).toBe(900_000)
  expect(lockState(null, NOW, true)).toBe('free')
  expect(lockState({ pid: 7, at: NOW - 1000 }, NOW, true)).toBe('held')
  expect(lockState({ pid: 7, at: NOW - LOCK_MS }, NOW, true)).toBe('held')
  expect(lockState({ pid: 7, at: NOW - LOCK_MS - 1 }, NOW, true)).toBe('stale')
  expect(lockState({ pid: 7, at: NOW - 1000 }, NOW, false)).toBe('stale')
  // A time far ahead (clocks of two machines apart) does not hold the lock for ever.
  expect(lockState({ pid: 7, at: NOW + LOCK_MS + 1 }, NOW, true)).toBe('stale')
})

test('exclude: adds the line once, keeps the user lines and the last newline; null when there', () => {
  const user = '# git ls-files --others --exclude-from=.git/info/exclude\n*.o\n'
  const once = excludeWithLine(user, 'graphify-out/')
  expect(once).toBe(`${user}graphify-out/\n`)
  expect(excludeWithLine(once!, 'graphify-out/')).toBeNull()
  // No newline at the end: one goes in before the line.
  expect(excludeWithLine('*.o', 'graphify-out/')).toBe('*.o\ngraphify-out/\n')
  expect(excludeWithLine('', 'graphify-out/')).toBe('graphify-out/\n')
  expect(excludeWithLine('*.o\r\n', 'graphify-out/')).toBe('*.o\r\ngraphify-out/\r\n')
  expect(excludeWithLine('*.o\n  graphify-out/  \n', 'graphify-out/')).toBeNull()
})
