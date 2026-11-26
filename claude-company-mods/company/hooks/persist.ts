// Persistence. $.state (held for the session, through hot reloads): the ledger and health atoms.
// $.store (kept between sessions; every copy of company shares one file): `lifetime` totals and
// this session's `meter`. The host is the only writer; read/update take only atoms made in this
// file, so nothing else touches them.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { StoredEntry, StoredHealth } from '../types'
import { OFF_REASONS, type Entry, type Health, type ModuleId, type Shared } from './core'
import type { Route } from './router'

type Model = Route['model']
type Routes = Record<Model, number> & { since?: number }
const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus', 'fable']
// At most one `lifetime` write per gap; session.end writes what the gap held back.
export const WRITE_GAP_MS = 2000

export const EMPTY_LEDGER: Partial<Record<string, StoredEntry>> = {}
export const EMPTY_HEALTH: Partial<Record<string, StoredHealth>> = {}
// Change a tag when its value's fields change: it declines what an older version stored.
export const ledgerAtom = atom({ plugin: 'company', key: 'ledger' } as const, EMPTY_LEDGER, { shape: 'ledger-1' })
export const healthAtom = atom({ plugin: 'company', key: 'health' } as const, EMPTY_HEALTH, { shape: 'health-1' })

// What this load has read and written, per Shared.
type Book = {
  // The atoms were read, so a write never puts a blank copy over them.
  atomsRead: boolean
  // Routes counted and not yet in `lifetime`.
  unsaved: Partial<Record<Model, number>>
  lastWrite: number
  // The meter as last stored (without sessionId), to write only a change.
  meter: string
  // Writes run one at a time, in call order.
  writing: Promise<void>
}
const books = new WeakMap<Shared, Book>()

function book(s: Shared): Book {
  let b = books.get(s)
  if (!b) {
    b = { atomsRead: false, unsaved: {}, lastWrite: -Infinity, meter: JSON.stringify(meterOf(s)), writing: Promise.resolve() }
    books.set(s, b)
  }
  return b
}

// Load once, at the first hook after register: atoms, then `lifetime` (or the old `routes`), then `meter`.
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
      if (isHealth(h)) s.health[id] = { ...h }
    }
    b.atomsRead = true
  } catch {
    // Unread atoms stay as they are: this load never writes over them.
  }
  try {
    s.routedTotal += sum((await stored($)).routes)
  } catch {
    // The count starts from this load's routes.
  }
  try {
    const m = await $.store.get('meter')
    // Economy is per session, and other sessions write this key too.
    if (isRecord(m) && m.sessionId === (await $.session.id())) {
      s.economy = m.economy === true
      if (isCount(m.economySince)) s.economySince = m.economySince
      if (isCount(m.lastFiveHour)) s.windows.fiveHour = m.lastFiveHour
      if (isCount(m.lastWeek)) s.windows.week = m.lastWeek
      b.meter = JSON.stringify(meterOf(s))
    }
  } catch {
    // Economy comes back with the next reading.
  }
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

// On session.end: everything, the gap ignored.
export async function finalFlush($: EngineInterface, s: Shared): Promise<void> {
  return queue($, s, await clock($), true)
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
  const meter = meterOf(s)
  if (JSON.stringify(meter) !== b.meter) {
    try {
      let sessionId: string | undefined
      try {
        sessionId = await $.session.id()
      } catch {
        // Stored without it, the record is never restored.
      }
      await $.store.set('meter', { ...(sessionId !== undefined ? { sessionId } : {}), ...meter })
      b.meter = JSON.stringify(meter)
    } catch {
      // The next flush tries again.
    }
  }
  if (!Object.keys(b.unsaved).length || (!final && now - b.lastWrite < WRITE_GAP_MS)) return
  // shortcut: a hot reload within the gap loses the counts it held back (no session.end fires); add a trailing $.clock.after if V1/V5 show it.
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
