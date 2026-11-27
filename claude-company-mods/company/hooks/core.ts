// Host core: shared state, the module ctx, the breaker, the ledger and caps. Pure: no `$`.
import type { CrewRun, PanelLine } from '../types'
import type { Windows } from './governor'

const IDS = ['charter', 'meter', 'router', 'governor', 'diet', 'bashcap', 'rtk', 'graph', 'audit', 'nudge', 'install', 'dashboard'] as const
export type ModuleId = (typeof IDS)[number]
// Chars (code points) a module may put into context, per shape.
export type Caps = { section?: number; subagentPrompt?: number; toolContext?: number }
export const OFF_REASONS = ['errors', 'not installed', 'device attached', 'cloud', 'env', 'not a repo', 'refused'] as const
export type OffReason = (typeof OFF_REASONS)[number]
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
  // The five biggest system prompt sections and tool descriptions, in chars (audit); /company shows them.
  top5: { id: string; chars: number }[]
  // Sections a module above audit adds to this render, in chars by id: audit sits beneath and never sees them.
  ownSections: Record<string, number>
  // rtk rewrites left out because the rewritten command would need a prompt or is denied (/company shows it).
  skippedPermission: number
  // The code graph (graph module): a run going on, graph.json's time, graphify-out's bytes, and
  // whether graphify kept the old graph (no more updates this session); the dashboard shows them.
  graph: { running: boolean; builtAt?: number; bytes?: number; kept?: boolean }
  // A tool that can change files (Write, Edit, NotebookEdit, Bash) ran since the main loop's last turn end.
  touched: boolean
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
    version: '', offMachine: false, deviceAttached: false, dirty: false, routedTotal: 0, dirs: [], crew: 0, shown: 0, paneShown: false, top5: [], ownSections: {}, skippedPermission: 0, graph: { running: false }, touched: false,
  }
}

// CI=false, 0 or empty is no CI.
export function truthy(v: string | undefined): boolean {
  return !!v && !/^(false|0|)$/i.test(v.trim())
}

// A run that could not start because the binary is gone, or a path that is not there.
export function missing(err: unknown): boolean {
  return /ENOENT/.test(String(err))
}

export function isOn(ctx: Ctx): boolean {
  return ctx.shared.health[ctx.id].on
}

// The engine refuses device calls by an agent a mod spawned, retyped or registered in such a session.
export function offMachineWithDevice(s: Shared): boolean {
  return s.offMachine && s.deviceAttached
}

// A tool of the person's computer or browser, or the tool that turns those on
// (`enable__mcp__claude-in-chrome` has no `__` after the server name).
export function isDeviceTool(name: string): boolean {
  return /^(enable__)?mcp__(remote-devices|claude-in-chrome)(__|$)/.test(name)
}

// Errors that came out of a guard's `next`: raised beneath the module (an inner module, core,
// an API error, an abort), so never the module's own failure.
const fromBeneath = new WeakSet<object>()

function markBeneath(err: unknown): void {
  // shortcut: a thrown primitive cannot be held in a WeakSet and counts against the module; the engine throws Error objects.
  if ((typeof err === 'object' && err !== null) || typeof err === 'function') fromBeneath.add(err)
}

// `next(e)` for turn.step: the same stream, with errors raised while it is read marked.
async function* markStream<C, R>(stream: AsyncGenerator<C, R> & { readonly result?: Promise<R> }) {
  try {
    return yield* stream
  } catch (err) {
    markBeneath(err)
    throw err
  }
}

// The guard hands its helper `beneath(next)`: the same `next`, which marks each error that comes
// out of it. Property reads (`signal`, `origin`, `event`, `to`) go to `next` unchanged.
// shortcut: errors from `next.to(...)` are not marked (next is frozen, so a proxy cannot wrap `to`); wrap it if a module uses it.
export function beneath<T extends (...args: never[]) => unknown>(next: T): T {
  return new Proxy(next, {
    apply(target, self, args) {
      let out: unknown
      try {
        out = Reflect.apply(target, self, args)
      } catch (err) {
        markBeneath(err)
        throw err
      }
      // A thenable, not `instanceof Promise`: the engine's promise may come from another realm.
      if (typeof (out as PromiseLike<unknown> | null)?.then === 'function') {
        return Promise.resolve(out).then(undefined, (err: unknown) => {
          markBeneath(err)
          throw err
        })
      }
      const stream = out as AsyncGenerator<unknown, unknown> & { readonly result?: Promise<unknown> }
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        // `result` is read only on demand: read early, it rejects unhandled when the stream closes early.
        return Object.defineProperty(markStream(stream), 'result', { get: () => stream.result })
      }
      return out
    },
    get: (target, key) => Reflect.get(target, key),
  })
}

// One more failure in a row; FAIL_LIMIT in a row turns the module off for this session.
export function fail(ctx: Ctx, err: unknown): void {
  // A primitive is never in the set: `has` answers false.
  if (fromBeneath.has(err as object)) return
  let text = 'unprintable error'
  try {
    text = String(err)
  } catch {
    // An error without a text still counts.
  }
  const h = ctx.shared.health[ctx.id]
  h.fails += 1
  h.streak += 1
  h.lastErr = cutCodePoints(redact(text), 120)
  ctx.shared.dirty = true
  if (h.streak >= FAIL_LIMIT) setOff(ctx, 'errors')
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
