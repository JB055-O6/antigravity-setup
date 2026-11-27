import { expect, test } from 'claude-code/testing'
import { BASH_CAP, capCard, capLimits, cutOutput, outDir } from './bashcut'

const PATH = '/sp/company-out/t1.txt'
const CAP = { ...BASH_CAP, path: PATH }
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

// Numbered lines, so any two parts of the text differ.
function lines(chars: number, from = 0): string {
  let s = ''
  for (let i = from; s.length < chars; i++) s += `line ${String(i).padStart(6, '0')} ok\n`
  return s.slice(0, chars)
}

test('golden: 40 KB keeps the head, the tail, the error line and the marker', () => {
  // 1333 whole lines of 15 chars, then the error line, then more lines.
  const text = lines(19_995) + 'Error: boom\n' + lines(40_000 - 19_995 - 12, 5000)
  expect(text.length).toBe(40_000)
  const c = cutOutput(text, CAP)
  const marker = `\n[company: 30 KB cut. Full output: ${PATH}]\n`
  expect(c.text).toBe(text.slice(0, 5000) + marker + 'Error: boom\n' + text.slice(-5000))
  expect(c).toMatchObject({ cut: true, originalChars: 40_000, keptChars: c.text.length })
})

test('30,001 chars just over a 30,000 threshold: head and tail do not overlap', () => {
  const text = lines(30_001)
  const c = cutOutput(text, { over: 30_000, head: 12_000, tail: 12_000, keepLines: 40, path: PATH })
  expect(c.text).toBe(text.slice(0, 12_000) + `\n[company: 6 KB cut. Full output: ${PATH}]\n` + text.slice(-12_000))
  // The active threshold, one char over.
  const d = cutOutput(lines(BASH_CAP.over + 1), CAP)
  expect(d.text.startsWith(lines(BASH_CAP.over + 1).slice(0, 5000))).toBe(true)
  expect(d.text.endsWith(lines(BASH_CAP.over + 1).slice(-5000))).toBe(true)
  expect(d.keptChars).toBeLessThan(d.originalChars)
})

test('head and tail that would cover the whole text leave it unchanged', () => {
  const text = lines(150)
  expect(cutOutput(text, { over: 100, head: 80, tail: 80, keepLines: 40 })).toEqual({ text, cut: false, originalChars: 150, keptChars: 150 })
})

test('a surrogate pair at a cut point stays whole', () => {
  const pair = '\u{1F600}'
  // A pair across the head's end (4999-5000) and one across the tail's start.
  const text = 'a'.repeat(4999) + pair + 'b'.repeat(10_000) + pair + 'c'.repeat(4999)
  const c = cutOutput(text, CAP)
  expect(c.cut).toBe(true)
  expect(LONE.test(c.text)).toBe(false)
  expect(c.text.startsWith('a'.repeat(4999) + '\n[company:')).toBe(true)
  expect(c.text.endsWith(']\n' + 'c'.repeat(4999))).toBe(true)
  // A long error line is cut to a window; its edges keep pairs whole too.
  const long = pair.repeat(400) + ' fatal: disk ' + pair.repeat(400)
  const d = cutOutput(lines(8000) + long + '\n' + lines(8000, 9000), CAP)
  expect(d.text).toContain('fatal: disk')
  expect(LONE.test(d.text)).toBe(false)
})

test('a huge single line with an error word is still cut', () => {
  const text = 'x'.repeat(10_000) + ' error ' + 'y'.repeat(10_000)
  const c = cutOutput(text, CAP)
  expect(c.cut).toBe(true)
  expect(c.text).toContain(' error ')
  expect(c.keptChars).toBeLessThan(11_000)
})

test('at most keepLines error lines are kept, any case of each word', () => {
  const words = ['ERROR', 'Failed', 'Exception', 'Traceback', 'FATAL']
  const bad = Array.from({ length: 50 }, (_, i) => `${words[i % 5]} ${i}`).join('\n')
  const c = cutOutput(lines(6000) + bad + '\n' + lines(6000, 9000), CAP)
  const kept = c.text.split('\n').filter((l) => /^(ERROR|Failed|Exception|Traceback|FATAL) \d+$/.test(l))
  expect(kept).toEqual(bad.split('\n').slice(0, 40))
})

test('no path: the marker says not saved', () => {
  const c = cutOutput(lines(20_000), BASH_CAP)
  expect(c.text).toContain('\n[company: 10 KB cut. Full output: not saved]\n')
})

test('output at the threshold passes unchanged', () => {
  const text = lines(BASH_CAP.over)
  expect(cutOutput(text, CAP)).toEqual({ text, cut: false, originalChars: BASH_CAP.over, keptChars: BASH_CAP.over })
})

test('economy halves the limits', () => {
  expect(capLimits(false)).toEqual(BASH_CAP)
  expect(capLimits(true)).toEqual({ over: 6000, head: 2500, tail: 2500, keepLines: 40 })
})

test('the card says what Claude sees and where the full output is', () => {
  expect(capCard(24_300, 410_000, '/sp/company-out/t1.txt')).toBe('Output cap: Claude sees 24 KB of 410 KB. The full output is in /sp/company-out/t1.txt.')
  expect(capCard(10_100, 20_000)).toBe('Output cap: Claude sees 10 KB of 20 KB. The full output is not in a file.')
})

test('outputs go only under an absolute scratchpad', () => {
  expect(outDir('/tmp/s/scratchpad')).toBe('/tmp/s/scratchpad/company-out')
  expect(outDir('/tmp/s/scratchpad/')).toBe('/tmp/s/scratchpad/company-out')
  expect(outDir('C:\\Users\\a\\scratchpad')).toBe('C:\\Users\\a\\scratchpad/company-out')
  expect(outDir('scratchpad')).toBeUndefined()
  expect(outDir('')).toBeUndefined()
  expect(outDir(undefined)).toBeUndefined()
})
