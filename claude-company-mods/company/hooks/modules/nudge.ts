// Nudge: one toast when the main conversation's context passes 60% of its window.
// Every request sends the whole context again: /compact makes each later request smaller.
import type { EngineInterface, Hook, On } from 'claude-code'
import { acted, beneath, fail, isOn, ok, type Ctx, type Shared } from '../core'
import { ready, save } from '../persist'

type Complete = Hook<'turn.complete'>
type Compact = Hook<'session.compact'>

const AT = 60
const REARM = 50
// Sessions that got the toast for this crossing; a fill under REARM or a compaction clears it.
const nudged = new WeakSet<Shared>()

export function registerNudge(on: On, ctx: Ctx): void {
  on('turn.complete', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await nudgeComplete($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('session.compact', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await nudgeCompact(e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

async function nudgeComplete($: EngineInterface, e: Parameters<Complete>[1], next: Parameters<Complete>[2], ctx: Ctx) {
  const r = await next(e)
  // A subagent has its own context; the person compacts only the main one.
  if (e.agentId !== undefined) return r
  let percent: number | undefined
  try {
    const c = (await $.session.usage()).context
    // No window, or no response yet in this window: no fill to read (expected, not a fault).
    if ((c?.window ?? 0) > 0) percent = c.percent
  } catch {
    // No reading: the next turn brings one.
  }
  if (typeof percent !== 'number') return r
  const st = ctx.shared
  if (percent < REARM) nudged.delete(st)
  else if (percent >= AT && !nudged.has(st)) {
    nudged.add(st)
    try {
      $.ui.toast(`Context is ${percent} % full. Type /compact to make it smaller.`)
    } catch {
      // A toast failing changes nothing.
    }
    acted(ctx)
    void save($, st)
  }
  return r
}

// A compaction of the main conversation that stands makes the context small: the next crossing toasts.
async function nudgeCompact(e: Parameters<Compact>[1], next: Parameters<Compact>[2], ctx: Ctx) {
  const r = await next(e)
  if (e.agentId === undefined && e.trigger !== 'precompute' && r.skip === undefined) nudged.delete(ctx.shared)
  return r
}
