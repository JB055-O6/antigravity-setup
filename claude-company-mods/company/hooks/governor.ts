// The effort governor and limit meter's pure logic: no `$`, no I/O.
// The only state is the module counter of governed steps per rule.

export type Effort = string | number | undefined
export type Governed = { effort: Effort; changed: boolean; reason: string }
export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable' | null

// Family by name in the id or alias, case-insensitive (`sonnet`, `claude-sonnet-5-5`).
export function modelFamily(model: unknown): Family {
  if (typeof model !== 'string') return null
  const m = model.toLowerCase()
  for (const f of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
    if (m.includes(f)) return f
  }
  return null
}

const SAME: Governed = { effort: undefined, changed: false, reason: '' }

// Settings that lose to another setting on both score and cost are never sent.
export function governEffort(model: string, effort: Effort, economy: boolean): Governed {
  const keep = { ...SAME, effort }
  if (typeof effort !== 'string') return keep
  const fam = modelFamily(model)
  const e = effort.toLowerCase()
  const to = (next: string, reason: string): Governed => ({ effort: next, changed: true, reason })

  if (fam === 'sonnet' && (e === 'xhigh' || e === 'max')) return to('high', 'sonnet xhigh/max -> high')
  if (fam === 'opus' && e === 'low') return to('medium', 'opus low -> medium')
  if (fam === 'fable' && e === 'xhigh') return to('high', 'fable xhigh -> high')
  if (economy && e === 'max') {
    if (fam === 'fable') return to('high', 'economy: fable max -> high')
    return to('xhigh', 'economy: max -> xhigh')
  }
  return keep
}

// Module counter of governed steps per rule (no state write per step).
const counts = new Map<string, number>()
export function recordGoverned(reason: string): void {
  if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1)
}
export function governedTotal(): number {
  let n = 0
  for (const v of counts.values()) n += v
  return n
}
export function governedByRule(): Record<string, number> {
  return Object.fromEntries(counts)
}
export function resetGoverned(): void {
  counts.clear()
}

export type Windows = { fiveHour?: number; week?: number }

type RateLimit = { kind?: unknown; percentUsed?: unknown }
export function readWindows(limits: readonly RateLimit[] | undefined): Windows {
  const w: Windows = {}
  for (const l of limits ?? []) {
    const p = typeof l?.percentUsed === 'number' && Number.isFinite(l.percentUsed) ? l.percentUsed : undefined
    if (p === undefined) continue
    if (l.kind === 'five_hour') w.fiveHour = p
    else if (l.kind === 'seven_day') w.week = p
  }
  return w
}

// Hysteresis: on at 5h >= 90 or week >= 85; off again below 85 and 80.
export function nextEconomy(was: boolean, w: Windows): boolean {
  const five = w.fiveHour ?? 0
  const week = w.week ?? 0
  if (!was) return five >= 90 || week >= 85
  return !(five < 85 && week < 80)
}

export function meterLine(i: {
  economy: boolean
  windows: Windows
  routed: number
  governed: number
  diet?: number
}): string {
  const parts = ['company']
  if (i.windows.fiveHour !== undefined) parts.push(`5h ${Math.round(i.windows.fiveHour)}%`)
  if (i.windows.week !== undefined) parts.push(`week ${Math.round(i.windows.week)}%`)
  parts.push(`${i.routed} subagents routed`, `${i.governed} efforts governed`)
  // Shown once the diet has acted, so a quiet session keeps its short line.
  if (i.diet) parts.push(`${i.diet} diet`)
  return (i.economy ? 'ECONOMY · ' : '') + parts.join(' · ')
}
