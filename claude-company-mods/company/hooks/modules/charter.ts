// Charter: the client charter as one system prompt section, with the same bytes all session.
import type { EngineInterface, Hook, On } from 'claude-code'
import { CHARTER } from '../charter'
import { added, beneath, capText, fail, isOn, ok, type Ctx } from '../core'
import { ready, save } from '../persist'

type Compose = Hook<'prompt.compose'>

const ID = 'company:charter'

export function registerCharter(on: On, ctx: Ctx): void {
  on('prompt.compose', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await charterCompose($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

async function charterCompose($: EngineInterface, e: Parameters<Compose>[1], next: Parameters<Compose>[2], ctx: Ctx) {
  // CHARTER is fixed, so the section's bytes are the same on every compose.
  const text = capText(ctx, 'section', CHARTER)
  // Before next: audit, beneath, measures this render with it.
  ctx.shared.ownSections[ID] = text.length
  const result = await next(e)
  try {
    added(ctx, text.length)
    void save($, ctx.shared)
  } catch {
    // Counting is best-effort.
  }
  return { sections: [...result.sections, { id: ID, text, scope: 'session' as const }] }
}
