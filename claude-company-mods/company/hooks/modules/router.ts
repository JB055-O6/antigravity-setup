// Router + crew: registers the five crew agents, sends each subagent to the cheapest model that
// fits its task, and follows each run until it ends. With a device attached to a session off the
// person's machine, router and crew step aside for the session: the engine refuses device calls
// by an agent a mod spawned, retyped or registered.
import type { EngineInterface, Hook, MatchedHook, On } from 'claude-code'
import type { CrewRun } from '../../types'
import { CREW } from '../crew'
import { acted, beneath, fail, isOn, note, noteOf, offMachineWithDevice, ok, setOff, type Ctx } from '../core'
import { modelFamily } from '../governor'
import { showStatus } from '../host'
import { countRoute, ready, save } from '../persist'
import { CREW_NAMES, routeSpawn, type Route } from '../router'

type Start = MatchedHook<'session.start', {}>
type Attach = MatchedHook<'session.attach', {}>
type End = MatchedHook<'session.end', {}>
type Spawn = Hook<'agent.spawn'>
type AgentCall = MatchedHook<'tool.call', { readonly tool: 'Agent' }>
type Report = Hook<'agent.report'>

export function registerRouter(on: On, ctx: Ctx): void {
  on('session.start', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await routerStart($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('session.attach', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await routerAttach($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('agent.spawn', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await routerSpawn($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await routerCall($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('agent.report', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await routerReport($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  // No wait for restore: the whole session.end chain has 1.5 s.
  on('session.end', {}, async ($, e, next) => {
    if (!isOn(ctx)) return next(e)
    try { const r = await routerEnd($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  // Not a guard: this hook acts only while the router is off for a device. It hides the crew
  // that was registered before the device came.
  on('agent.offer', async ($, e, next) => {
    await ready($, ctx.shared)
    if (ctx.shared.health[ctx.id].off === 'device attached' && CREW_NAMES.some((n) => e.agent === `company:${n}`)) return { isOffered: false }
    return next(e)
  })
}

// The five crew agents as `company:<name>`; none while the router is off. Also run by /company.
export async function registerCrew($: EngineInterface, ctx: Ctx): Promise<void> {
  if (!isOn(ctx)) return
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
  ctx.shared.crew = crew
}

// The host has read where the session runs; off the machine with a device, step aside.
function stepAside($: EngineInterface, ctx: Ctx): void {
  if (!offMachineWithDevice(ctx.shared)) return
  setOff(ctx, 'device attached')
  ctx.shared.crew = 0
  noteOf(ctx, 'off: device attached')
  void save($, ctx.shared)
  showStatus($, ctx.shared)
}

async function routerStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], ctx: Ctx) {
  stepAside($, ctx)
  await registerCrew($, ctx)
  return next(e)
}

async function routerAttach($: EngineInterface, e: Parameters<Attach>[1], next: Parameters<Attach>[2], ctx: Ctx) {
  stepAside($, ctx)
  return next(e)
}

async function routerSpawn($: EngineInterface, e: Parameters<Spawn>[1], next: Parameters<Spawn>[2], ctx: Ctx) {
  const st = ctx.shared
  // The decision. A throw here is the router's own fault: the spawn goes on unrouted and keeps
  // the diet block beneath; the fault is thrown after the spawn, so the guard counts it.
  let route: Route | null = null
  let fault: { err: unknown } | undefined
  try {
    route =
      e.isTeammate || e.resume || e.workflow
        ? null
        : routeSpawn({
            subagentType: e.fork ? 'fork' : e.subagentType,
            model: e.model,
            description: e.description,
            prompt: e.prompt,
            providerIsEngine: e.provider.plugin === 'engine',
          })
  } catch (err) {
    fault = { err }
  }
  const result = await next(route ? { ...e, model: route.model } : e)

  try {
    if (!result.deny && result.agentId) {
      // Every subagent shows in the crew block, routed or not.
      st.runs = [
        ...st.runs,
        {
          id: result.agentId,
          type: e.subagentType ?? (e.fork ? 'fork' : 'subagent'),
          model: route?.model ?? (modelFamily(result.model) ?? result.model),
          effort: route?.effort ?? 'default',
          task: (e.description ?? '').slice(0, 80),
          steps: 0,
          status: (e.background ? 'background' : 'running') as CrewRun['status'],
        },
      ].slice(-8)
      st.runByTool.set(e.tool_use_id, result.agentId)
    }
  } catch {
    // Bookkeeping must never disturb the spawn.
  }
  try {
    if (!result.deny) {
      if (route) {
        if (result.agentId) st.efforts.set(result.agentId, route.effort)
        // In memory, so parallel spawns each count; the store write never holds up the spawn.
        countRoute(st, route.model)
        acted(ctx)
        void save($, st)
        note(st, 'route', `${e.subagentType ?? 'subagent'} → ${route.model} ${route.effort} (${route.reason})`)
      }
      // One status per spawn, after the route and the diet beneath have counted.
      showStatus($, st)
    }
  } catch {
    // Bookkeeping must never disturb the spawn.
  }
  if (fault) throw fault.err
  return result
}

// A foreground run ends when its Agent call returns; a background run's call answers at once.
async function routerCall($: EngineInterface, e: Parameters<AgentCall>[1], next: Parameters<AgentCall>[2], ctx: Ctx) {
  const st = ctx.shared
  const result = await next(e)
  try {
    const id = st.runByTool.get(e.tool_use_id)
    const run = id ? st.runs.find((r) => r.id === id) : undefined
    if (run && run.status === 'running') {
      run.status = result.isError || result.deny !== undefined ? 'failed' : 'done'
      note(st, 'crew', `${run.type} ${run.status}: ${run.task}`)
      showStatus($, st)
    }
  } catch {
    // Bookkeeping only.
  }
  return result
}

// A background run ends with its report.
async function routerReport($: EngineInterface, e: Parameters<Report>[1], next: Parameters<Report>[2], ctx: Ctx) {
  const st = ctx.shared
  try {
    const run = st.runs.find((r) => r.id === e.agentId)
    if (run && run.status === 'background') {
      run.status = e.status === 'completed' ? 'done' : e.status === 'failed' ? 'failed' : 'ended'
      note(st, 'crew', `${run.type} ${run.status}: ${run.task}`)
      showStatus($, st)
    }
  } catch {
    // Bookkeeping only.
  }
  return next(e)
}

// A background run with no report yet shows as ended, not as still going.
async function routerEnd($: EngineInterface, e: Parameters<End>[1], next: Parameters<End>[2], ctx: Ctx) {
  const st = ctx.shared
  try {
    const open = st.runs.filter((r) => r.status === 'background')
    for (const run of open) {
      run.status = 'ended'
      note(st, 'crew', `${run.type} ended: ${run.task}`)
    }
    if (open.length) showStatus($, st)
  } catch {
    // Bookkeeping only.
  }
  return next(e)
}
