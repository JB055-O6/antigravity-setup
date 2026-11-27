// Bash cap's pure logic: where a big output is cut, and the words about it. No `$`, no I/O.

// Sizes in chars (UTF-16 units). V11 (measure/VERIFY.md): the engine itself cuts Bash output at
// 30,000 chars, so the cap acts below that. Economy halves the three sizes. Task 18 tunes them here.
export const BASH_CAP = { over: 12_000, head: 5_000, tail: 5_000, keepLines: 40 } as const

export type CapLimits = { over: number; head: number; tail: number; keepLines: number }

const ERROR_LINE = /error|fail|exception|traceback|fatal/i
// A kept error line longer than this is cut to a window around its match.
const LINE_CHARS = 300

export function capLimits(economy: boolean): CapLimits {
  const { over, head, tail, keepLines } = BASH_CAP
  if (!economy) return { over, head, tail, keepLines }
  return { over: Math.floor(over / 2), head: Math.floor(head / 2), tail: Math.floor(tail / 2), keepLines }
}

// Over `over` chars: the first `head` chars, a marker, up to `keepLines` error lines from the cut
// middle, then the last `tail` chars. No cut splits a surrogate pair. Unchanged when the cut
// would not make the text shorter. `path` is where the whole output was saved.
export function cutOutput(
  text: string,
  o: CapLimits & { path?: string },
): { text: string; cut: boolean; originalChars: number; keptChars: number } {
  const whole = { text, cut: false, originalChars: text.length, keptChars: text.length }
  if (text.length <= o.over) return whole
  const h = edge(text, Math.min(o.head, text.length), true)
  const t = edge(text, Math.max(0, text.length - o.tail), false)
  if (h >= t) return whole
  const kept = errorLines(text, h, t, o.keepLines).map((l) => `${l}\n`).join('')
  const out = `${text.slice(0, h)}\n[company: ${kb(t - h)} KB cut. Full output: ${o.path ?? 'not saved'}]\n${kept}${text.slice(t)}`
  return out.length < text.length ? { text: out, cut: true, originalChars: text.length, keptChars: out.length } : whole
}

// The dashboard card's sentence (Task 16 draws it).
export function capCard(keptChars: number, originalChars: number, path?: string): string {
  const where = path ? `The full output is in ${path}.` : 'The full output is not in a file.'
  return `Output cap: Claude sees ${kb(keptChars)} KB of ${kb(originalChars)} KB. ${where}`
}

// `<scratchpad>/company-out`, or undefined for an absent or relative scratchpad: a relative one
// would land in the project.
export function outDir(scratchpad: unknown): string | undefined {
  if (typeof scratchpad !== 'string' || !/^(\/|[A-Za-z]:[\\/])/.test(scratchpad)) return undefined
  return `${scratchpad.replace(/[\\/]+$/, '')}/company-out`
}

// Chars as whole KB (1 KB = 1,000 chars, as the V11 limit is counted).
export function kb(chars: number): number {
  return Math.round(chars / 1000)
}

// `i` moved off the middle of a surrogate pair: back to the pair's start, or past its end.
function edge(s: string, i: number, back: boolean): number {
  const split = i > 0 && i < s.length && isLow(s.charCodeAt(i)) && isHigh(s.charCodeAt(i - 1))
  return split ? (back ? i - 1 : i + 1) : i
}

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff
}

function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff
}

// Up to `max` lines that reach into the cut middle [h, t) and match ERROR_LINE, in order.
function errorLines(text: string, h: number, t: number, max: number): string[] {
  const out: string[] = []
  let at = h > 0 ? text.lastIndexOf('\n', h - 1) + 1 : 0
  while (at < t && out.length < max) {
    let end = text.indexOf('\n', at)
    if (end === -1) end = text.length
    const line = text.slice(at, end)
    const m = ERROR_LINE.exec(line)
    if (m) out.push(windowOf(line, m.index))
    at = end + 1
  }
  return out
}

// A long line cut to LINE_CHARS around its match, `…` where text was left out.
function windowOf(line: string, at: number): string {
  if (line.length <= LINE_CHARS) return line
  const from = edge(line, Math.max(0, Math.min(at - 100, line.length - LINE_CHARS)), false)
  const to = edge(line, Math.min(line.length, from + LINE_CHARS), true)
  return `${from > 0 ? '…' : ''}${line.slice(from, to)}${to < line.length ? '…' : ''}`
}
