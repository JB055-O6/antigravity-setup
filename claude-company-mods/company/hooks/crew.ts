// The pinned crew, registered as `company:<name>`.
export type CrewSpec = { name: string; model: string; effort: string; does: string; description: string; prompt: string; tools?: string[] }

const COMMON =
  'Work only on the task given. Verify your result before reporting (run the tests or the check that proves it). Report in at most 15 lines: what you did, the proof, and anything unresolved. Never paste large raw output; summarise it.'

export const CREW: readonly CrewSpec[] = [
  {
    name: 'scout',
    does: 'find, read, look up',
    model: 'haiku',
    effort: 'medium',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'],
    description:
      'Fast, cheap lookups: find files, search code, read and summarise files, extract facts, look things up on the web. Read-only work.',
    prompt: `You are the scout: a fast lookup agent. ${COMMON} Never change files.`,
  },
  {
    name: 'builder',
    does: 'write code, fix bugs, tests',
    model: 'sonnet',
    effort: 'medium',
    tools: undefined,
    description:
      'Multi-step coding, debugging, refactors, tests, documents and fact-complete summaries.',
    prompt: `You are the builder: you do multi-step coding, debugging, refactors, tests and documents. ${COMMON}`,
  },
  {
    name: 'reviewer',
    does: 'review code and security',
    model: 'opus',
    effort: 'max',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    description:
      'Code and security review of a change; finds bugs before they ship.',
    prompt: `You are the reviewer: you review a change for bugs and security problems before it ships. ${COMMON}`,
  },
  {
    name: 'architect',
    does: 'design, hard problems',
    model: 'opus',
    effort: 'xhigh',
    tools: undefined,
    description:
      'Architecture, design decisions, whole-program builds and hard reasoning, or work a builder failed twice.',
    prompt: `You are the architect: you make design decisions, build whole programs and solve hard problems. ${COMMON}`,
  },
  {
    name: 'sage',
    does: 'last resort, hardest problems',
    model: 'opus',
    effort: 'max',
    tools: undefined,
    description:
      'Last resort: science, long ambiguous research, costly factual questions, or problems architect could not solve.',
    prompt: `You are the sage, the last resort: you take on science, long ambiguous research and problems the others could not solve. ${COMMON}`,
  },
]
