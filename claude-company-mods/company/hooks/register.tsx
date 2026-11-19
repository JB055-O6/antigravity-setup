import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Panel } from '../types'
import { EMPTY_PANEL, PANE_ID, PanelView } from './panel'
import { CHARTER } from './charter'
import { directiveState, directivesNote } from './directives'
import { GREP_LINES, READ_LINES, dietPrompt, dietTotal, readNote, recordDiet, shouldCapRead } from './diet'
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
    model: 'opus',
    effort: 'max',
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
  directives?: string
  dirs: { name: string; on: boolean }[]
  crew: number
  version: string
  log: Panel['log']
  seq: number
  lastGov?: string
}

// Change the tag when Panel's fields change: it declines what an older version stored.
const panel = atom({ plugin: 'company', key: 'panel' } as const, EMPTY_PANEL, { shape: 'panel-1' })

// One line in the pane's activity list (last 12 kept).
function note(st: MeterState, kind: string, text: string) {
  st.seq += 1
  st.log = [...st.log, { n: st.seq, kind, text }].slice(-12)
}

function showStatus($: EngineInterface, st: MeterState) {
  try {
    $.ui.status(
      meterLine({
        economy: st.economy,
        windows: st.windows,
        routed: st.routedTotal,
        governed: governedTotal(),
        diet: dietTotal(),
      }) + (st.directives ? ` · ${st.directives}` : ''),
    )
  } catch {
    // The line is best-effort.
  }
  // The pane redraws from this snapshot.
  void update($, panel, () => ({
    version: st.version,
    crew: st.crew,
    crewTotal: CREW.length,
    directives: st.dirs,
    ...(st.windows.fiveHour !== undefined ? { fiveHour: st.windows.fiveHour } : {}),
    ...(st.windows.week !== undefined ? { week: st.windows.week } : {}),
    economy: st.economy,
    routed: st.routedTotal,
    governed: governedTotal(),
    diet: dietTotal(),
    log: st.log,
  })).catch(() => {})
}

// Everything a session needs, run at start and again by /company in a live session.
async function boot($: EngineInterface, st: MeterState): Promise<number> {
  let crew = 0
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
      crew++
    } catch {
      // One agent failing to register must not stop the others or the session.
    }
  }
  st.crew = crew
  let enabled: unknown
  let loaded: string[] = []
  try {
    enabled = await $.settings.read({ key: 'enabledPlugins' })
  } catch {
    // Unknown: the command list below may still tell.
  }
  try {
    loaded = (await $.command.list()).map((c) => c.plugin ?? (c.name.includes(':') ? (c.name.split(':')[0] ?? '') : '')).filter(Boolean)
  } catch {
    // Unknown: settings alone decide.
  }
  // Both reads failed: unknown, so show nothing rather than a false "0/4".
  if (enabled !== undefined || loaded.length) {
    st.dirs = directiveState(enabled, loaded)
    st.directives = directivesNote(enabled, loaded)
  }
  try {
    const v = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }
    if (typeof v.version === 'string') st.version = v.version
  } catch {
    // The version is only shown.
  }
  note(st, 'start', `company ${st.version} on: charter, router, governor, meter, diet, crew ${crew}/${CREW.length}, ${st.directives}`)
  try {
    await applyLimits($, st, (await $.session.usage()).rateLimits)
  } catch {
    showStatus($, st)
  }
  return crew
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
      note(st, 'meter', st.economy ? `economy ON at 5h ${Math.round(w.fiveHour ?? 0)}% · week ${Math.round(w.week ?? 0)}%` : 'economy off')
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
  let fableWarned = false
  // Limit meter state; `st.economy` is read synchronously by turn.step.
  const st: MeterState = { windows: {}, economy: false, routedTotal: 0, dirs: [], crew: 0, version: '', log: [], seq: 0 }

  on('session.start', async ($, e, next) => {
    await boot($, st)
    // The live pane opens by itself on the desktop app; /company opens it anywhere.
    if (e.surface === 'desktop') void $.ui.open({ id: PANE_ID, title: 'Company' }).catch(() => {})
    try {
      await $.command.register({
        name: 'company',
        description: 'Start or re-check the company mod in this session and show what is on',
        immediate: true,
      })
    } catch {
      // The command is a convenience; the mod works without it.
    }
    return next(e)
  })

  on('command.run', { command: 'company' }, async ($) => {
    const crew = await boot($, st)
    showStatus($, st)
    void $.ui.open({ id: PANE_ID, title: 'Company' }).catch(() => {})
    const w = st.windows
    const limits = w.fiveHour === undefined && w.week === undefined ? 'limits: no data' : `5h ${w.fiveHour ?? '?'}% · week ${w.week ?? '?'}%`
    return {
      text: [
        `company on: charter, router, governor, meter, diet.`,
        `crew ${crew}/${CREW.length} registered · ${st.directives ?? 'directives: unknown'}`,
        `${limits} · economy ${st.economy ? 'ON' : 'off'} · ${st.routedTotal} subagents routed · ${governedTotal()} efforts governed · ${dietTotal()} diet`,
      ].join('\n'),
    }
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
    let prompt: string | null = null
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
      // The compact-report block: not for forks, teammates, resumes or workflow agents.
      prompt = skip || e.fork ? null : dietPrompt(e.prompt)
    } catch {
      return next(e)
    }
    if (!route && prompt === null) return next(e)

    const result = await next({
      ...e,
      ...(route ? { model: route.model } : {}),
      ...(prompt !== null ? { prompt } : {}),
    })

    try {
      if (!result.deny) {
        if (prompt !== null) {
          recordDiet('report')
          note(st, 'diet', 'subagent told to report in 25 lines or less')
          if (!route) showStatus($, st)
        }
        if (route) {
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
          note(st, 'route', `${e.subagentType ?? 'subagent'} → ${route.model} ${route.effort} (${route.reason})`)
          showStatus($, st)
        }
      }
    } catch {
      // Bookkeeping must never disturb the spawn.
    }
    return result
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    // Not a guard: never denies; on any error the call goes down untouched.
    let size: number | undefined
    try {
      if (!e.agentId && e.offset == null && e.limit == null && e.pages == null) {
        const stat = await $.fs.stat(e.file_path)
        if (stat.kind === 'file' && shouldCapRead(e.file_path, stat.size)) size = stat.size
      }
    } catch {
      size = undefined
    }
    if (size === undefined) return next(e)
    const result = await next({ ...e, limit: READ_LINES })
    try {
      if (result.deny !== undefined || result.isError) return result
      recordDiet('read')
      note(st, 'diet', `big file read capped at ${READ_LINES} lines (${Math.round(size / 1024)} KB)`)
      showStatus($, st)
      return { ...result, context: [...(result.context ?? []), readNote(size)] }
    } catch {
      return result
    }
  })

  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    // Not a guard: never denies.
    if (e.agentId || e.output_mode !== 'content' || e.head_limit != null) return next(e)
    const result = await next({ ...e, head_limit: GREP_LINES })
    try {
      if (result.deny === undefined && !result.isError) {
        recordDiet('grep')
        note(st, 'diet', `search output capped at ${GREP_LINES} lines`)
        showStatus($, st)
      }
    } catch {
      // Counting is best-effort.
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
        // Fable bills usage credits, not the Pro limits: a subagent's Fable step goes to
        // Opus max (the governor lowers it to xhigh in economy). Never the main loop.
        if (modelFamily(model) === 'fable') {
          model = 'opus'
          effort = 'max'
          rerouted = true
          recordGoverned('subagent fable -> opus max (no credits)')
        }
      } else if (modelFamily(model) === 'fable' && !fableWarned) {
        // The main loop's model is never changed (prompt cache); tell the person once.
        fableWarned = true
        try {
          $.ui.toast('company: main model is Fable, which spends usage credits. /model opus stays inside Pro.')
        } catch {}
      }
      const g = governEffort(model, effort, st.economy)
      if (g.changed) {
        effort = g.effort as typeof e.effort
        recordGoverned(g.reason)
      }
      if (rerouted) out = { ...e, model, effort }
      else if (effort !== e.effort) out = { ...e, effort }
      // Log a fix once per kind, not on every step.
      const why = rerouted ? 'subagent Fable → Opus (no usage credits)' : g.changed ? g.reason : undefined
      if (why && why !== st.lastGov) {
        st.lastGov = why
        note(st, 'governor', why)
        showStatus($, st)
      }
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

  on('ui.render', { component: 'Pane', requestId: 'company' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const p = await read($, panel)
    return PanelView(ui, p, Math.max(3, (e.viewport?.rows ?? 30) - 12))
  })
}
