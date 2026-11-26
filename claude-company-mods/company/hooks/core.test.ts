import { expect, test } from 'claude-code/testing'
import { acted, added, capText, createShared, cutCodePoints, envOff, estimateTokens, fail, noteOf, redact, saved, setOff, setOn, type Ctx } from './core'
import { MODULE_META } from './modules'

function ctxOf(caps: Ctx['caps'] = {}): Ctx {
  return { id: 'charter', caps, shared: createShared(MODULE_META.map((m) => m.id)) }
}

test('capText passes text at the cap whole and cuts cap+1 with one note', () => {
  const c = ctxOf({ section: 5 })
  expect(capText(c, 'section', 'abcde')).toBe('abcde')
  expect(c.shared.log).toHaveLength(0)
  expect(capText(c, 'section', 'abcdef')).toBe('abcde')
  expect(c.shared.log).toHaveLength(1)
  expect(c.shared.log[0]!.kind).toBe('charter')
  // A shape without a cap is not cut.
  expect(capText(c, 'toolContext', 'abcdef')).toBe('abcdef')
})

test('cutCodePoints never leaves a lone surrogate', () => {
  expect(cutCodePoints('a😀b', 2)).toBe('a😀')
  expect(cutCodePoints('a😀b', 1)).toBe('a')
  expect(cutCodePoints('ab', 5)).toBe('ab')
})

test('estimateTokens is chars / 4, rounded up', () => {
  expect(estimateTokens(4001)).toBe(1001)
  expect(estimateTokens(0)).toBe(0)
})

test('redact hides credentials and removes control characters', () => {
  const url = redact('https://u:p@h/x')
  expect(url).not.toContain('u:p')
  expect(url).toContain('h/x')
  const key = redact('api_key=sk-abc123def456ghi789')
  expect(key).not.toContain('sk-abc123def456ghi789')
  expect(key).toContain('api_key=')
  expect(redact('token: ghp_' + 'x'.repeat(36))).not.toContain('ghp_')
  expect(redact('run aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dF3 now')).toBe('run *** now')
  expect(redact('a\u0007b\u001b[0mc\u202ed\ne')).toBe('ab[0mcd e')
})

test('redact does not cut long text; noteOf cuts at 80 chars', () => {
  const long = 'word '.repeat(30)
  expect(redact(long)).toBe(long)
  const c = ctxOf()
  noteOf(c, long)
  expect(c.shared.log[0]!.text).toBe(long.slice(0, 80))
})

test('the ledger counts token estimates and marks the state dirty', () => {
  const c = ctxOf()
  added(c, 4001)
  saved(c, 50)
  acted(c)
  acted(c, 2)
  expect(c.shared.ledger.charter).toEqual({ added: 1001, saved: 50, acted: 3 })
  expect(c.shared.dirty).toBe(true)
})

test('fail keeps a short redacted error; setOn clears the switch-off', () => {
  const c = ctxOf()
  fail(c, new Error('password=hunter2 ' + 'y'.repeat(200)))
  const h = c.shared.health.charter
  expect(h.lastErr).not.toContain('hunter2')
  expect(h.lastErr!.length).toBeLessThanOrEqual(120)
  setOff(c, 'not installed')
  expect(h).toMatchObject({ on: false, off: 'not installed' })
  setOn(c)
  expect(h).toMatchObject({ on: true, streak: 0 })
  expect(h.off).toBeUndefined()
})

test('envOff reads known module ids from COMPANY_OFF', () => {
  expect(envOff(' rtk, graph ,nope,rtk')).toEqual(['rtk', 'graph'])
  expect(envOff('')).toEqual([])
  expect(envOff(undefined)).toEqual([])
})
