// Audit: measures each system prompt section and tool description, in chars, for /company.
// It changes no byte: the prompt cache holds only while each request sends the same prefix.
import type { Hook, MatchedHook, On } from 'claude-code'
import { beneath, fail, isOn, ok, type Ctx, type Shared } from '../core'
import { ready } from '../persist'

type Compose = MatchedHook<'prompt.compose', {}>
type Describe = Hook<'tool.describe'>

// Chars by id: the sections of the latest main render (`prompt:<id>`), each tool's last description (`tool:<name>`).
const sizes = new WeakMap<Shared, { prompt: Map<string, number>; tools: Map<string, number> }>()

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
  const st = ctx.shared
  // What the modules above add to this render; read once, so a module that stops adding drops out.
  const own = Object.entries(st.ownSections)
  st.ownSections = {}
  const r = await next(e)
  // /context and a teammate render another prompt than the main loop sends.
  // shortcut: no prompt.compose field tells a subagent's render apart, so one replaces the prompt part (last render wins); skip it too if the engine adds such a field.
  if (e.traits.includes('analysis') || e.traits.includes('teammate')) return r
  sizesOf(st).prompt = new Map([...r.sections.map((s) => [s.id, s.text.length] as const), ...own].map(([id, n]) => [`prompt:${id}`, n]))
  rank(st)
  return r
}

async function auditDescribe(e: Parameters<Describe>[1], next: Parameters<Describe>[2], ctx: Ctx) {
  const r = await next(e)
  sizesOf(ctx.shared).tools.set(`tool:${e.tool}`, r.description.length)
  rank(ctx.shared)
  return r
}

function sizesOf(st: Shared) {
  let s = sizes.get(st)
  if (!s) sizes.set(st, (s = { prompt: new Map(), tools: new Map() }))
  return s
}

function rank(st: Shared): void {
  const s = sizesOf(st)
  st.top5 = [...s.prompt, ...s.tools].map(([id, chars]) => ({ id, chars })).sort((a, b) => b.chars - a.chars).slice(0, 5)
}
