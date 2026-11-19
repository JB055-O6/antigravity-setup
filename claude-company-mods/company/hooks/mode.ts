export type ModeInput = { text: string; failureOnRecord?: boolean; checkFailed?: boolean }
export type ModeDecision = { mode: 'solo' | 'full'; reasons: string[]; text: string }

const RISK_TERMS: readonly string[] = [
  'delete',
  'drop table',
  'drop database',
  'rm -rf',
  'force push',
  'force-push',
  'reset --hard',
  'migrate',
  'migration',
  'production',
  'prod',
  'deploy',
  'release',
  'payment',
  'billing',
  'credentials',
  'secret',
]

const SCOPE_TERMS: readonly string[] = [
  'build',
  'implement',
  'design',
  'architect',
  'refactor',
  'rewrite',
  'overhaul',
  'redesign',
  'from scratch',
  'entire',
  'whole',
  'end to end',
  'end-to-end',
  'system',
  'pipeline',
  'platform',
]

const UNCLEAR_PHRASES: readonly string[] = [
  'whatever you think',
  'you decide',
  'figure it out',
  "do what's best",
  'not sure what',
  'somehow',
]

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole-word/phrase match: the term must not be glued to other word characters.
function containsTerm(text: string, term: string): boolean {
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(term)}(?![A-Za-z0-9_])`, 'i')
  return re.test(text)
}

const firstMatch = (text: string, terms: readonly string[]): string | undefined =>
  terms.find((t) => containsTerm(text, t))

function countListItems(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*(?:[-*]|\d+[.)])\s/.test(line)).length
}

function countWords(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function countFiles(text: string): number {
  const seen = new Set<string>()
  for (const raw of text.split(/\s+/)) {
    const tok = raw.replace(/^[^\w./]+/, '')
    const cleaned = tok.replace(/[,;:!?)"'`\]]+$/, '')
    if (cleaned === '') continue
    if (cleaned.includes('/') || /\w\.[A-Za-z]{1,5}$/.test(cleaned)) seen.add(cleaned)
  }
  return seen.size
}

export function decideMode(input: ModeInput): ModeDecision {
  const text = input.text

  const prefix = /^\s*(!project|!solo)(?=\s|$)/i.exec(text)
  if (prefix) {
    const forced = prefix[1]!.toLowerCase()
    const rest = text.slice(prefix[0].length).replace(/^\s+/, '')
    return forced === '!project'
      ? { mode: 'full', reasons: ['client forced full process'], text: rest }
      : { mode: 'solo', reasons: ['client forced solo'], text: rest }
  }

  const reasons: string[] = []
  if (input.checkFailed === true) reasons.push('a check failed (in a bind)')
  if (input.failureOnRecord === true) reasons.push('this kind of task has a failure on record')

  const risk = firstMatch(text, RISK_TERMS)
  if (risk !== undefined) reasons.push(`irreversible or high-risk action: ${risk}`)

  const scope = firstMatch(text, SCOPE_TERMS)
  if (scope !== undefined) reasons.push(`large scope: ${scope}`)

  if (countListItems(text) >= 3) reasons.push('three or more separate requirements')
  if (countWords(text) > 120) reasons.push('long request')
  if (countFiles(text) >= 3) reasons.push('touches three or more files')

  const lower = text.toLowerCase()
  if (UNCLEAR_PHRASES.some((p) => lower.includes(p))) reasons.push('unclear request')

  if (reasons.length === 0) {
    return { mode: 'solo', reasons: ['small, clear, reversible task'], text }
  }
  return { mode: 'full', reasons, text }
}
