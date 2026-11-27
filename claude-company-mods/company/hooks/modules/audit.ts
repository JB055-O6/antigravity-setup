// Audit: measures each system prompt section and tool description, in chars, for /company.
// It changes no byte: the prompt cache holds only while each request sends the same prefix.
// shortcut: it sits beneath the charter, so the charter's own section is not in top5; the charter ledger counts it.
import type { Hook, MatchedHook, On } from 'claude-code'
import { beneath, fail, isOn, ok, type Ctx, type Shared } from '../core'
import { ready } from '../persist'

type Compose = MatchedHook<'prompt.compose', {}>
type Describe = Hook<'tool.describe'>

// Chars per `prompt:<section id>` and `tool:<name>`; the last render of each wins.
const sizes = new WeakMap<Shared, Map<string, number>>()

export function registerAudit(on: On, ctx: Ctx): void {
  on('prompt.compose', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await auditCompose(e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('tool.describe', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await auditDescribe(e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

// Returns what `next` gave, as it gave it.
async function auditCompose(e: Parameters<Compose>[1], next: Parameters<Compose>[2], ctx: Ctx) {
  const r = await next(e)
  measure(ctx.shared, r.sections.map((s) => [`prompt:${s.id}`, s.text.length]))
  return r
}

async function auditDescribe(e: Parameters<Describe>[1], next: Parameters<Describe>[2], ctx: Ctx) {
  const r = await next(e)
  measure(ctx.shared, [[`tool:${e.tool}`, r.description.length]])
  return r
}

function measure(st: Shared, found: [string, number][]): void {
  let m = sizes.get(st)
  if (!m) sizes.set(st, (m = new Map()))
  for (const [id, chars] of found) m.set(id, chars)
  st.top5 = [...m].map(([id, chars]) => ({ id, chars })).sort((a, b) => b.chars - a.chars).slice(0, 5)
}
