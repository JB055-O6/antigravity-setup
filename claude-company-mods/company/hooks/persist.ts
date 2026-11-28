// Persistence. $.state (held for the session, through hot reloads): the ledger and health atoms.
// $.store (kept between sessions; every copy of company shares one file): `lifetime` totals and
// this session's `meter`. The host is the only writer; read/update take only atoms made in this
// file, so nothing else touches them.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'
import type { StoredEntry, StoredHealth } from '../types'
import { OFF_REASONS, type Entry, type Health, type ModuleId, type Shared } from './core'
import { restorePanel } from './host'
import type { Route } from './router'

type Model = Route['model']
type Routes = Record<Model, number> & { since?: number }
const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus', 'fable']
// At most one `lifetime` write per gap; a trailing write (or session.end) writes what it held back.
export const WRITE_GAP_MS = 2000
// The longest a hook waits for restore, once per load; then it goes on from memory.
export const RESTORE_WAIT_MS = 1500
// The final write's share of session.end's short bound (1.5 s for the whole chain).
export const FINAL_WAIT_MS = 1000

export const EMPTY_LEDGER: Partial<Record<string, StoredEntry>> = {}
export const EMPTY_HEALTH: Partial<Record<string, StoredHealth>> = {}
// Change a tag when its value's fields change: it declines what an older version stored.
export const ledgerAtom = atom({ plugin: 'company', key: 'ledger' } as const, EMPTY_LEDGER, { shape: 'ledger-1' })
export const healthAtom = atom({ plugin: 'company', key: 'health' } as const, EMPTY_HEALTH, { shape: 'health-1' })

// The stored shapes (types/index.d.ts) name the same fields as core.ts: a field added on one side fails tsc.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Holds<T extends true> = T
export type StoredFieldsMatch = [Holds<Same<keyof Entry, keyof StoredEntry>>, Holds<Same<keyof Health, keyof StoredHealth>>]

// What this load has read and written, per Shared.
type Book = {
  restoring?: Promise<void>
  // restore finished, or a hook already waited RESTORE_WAIT_MS for it: no hook waits again.
  settled: boolean
  // restore finished: the meter in memory is this session's, not a blank one.
  restored: boolean
  // A /clear or a resume ended the conversation: its health is not restored, and the next hook
  // stores the meter under the new session id.
  cleared: boolean
  resave: boolean
  // The atoms were read, so a write never puts a blank copy over them.
  atomsRead: boolean
  // Routes counted and not yet in `lifetime`.
  unsaved: Partial<Record<Model, number>>
  lastWrite: number
  trailing?: Timer
  // The meter as last stored, session id included, to write only a change.
  meter: string
  // Writes run one at a time, in call order.
  writing: Promise<void>
}
const books = new WeakMap<Shared, Book>()

function book(s: Shared): Book {
  let b = books.get(s)
  if (!b) {
    b = { settled: false, restored: false, cleared: false, resave: false, atomsRead: false, unsaved: {}, lastWrite: -Infinity, meter: meterText(undefined, s), writing: Promise.resolve() }
    books.set(s, b)
  }
  return b
}

// What every hook awaits first: restore, run once per load by whichever hook comes first (a hot
// reload need not start with session.start). It waits at most RESTORE_WAIT_MS in all, so a
// hanging read never stalls a hook; restore then ends in the background. Never throws.
export async function ready($: EngineInterface, s: Shared): Promise<void> {
  const b = book(s)
  if (!b.settled) {
    b.restoring ??= restore($, s).finally(() => {
      b.settled = true
    })
    if (await within($, b.restoring, RESTORE_WAIT_MS)) b.settled = true
  }
  if (b.resave && b.restored) {
    b.resave = false
    void save($, s)
  }
}

// Waits for `p` at most `ms`; true when the time ran out. A clock that cannot wait leaves the wait to `p`.
export async function within($: EngineInterface, p: Promise<void>, ms: number): Promise<boolean> {
  const stop = new AbortController()
  let late = false
  const timeout = $.clock.sleep(ms, { signal: stop.signal }).then(
    () => {
      late = true
    },
    () => new Promise<void>(() => {}),
  )
  await Promise.race([p, timeout])
  stop.abort()
  return late
}

// Load once: atoms, the pane's snapshot, then `lifetime` (or the old `routes`), then `meter`.
export async function restore($: EngineInterface, s: Shared): Promise<void> {
  const b = book(s)
  try {
    const ledger = await read($, ledgerAtom)
    const health = await read($, healthAtom)
    for (const id of Object.keys(s.ledger) as ModuleId[]) {
      const e = ledger[id]
      // Added, not set: a count made before this read is kept.
      if (isEntry(e)) {
        s.ledger[id].added += e.added
        s.ledger[id].saved += e.saved
        s.ledger[id].acted += e.acted
      }
      const h = health[id]
      if (isHealth(h) && !b.cleared) s.health[id] = mergeHealth(s.health[id], h)
    }
    b.atomsRead = true
  } catch {
    // Unread atoms stay as they are: this load never writes over them.
  }
  try {
    await restorePanel($, s)
  } catch {
    // boot fills the pane again.
  }
  try {
    s.routedTotal += sum((await stored($)).routes)
  } catch {
    // The count starts from this load's routes.
  }
  try {
    const m = await $.store.get('meter')
    const sessionId = isRecord(m) ? await $.session.id() : undefined
    // Economy is per session, and other sessions write this key too. A reading that came in
    // meanwhile (restore ran past its wait) is newer: it stays.
    const fresh = s.windows.fiveHour === undefined && s.windows.week === undefined
    if (isRecord(m) && m.sessionId === sessionId && fresh) {
      s.economy = m.economy === true
      if (isCount(m.economySince)) s.economySince = m.economySince
      if (isCount(m.lastFiveHour)) s.windows.fiveHour = m.lastFiveHour
      if (isCount(m.lastWeek)) s.windows.week = m.lastWeek
      b.meter = meterText(sessionId, s)
    }
  } catch {
    // Economy comes back with the next reading.
  }
  b.restored = true
}

// Stored health under what this load did since register (a restore past its wait comes late):
// an off or a failure in memory stays, the stored ones are added.
function mergeHealth(m: Health, h: Health): Health {
  const off = m.on ? h.off : m.off
  const lastErr = m.lastErr ?? h.lastErr
  return {
    on: m.on && h.on,
    fails: m.fails + h.fails,
    // A streak since load is the newest; with no failure since load, the stored one stands.
    streak: m.fails > 0 ? m.streak : h.streak,
    ...(lastErr !== undefined ? { lastErr } : {}),
    ...(off !== undefined ? { off } : {}),
  }
}

// A /clear or a resume (session.end): mark the conversation as ended.
export function newSession(s: Shared): void {
  const b = book(s)
  b.cleared = true
  b.resave = true
}

// One routed spawn, counted in memory: no store read per spawn. A flush writes it.
export function countRoute(s: Shared, model: Model): void {
  const b = book(s)
  b.unsaved[model] = (b.unsaved[model] ?? 0) + 1
  s.routedTotal += 1
}

// Atoms when dirty; `meter` when it changed; `lifetime` at most once per WRITE_GAP_MS. Never throws.
export function flush($: EngineInterface, s: Shared, now: number): Promise<void> {
  return queue($, s, now, false)
}

// On session.end: what memory holds, the gap ignored, started at once (no wait for restore, no
// timer), within FINAL_WAIT_MS. It waits only behind a write already under way.
export async function finalFlush($: EngineInterface, s: Shared): Promise<void> {
  await within($, clock($).then((now) => queue($, s, now, true)), FINAL_WAIT_MS)
}

// A flush at the engine's time, for hooks.
export async function save($: EngineInterface, s: Shared): Promise<void> {
  return flush($, s, await clock($))
}

async function clock($: EngineInterface): Promise<number> {
  try {
    const t = Number(await $.clock.now())
    if (Number.isFinite(t)) return t
  } catch {
    // The wall clock does.
  }
  return Date.now()
}

function queue($: EngineInterface, s: Shared, now: number, final: boolean): Promise<void> {
  const b = book(s)
  b.writing = b.writing.then(() => write($, s, now, final)).catch(() => {})
  return b.writing
}

async function write($: EngineInterface, s: Shared, now: number, final: boolean): Promise<void> {
  const b = book(s)
  if (s.dirty && b.atomsRead) {
    s.dirty = false
    try {
      await update($, ledgerAtom, () => copy(s.ledger))
      await update($, healthAtom, () => copy(s.health))
    } catch {
      s.dirty = true
    }
  }
  let sessionId: string | undefined
  try {
    // Asked each time: after /clear or a resume the same process runs under a new id.
    sessionId = await $.session.id()
  } catch {
    // Stored without it, the record is never restored.
  }
  const meter = meterText(sessionId, s)
  // Before restore ends, memory holds a blank meter: it never goes over this session's record.
  if (meter !== b.meter && b.restored) {
    try {
      await $.store.set('meter', JSON.parse(meter))
      b.meter = meter
    } catch {
      // The next flush tries again.
    }
  }
  if (!Object.keys(b.unsaved).length) return
  if (!final && now - b.lastWrite < WRITE_GAP_MS) {
    // shortcut: a hot reload ends this timer, so it loses what the gap held back (no session.end fires); V1/V5 measure it.
    later($, s, WRITE_GAP_MS - (now - b.lastWrite))
    return
  }
  const add = b.unsaved
  b.unsaved = {}
  try {
    // Read again: other sessions add to the same file, so add this load's counts to what is there now.
    const { life, routes } = await stored($)
    for (const m of MODELS) routes[m] += add[m] ?? 0
    routes.since ??= now
    await $.store.set('lifetime', { ...(isRecord(life) ? life : {}), routes })
    b.lastWrite = now
    s.routedTotal = sum(routes) + sum(b.unsaved)
  } catch {
    for (const m of MODELS) if (add[m]) b.unsaved[m] = (b.unsaved[m] ?? 0) + add[m]
  }
}

// The `lifetime` record and its routes, or the old `routes` key until the first `lifetime` write.
// Throws when the store does.
async function stored($: EngineInterface): Promise<{ life: unknown; routes: Routes }> {
  const life = await $.store.get('lifetime')
  const r = isRecord(life) ? life.routes : await $.store.get('routes')
  const routes: Routes = { haiku: 0, sonnet: 0, opus: 0, fable: 0 }
  if (isRecord(r)) {
    for (const m of MODELS) if (isCount(r[m])) routes[m] = r[m]
    if (isCount(r.since)) routes.since = r.since
  }
  return { life, routes }
}

// One trailing write per gap, so held-back counts do not wait for session.end.
function later($: EngineInterface, s: Shared, ms: number): void {
  const b = book(s)
  if (b.trailing) return
  try {
    b.trailing = $.clock.after(ms, () => {
      b.trailing = undefined
      void save($, s)
    })
  } catch {
    // session.end writes them.
  }
}

// The meter record as JSON text; JSON leaves out an unknown session id.
function meterText(sessionId: string | undefined, s: Shared): string {
  return JSON.stringify({ sessionId, ...meterOf(s) })
}

function meterOf(s: Shared) {
  return {
    economy: s.economy,
    ...(s.economySince !== undefined ? { economySince: s.economySince } : {}),
    ...(s.windows.fiveHour !== undefined ? { lastFiveHour: s.windows.fiveHour } : {}),
    ...(s.windows.week !== undefined ? { lastWeek: s.windows.week } : {}),
  }
}

function sum(r: Partial<Record<Model, number>>): number {
  return MODELS.reduce((n, m) => n + (r[m] ?? 0), 0)
}

// The engine may freeze what it holds; Shared keeps changing.
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

function isEntry(v: unknown): v is Entry {
  return isRecord(v) && isCount(v.added) && isCount(v.saved) && isCount(v.acted)
}

function isHealth(v: unknown): v is Health {
  return (
    isRecord(v) &&
    typeof v.on === 'boolean' &&
    isCount(v.fails) &&
    isCount(v.streak) &&
    (v.lastErr === undefined || typeof v.lastErr === 'string') &&
    (v.off === undefined || (OFF_REASONS as readonly unknown[]).includes(v.off))
  )
}
