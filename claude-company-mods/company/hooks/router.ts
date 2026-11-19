// The model router's pure logic: no `$`, no I/O.

export type Route = {
  model: 'haiku' | 'sonnet' | 'opus' | 'fable'
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  reason: string
}

export type TaskClass = 'lookup' | 'review' | 'architecture' | 'research' | 'code'

// Names of the pinned crew (registered as `company:<name>`).
export const CREW_NAMES = ['scout', 'builder', 'reviewer', 'architect', 'sage'] as const

// Whole words and phrases, case-insensitive. Spaces in a phrase match any run
// of whitespace; the `\b` ends keep "designer" from being "design".
function words(list: readonly string[]): RegExp {
  const alt = list.map(w => w.replace(/[-]/g, '\\-').replace(/ /g, '\\s+')).join('|')
  return new RegExp(`\\b(?:${alt})\\b`, 'i')
}

const REVIEW = words([
  'review', 'audit', 'security', 'vulnerability', 'find bugs', 'code review',
  'check the diff', 'critique',
])
const ARCHITECTURE = words([
  'architecture', 'architect', 'design', 'system design', 'plan', 'planning',
  'strategy', 'tradeoff', 'trade-off', 'from scratch',
])
const RESEARCH = words([
  'research', 'investigate', 'literature', 'deep dive', 'science', 'scientific',
  'paper', 'papers', 'benchmark', 'compare options',
])
const CODE_SIGNAL = words([
  'implement', 'fix', 'refactor', 'build', 'write', 'edit', 'change', 'add',
  'debug', 'test', 'migrate',
])
const LOOKUP = words([
  'find', 'search', 'locate', 'list', 'grep', 'explore', 'read', 'summarise',
  'summarize', 'extract', 'look up', 'lookup', 'inventory', 'where is',
  'which files', 'count',
])

// review > architecture > research > code-signal words > lookup > code.
export function classifyTask(text: string): TaskClass {
  if (REVIEW.test(text)) return 'review'
  if (ARCHITECTURE.test(text)) return 'architecture'
  if (RESEARCH.test(text)) return 'research'
  if (CODE_SIGNAL.test(text)) return 'code'
  if (LOOKUP.test(text)) return 'lookup'
  return 'code'
}

export function suggestedAgent(
  cls: TaskClass,
): 'scout' | 'builder' | 'reviewer' | 'architect' | 'sage' {
  switch (cls) {
    case 'lookup':
      return 'scout'
    case 'code':
      return 'builder'
    case 'review':
      return 'reviewer'
    case 'architecture':
      return 'architect'
    case 'research':
      return 'sage'
  }
}

export function routeSpawn(i: {
  subagentType: string
  model?: string
  description: string
  prompt: string
  providerIsEngine: boolean
}): Route | null {
  if (i.model !== undefined && i.model !== '') return null
  if (i.subagentType === 'fork') return null
  if (!i.providerIsEngine) return null
  const bare = i.subagentType.replace(/^company:/, '')
  if ((CREW_NAMES as readonly string[]).includes(bare)) return null

  if (i.subagentType === 'Explore') {
    return { model: 'haiku', effort: 'medium', reason: 'Explore is read-only search' }
  }
  const cls = classifyTask(i.description.concat(' ', i.prompt))
  switch (cls) {
    case 'lookup':
      return { model: 'haiku', effort: 'medium', reason: 'lookup task' }
    case 'code':
      return { model: 'sonnet', effort: 'medium', reason: 'code task' }
    case 'review':
      return { model: 'opus', effort: 'max', reason: 'review task' }
    case 'architecture':
      return { model: 'opus', effort: 'xhigh', reason: 'architecture task' }
    case 'research':
      return { model: 'opus', effort: 'max', reason: 'research task (Fable needs usage credits; Opus max is in Pro)' }
  }
}
