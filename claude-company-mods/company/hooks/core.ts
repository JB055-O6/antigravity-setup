// Host core: shared state, the module ctx, the breaker, the ledger and caps. Pure: no `$`.
import type { CrewRun, PanelLine } from '../types'
import type { Windows } from './governor'

const IDS = ['charter', 'meter', 'router', 'governor', 'diet', 'bashcap', 'rtk', 'graph', 'audit', 'nudge', 'install', 'dashboard'] as const
export type ModuleId = (typeof IDS)[number]
// Chars (code points) a module may put into context, per shape.
export type Caps = { section?: number; subagentPrompt?: number; toolContext?: number }
export type OffReason = 'errors' | 'not installed' | 'device attached' | 'cloud' | 'env'
export type Health = { on: boolean; fails: number; streak: number; lastErr?: string; off?: OffReason }
// Tokens, estimates.
export type Entry = { added: number; saved: number; acted: number }

export type Shared = {
  health: Record<ModuleId, Health>
  ledger: Record<ModuleId, Entry>
  // Effort per routed subagent, by its agentId; turn.step reads it synchronously.
  efforts: Map<string, string>
  runs: CrewRun[]
  // Agent tool call id -> subagent id, to close a run when its tool call returns.
  runByTool: Map<string, string>
  economy: boolean
  economySince?: number
  windows: Windows
  log: PanelLine[]
  seq: number
  version: string
  offMachine: boolean
  deviceAttached: boolean
  // Health or ledger changed since the last write.
  dirty: boolean
  routedTotal: number
  directives?: string
  dirs: { name: string; on: boolean }[]
  crew: number
  lastGov?: string
  // Last log line posted as a chat notice, and whether a surface draws the pane.
  shown: number
  paneShown: boolean
}

export type Ctx = { id: ModuleId; caps: Caps; shared: Shared }
export type ModuleMeta = { id: ModuleId; title: string; what: string; caps: Caps }

export const FAIL_LIMIT = 3

export function createShared(ids: readonly ModuleId[]): Shared {
  const health = {} as Record<ModuleId, Health>
  const ledger = {} as Record<ModuleId, Entry>
  for (const id of ids) {
    health[id] = { on: true, fails: 0, streak: 0 }
    ledger[id] = { added: 0, saved: 0, acted: 0 }
  }
  return {
    health, ledger, efforts: new Map(), runs: [], runByTool: new Map(), economy: false, windows: {}, log: [], seq: 0,
    version: '', offMachine: false, deviceAttached: false, dirty: false, routedTotal: 0, dirs: [], crew: 0, shown: 0, paneShown: false,
  }
}

export function isOn(ctx: Ctx): boolean {
  return ctx.shared.health[ctx.id].on
}

// An inner module's error also rejects the outer guards' `next`. The engine rebuilds the
// error but keeps its message, so this tag on the message stops them counting it again.
const COUNTED = ' [company: counted]'

// One more failure in a row; FAIL_LIMIT in a row turns the module off for this session.
export function fail(ctx: Ctx, err: unknown): void {
  let text = 'unprintable error'
  try {
    text = String(err)
  } catch {
    // An error without a text still counts.
  }
  if (text.includes(COUNTED)) return
  const h = ctx.shared.health[ctx.id]
  h.fails += 1
  h.streak += 1
  h.lastErr = cutCodePoints(redact(text), 120)
  ctx.shared.dirty = true
  if (h.streak >= FAIL_LIMIT) setOff(ctx, 'errors')
  // shortcut: a thrown string or a frozen error cannot carry the tag, so outer modules count it too; modules throw Error objects.
  try {
    const e = err as { message?: unknown }
    if (typeof e.message === 'string') e.message += COUNTED
  } catch {
    // The tag is best-effort.
  }
}

// A /clear or a resume starts a new conversation and fires no session.start: counts and
// switch-offs for errors start over. Other reasons (env, not installed, cloud, devices) still hold.
export function resetHealth(s: Shared): void {
  for (const h of Object.values(s.health)) {
    h.fails = 0
    h.streak = 0
    delete h.lastErr
    if (h.off === 'errors') {
      h.on = true
      delete h.off
    }
  }
  s.dirty = true
}

export function ok(ctx: Ctx): void {
  const h = ctx.shared.health[ctx.id]
  if (h.streak === 0) return
  h.streak = 0
  ctx.shared.dirty = true
}

export function setOff(ctx: Ctx, why: OffReason): void {
  const h = ctx.shared.health[ctx.id]
  h.on = false
  h.off = why
  ctx.shared.dirty = true
}

export function setOn(ctx: Ctx): void {
  const h = ctx.shared.health[ctx.id]
  h.on = true
  h.streak = 0
  delete h.off
  ctx.shared.dirty = true
}

export function added(ctx: Ctx, chars: number): void {
  ctx.shared.ledger[ctx.id].added += estimateTokens(chars)
  ctx.shared.dirty = true
}

export function saved(ctx: Ctx, tokens: number): void {
  ctx.shared.ledger[ctx.id].saved += tokens
  ctx.shared.dirty = true
}

export function acted(ctx: Ctx, n = 1): void {
  ctx.shared.ledger[ctx.id].acted += n
  ctx.shared.dirty = true
}

// One line in the pane's activity list (last 40 kept).
export function note(s: Shared, kind: string, text: string): void {
  s.seq += 1
  s.log = [...s.log, { n: s.seq, kind, text }].slice(-40)
}

export function noteOf(ctx: Ctx, text: string): void {
  note(ctx.shared, ctx.id, cutCodePoints(redact(text), 80))
}

// Text over the module's cap for this shape is cut, and the cut is noted.
export function capText(ctx: Ctx, shape: keyof Caps, text: string): string {
  const cap = ctx.caps[shape]
  if (cap === undefined) return text
  const out = cutCodePoints(text, cap)
  if (out.length < text.length) noteOf(ctx, `${shape} text cut to ${cap} chars`)
  return out
}

export function cutCodePoints(s: string, maxChars: number): string {
  let i = 0
  for (let n = 0; n < maxChars && i < s.length; n++) i += (s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1
  return s.slice(0, i)
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

// Credentials and control characters out of any note, card or notice. Callers cut the length.
export function redact(s: string): string {
  return s
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/(\/\/)[^\s/]*@/g, '$1***@')
    .replace(/\bBearer\s+[\w.~+/=-]{8,}/gi, 'Bearer ***')
    // (?=(...))\1 takes the name whole, with no backtracking into it, so the time stays linear.
    .replace(/\b(?=([\w.-]{0,60}?(?:key|token|secret|password)[\w.-]{0,60}))\1(["']?\s*[:=]\s*)(?:"[^"]{0,200}"?|'[^']{0,200}'?|[^\s"'&;,]+)/gi, '$1$2***')
    .replace(/[\w+=-]{32,}/g, (m) => (/\d/.test(m) && /[a-z]/i.test(m) ? '***' : m))
}

// COMPANY_OFF=rtk,graph: the known module ids it names, each once.
export function envOff(value: string | undefined): ModuleId[] {
  return [...new Set((value ?? '').split(',').map((v) => v.trim()))].filter((v): v is ModuleId => (IDS as readonly string[]).includes(v))
}
