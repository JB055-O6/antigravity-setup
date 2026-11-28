import { expect, test } from 'claude-code/testing'
import { governEffort, meterLine, nextEconomy, readWindows } from './governor'

const FULL: Record<string, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-4-7',
  fable: 'Claude-Fable-1',
}
const spellings = (fam: string) => [fam, FULL[fam]!, fam.toUpperCase()]

// [family, effort, economy, expected effort, changed]
const TABLE: Array<[string, string, boolean, string, boolean]> = [
  ['sonnet', 'xhigh', false, 'high', true],
  ['sonnet', 'max', false, 'high', true],
  ['sonnet', 'high', false, 'high', false],
  ['sonnet', 'medium', false, 'medium', false],
  ['opus', 'low', false, 'medium', true],
  ['opus', 'medium', false, 'medium', false],
  ['opus', 'high', false, 'high', false],
  ['opus', 'xhigh', false, 'xhigh', false],
  ['opus', 'max', false, 'max', false],
  ['fable', 'xhigh', false, 'high', true],
  ['fable', 'high', false, 'high', false],
  ['fable', 'max', false, 'max', false],
  ['haiku', 'max', false, 'max', false],
  ['haiku', 'low', false, 'low', false],
  // economy
  ['haiku', 'max', true, 'xhigh', true],
  ['opus', 'max', true, 'xhigh', true],
  ['fable', 'max', true, 'high', true],
  ['sonnet', 'max', true, 'high', true],
  ['sonnet', 'xhigh', true, 'high', true],
  ['opus', 'xhigh', true, 'xhigh', false],
  ['opus', 'low', true, 'medium', true],
  ['fable', 'xhigh', true, 'high', true],
  ['haiku', 'high', true, 'high', false],
]

for (const [fam, eff, eco, want, changed] of TABLE) {
  for (const model of spellings(fam)) {
    test(`${model} ${eff} economy=${eco} -> ${want}`, () => {
      const r = governEffort(model, eff, eco)
      expect(r.effort).toBe(want)
      expect(r.changed).toBe(changed)
      expect(r.reason !== '').toBe(changed)
    })
  }
}

test('numbers and undefined pass unchanged', () => {
  for (const m of ['sonnet', 'opus', 'fable', 'haiku', 'claude-sonnet-5-5']) {
    for (const eco of [false, true]) {
      expect(governEffort(m, 32000, eco)).toMatchObject({ effort: 32000, changed: false })
      expect(governEffort(m, undefined, eco)).toMatchObject({ effort: undefined, changed: false })
    }
  }
})

test('unknown model: only the economy max rule applies', () => {
  expect(governEffort('mystery', 'max', false)).toMatchObject({ effort: 'max', changed: false })
  expect(governEffort('mystery', 'max', true)).toMatchObject({ effort: 'xhigh', changed: true })
  expect(governEffort('mystery', 'low', true)).toMatchObject({ effort: 'low', changed: false })
})

test('hysteresis', () => {
  expect(nextEconomy(false, { fiveHour: 74.9, week: 74.9 })).toBe(false)
  expect(nextEconomy(false, { fiveHour: 75 })).toBe(true)
  expect(nextEconomy(false, { week: 75 })).toBe(true)
  expect(nextEconomy(true, { fiveHour: 72, week: 50 })).toBe(true)
  expect(nextEconomy(true, { fiveHour: 10, week: 70 })).toBe(true)
  expect(nextEconomy(true, { fiveHour: 69.9, week: 69.9 })).toBe(false)
  expect(nextEconomy(true, {})).toBe(false)
})

test('windows and status line', () => {
  const w = readWindows([
    { kind: 'five_hour', percentUsed: 23.5 },
    { kind: 'seven_day', percentUsed: 7 },
    { kind: 'spend_limit', percentUsed: 99 },
  ])
  expect(w).toEqual({ fiveHour: 23.5, week: 7 })
  expect(meterLine({ economy: false, windows: w, routed: 3, governed: 2 })).toBe(
    'company · 5h 24% · week 7% · 3 subagents routed · 2 efforts governed',
  )
  expect(meterLine({ economy: true, windows: { fiveHour: 91, week: 10 }, routed: 0, governed: 0 })).toBe(
    'ECONOMY · company · 5h 91% · week 10% · 0 subagents routed · 0 efforts governed',
  )
  expect(meterLine({ economy: false, windows: {}, routed: 1, governed: 4 })).toBe(
    'company · 1 subagents routed · 4 efforts governed',
  )
  expect(readWindows(undefined)).toEqual({})
})
