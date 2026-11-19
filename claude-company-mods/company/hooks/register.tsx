import type { Register } from 'claude-code'
import { CHARTER } from './charter'
import { routeSpawn, type Route } from './router'

const COMMON =
  'Work only on the task given. Verify your result before reporting (run the tests or the check that proves it). Report in at most 15 lines: what you did, the proof, and anything unresolved. Never paste large raw output; summarise it.'

const CREW = [
  {
    name: 'scout',
    model: 'haiku',
    effort: 'medium',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch'],
    description:
      'Fast, cheap lookups: find files, search code, read and summarise files, extract facts, look things up on the web. Read-only work.',
    prompt: `You are the scout: a fast lookup agent. ${COMMON} Never change files.`,
  },
  {
    name: 'builder',
    model: 'sonnet',
    effort: 'medium',
    tools: undefined,
    description:
      'Multi-step coding, debugging, refactors, tests, documents and fact-complete summaries.',
    prompt: `You are the builder: you do multi-step coding, debugging, refactors, tests and documents. ${COMMON}`,
  },
  {
    name: 'reviewer',
    model: 'opus',
    effort: 'max',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    description:
      'Code and security review of a change; finds bugs before they ship.',
    prompt: `You are the reviewer: you review a change for bugs and security problems before it ships. ${COMMON}`,
  },
  {
    name: 'architect',
    model: 'opus',
    effort: 'xhigh',
    tools: undefined,
    description:
      'Architecture, design decisions, whole-program builds and hard reasoning, or work a builder failed twice.',
    prompt: `You are the architect: you make design decisions, build whole programs and solve hard problems. ${COMMON}`,
  },
  {
    name: 'sage',
    model: 'fable',
    effort: 'high',
    tools: undefined,
    description:
      'Last resort: science, long ambiguous research, costly factual questions, or problems architect could not solve.',
    prompt: `You are the sage, the last resort: you take on science, long ambiguous research and problems the others could not solve. ${COMMON}`,
  },
] as const

export const register: Register = (on, options) => {
  // Effort remembered per routed subagent, by the agentId the spawn resolves with.
  const efforts = new Map<string, Route['effort']>()
  let routedThisSession = 0

  on('session.start', async ($, e, next) => {
    for (const a of CREW) {
      try {
        await $.agent.register({
          name: a.name,
          description: a.description,
          prompt: a.prompt,
          model: a.model,
          effort: a.effort,
          ...(a.tools ? { tools: a.tools } : {}),
        })
      } catch {
        // One agent failing to register must not stop the others or the session.
      }
    }
    $.ui.status('company: charter loaded')
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // Not a guard: if anything here throws, the spawn goes ahead unchanged.
    let route: Route | null = null
    try {
      const skip = e.isTeammate || e.resume || e.workflow
      route = skip
        ? null
        : routeSpawn({
            subagentType: e.fork ? 'fork' : e.subagentType,
            model: e.model,
            description: e.description,
            prompt: e.prompt,
            providerIsEngine: e.provider.plugin === 'engine',
          })
    } catch {
      return next(e)
    }
    if (!route) return next(e)

    const result = await next({ ...e, model: route.model })

    try {
      if (!result.deny) {
        if (result.agentId) efforts.set(result.agentId, route.effort)
        routedThisSession += 1
        let total = routedThisSession
        try {
          const old = (await $.store.get('routes')) as
            | Record<string, number>
            | undefined
          const t = {
            haiku: 0,
            sonnet: 0,
            opus: 0,
            fable: 0,
            since: await $.clock.now(),
            ...(old && typeof old === 'object' ? old : {}),
          }
          t[route.model] = (Number(t[route.model]) || 0) + 1
          total = t.haiku + t.sonnet + t.opus + t.fable
          await $.store.set('routes', t)
        } catch {
          // The tally is best-effort.
        }
        $.ui.status(`company: router on · ${total} subagents routed`)
      }
    } catch {
      // Bookkeeping must never disturb the spawn.
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    // Only a subagent step with a remembered, different effort is changed.
    let effort: Route['effort'] | undefined
    try {
      if (e.agentId) {
        const want = efforts.get(e.agentId)
        if (want && want !== e.effort) effort = want
      }
    } catch {
      effort = undefined
    }
    return yield* next(effort ? { ...e, effort } : e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    try {
      return {
        sections: [
          ...result.sections,
          { id: 'company:charter', text: CHARTER, scope: 'session' as const },
        ],
      }
    } catch {
      // Not a guard: never block the prompt over the charter.
      return result
    }
  })
}
