// Governor: on each model request, the router's effort for a routed subagent, Fable to Opus for a
// subagent, then the effort rules. The main loop's model is never changed and its effort never raised.
import type { EngineInterface, Hook, On } from 'claude-code'
import { acted, beneath, fail, isOn, note, ok, type Ctx, type Shared } from '../core'
import { governEffort, modelFamily } from '../governor'
import { showStatus } from '../host'
import { ready, save } from '../persist'
import type { Route } from '../router'

type Step = Hook<'turn.step'>

// Sessions already told that the main model is Fable.
const fableWarned = new WeakSet<Shared>()

export function registerGovernor(on: On, ctx: Ctx): void {
  on('turn.step', async function* ($, e, next) {
    // Once per load (a reload may start here); later steps read memory only.
    await ready($, ctx.shared)
    if (!isOn(ctx)) return yield* next(e)
    try { const r = yield* governStep($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

// Decision first, then bookkeeping in its own try, then the step: `next` is called and pulled
// last, so no path closes the stream before it is read.
async function* governStep($: EngineInterface, e: Parameters<Step>[1], next: Parameters<Step>[2], ctx: Ctx) {
  const st = ctx.shared
  let model: string = e.model
  let effort: typeof e.effort = e.effort
  let rerouted = false
  if (e.agentId) {
    // The router's remembered subagent effort first.
    const want = st.efforts.get(e.agentId) as Route['effort'] | undefined
    if (want && want !== e.effort) effort = want
    // Fable bills usage credits, not the Pro limits: a subagent's Fable step goes to
    // Opus max (the governor lowers it to xhigh in economy). Never the main loop.
    if (modelFamily(model) === 'fable') {
      model = 'opus'
      effort = 'max'
      rerouted = true
    }
  } else if (modelFamily(model) === 'fable' && !fableWarned.has(st)) {
    // The main loop's model is never changed (prompt cache); tell the person once.
    fableWarned.add(st)
    try {
      $.ui.toast('company: main model is Fable, which spends usage credits. /model opus stays inside Pro.')
    } catch {}
  }
  const g = governEffort(model, effort, st.economy, Boolean(e.agentId))
  if (g.changed) effort = g.effort as typeof e.effort
  const out = rerouted ? { ...e, model, effort } : effort !== e.effort ? { ...e, effort } : e

  // A throw here never undoes the decision above.
  try {
    if (rerouted) acted(ctx)
    if (g.changed) acted(ctx)
    // The count is in the ledger; the write never holds up the step.
    if (rerouted || g.changed) void save($, st)
    const run = e.agentId ? st.runs.find((r) => r.id === e.agentId) : undefined
    if (run) {
      run.steps += 1
      if (run.steps % 3 === 1) showStatus($, st)
    }
    // Log a fix once per kind, not on every step.
    const why = rerouted ? 'subagent Fable → Opus (no usage credits)' : g.changed ? g.reason : undefined
    if (why && why !== st.lastGov) {
      st.lastGov = why
      note(st, 'governor', why)
      showStatus($, st)
    }
  } catch {
    // Counting is best-effort.
  }
  return yield* next(out)
}
