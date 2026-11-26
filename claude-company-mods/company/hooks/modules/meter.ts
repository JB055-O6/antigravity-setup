// Meter: reads the five-hour and weekly windows and turns economy mode on and off.
import type { EngineInterface, Hook, MatchedHook, On } from 'claude-code'
import { beneath, fail, isOn, ok, type Ctx } from '../core'
import { applyLimits } from '../host'
import { ready, save } from '../persist'

type Start = MatchedHook<'session.start', {}>
type Measure = Hook<'session.measure'>

export function registerMeter(on: On, ctx: Ctx): void {
  on('session.start', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await meterStart($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('session.measure', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await meterMeasure($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

// The first reading; later ones come pushed through session.measure.
async function meterStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], ctx: Ctx) {
  let limits: unknown
  try {
    limits = (await $.session.usage()).rateLimits
  } catch {
    // No reading here (an expected case, not a fault): the next session.measure brings one.
  }
  if (limits !== undefined) {
    await applyLimits($, ctx.shared, limits)
    void save($, ctx.shared)
  }
  return next(e)
}

// Pushed figures: refresh from them. applyLimits never throws; the store write never holds the hook.
async function meterMeasure($: EngineInterface, e: Parameters<Measure>[1], next: Parameters<Measure>[2], ctx: Ctx) {
  await applyLimits($, ctx.shared, e.rateLimits)
  void save($, ctx.shared)
  return next(e)
}
