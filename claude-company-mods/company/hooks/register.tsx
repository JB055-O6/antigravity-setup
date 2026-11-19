import type { EngineInterface, Register } from 'claude-code'
import { CHARTER } from './charter'
import { routeSpawn, type Route } from './router'
import {
  governEffort,
  meterLine,
  modelFamily,
  nextEconomy,
  readWindows,
  recordGoverned,
  governedTotal,
  type Windows,
} from './governor'

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

type MeterState = {
  windows: Windows
  economy: boolean
  economySince?: number
  routedTotal: number
}

function showStatus($: EngineInterface, st: MeterState) {
  try {
    $.ui.status(
      meterLine({
        economy: st.economy,
        windows: st.windows,
        routed: st.routedTotal,
        governed: governedTotal(),
      }),
    )
  } catch {
    // The line is best-effort.
  }
}

// Apply one reading of the rate-limit windows. Best-effort: never throws.
async function applyLimits(
  $: EngineInterface,
  st: MeterState,
  limits: Parameters<typeof readWindows>[0],
) {
  try {
    const w = readWindows(limits)
    const was = st.economy
    st.windows = w
    st.economy = nextEconomy(was, w)
    if (st.economy !== was) {
      try {
        if (st.economy) {
          const five = w.fiveHour ?? 0
          $.ui.toast(
            five >= 90
              ? `Economy mode on: five-hour window at ${Math.round(five)}%`
              : `Economy mode on: weekly window at ${Math.round(w.week ?? 0)}%`,
          )
        } else {
          $.ui.toast(
            `Economy mode off: five-hour window at ${Math.round(w.fiveHour ?? 0)}%, weekly at ${Math.round(w.week ?? 0)}%`,
          )
        }
      } catch {
        // A toast failing changes nothing.
      }
    }
    try {
      if (st.economy && !was) st.economySince = Number(await $.clock.now())
      if (!st.economy) st.economySince = undefined
      await $.store.set('meter', {
        ...(st.economySince !== undefined ? { economySince: st.economySince } : {}),
        ...(w.fiveHour !== undefined ? { lastFiveHour: w.fiveHour } : {}),
        ...(w.week !== undefined ? { lastWeek: w.week } : {}),
      })
    } catch {
      // Persisting is best-effort.
    }
  } catch {
    // Leave the previous values.
  }
  showStatus($, st)
}

export const register: Register = (on, options) => {
  // Effort remembered per routed subagent, by the agentId the spawn resolves with.
  const efforts = new Map<string, Route['effort']>()
  let routedThisSession = 0
  let routedTotal = 0
  // Limit meter state; `st.economy` is read synchronously by turn.step.
  const st: MeterState = { windows: {}, economy: false, routedTotal: 0 }

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
    try {
      await applyLimits($, st, (await $.session.usage()).rateLimits)
    } catch {
      showStatus($, st)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // Pushed figures: refresh from them. Never blocks.
    try {
      await applyLimits($, st, e.rateLimits)
    } catch {
      // Keep the previous values.
    }
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
        st.routedTotal = total
        showStatus($, st)
      }
    } catch {
      // Bookkeeping must never disturb the spawn.
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    // Not a guard: on any error the step goes down unchanged.
    let out = e
    try {
      let model: string = e.model
      let effort: typeof e.effort = e.effort
      let rerouted = false
      if (e.agentId) {
        // The router's remembered subagent effort first.
        const want = efforts.get(e.agentId)
        if (want && want !== e.effort) effort = want
        // Economy: a subagent's Fable step goes to Opus at xhigh (never the main loop).
        if (st.economy && modelFamily(model) === 'fable') {
          model = 'opus'
          effort = 'xhigh'
          rerouted = true
          recordGoverned('economy: subagent fable -> opus xhigh')
        }
      }
      const g = governEffort(model, effort, st.economy)
      if (g.changed) {
        effort = g.effort as typeof e.effort
        recordGoverned(g.reason)
      }
      if (rerouted) out = { ...e, model, effort }
      else if (effort !== e.effort) out = { ...e, effort }
    } catch {
      out = e
    }
    return yield* next(out)
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
