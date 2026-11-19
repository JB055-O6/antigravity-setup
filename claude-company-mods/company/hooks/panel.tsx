import type { Panel } from '../types'

export const PANE_ID = 'company'

export const EMPTY_PANEL: Panel = {
  version: '',
  crew: 0,
  crewTotal: 5,
  directives: [],
  economy: false,
  routed: 0,
  governed: 0,
  diet: 0,
  log: [],
}

// The plain-text rows the pane draws; kept pure so tests can read them.
export function panelRows(p: Panel): { ok: boolean; name: string; text: string }[] {
  const limits =
    p.fiveHour === undefined && p.week === undefined
      ? 'no limit data (API key)'
      : `5h ${Math.round(p.fiveHour ?? 0)}% · week ${Math.round(p.week ?? 0)}%`
  const dirOn = p.directives.filter((d) => d.on).length
  return [
    { ok: true, name: 'Charter', text: 'your 21 rules + 4 directives, in every request' },
    { ok: true, name: 'Router', text: `${p.routed} subagents sent to the cheapest model that fits` },
    { ok: true, name: 'Governor', text: `${p.governed} effort fixes (no wasted effort, no Fable)` },
    {
      ok: true,
      name: 'Meter',
      text: p.economy
        ? `${limits} · ECONOMY ON: near your limit, max effort is cut to xhigh to save tokens`
        : `${limits} · economy off (turns on at 5h 90% or week 85%)`,
    },
    { ok: true, name: 'Diet', text: `${p.diet} cuts (short subagent reports, huge reads and searches capped)` },
    { ok: p.crew === p.crewTotal, name: 'Crew', text: `${p.crew}/${p.crewTotal} workers: scout, builder, reviewer, architect, sage` },
    {
      ok: p.directives.length > 0 && dirOn === p.directives.length,
      name: 'Directives',
      text: p.directives.length
        ? p.directives.map((d) => `${d.name} ${d.on ? 'on' : 'OFF'}`).join(' · ')
        : 'checking…',
    },
  ]
}

type C = { Box: any; Text: any }

export function PanelView({ Box, Text }: C, p: Panel, room: number) {
  const rows = panelRows(p)
  const all = rows.every((r) => r.ok)
  return (
    <Box flexDirection="column">
      <Text weight="bold" color={all ? 'success' : 'warning'}>
        {all ? `● company ${p.version} ACTIVE: all 7 parts on` : `● company ${p.version}: a part needs attention`}
      </Text>
      {rows.map((r) => (
        <Text>
          <Text color={r.ok ? 'success' : 'error'}>{r.ok ? '✓ ' : '✗ '}</Text>
          <Text weight="semibold">{r.name.padEnd(11)}</Text>
          <Text>{r.text}</Text>
        </Text>
      ))}
      <Text weight="bold">Recent activity</Text>
      {p.log.length === 0 && <Text dimColor>Nothing yet. Actions show here as they happen.</Text>}
      {p.log.slice(-Math.max(1, room)).map((l) => (
        <Text dimColor={l.kind === 'start'}>
          #{l.n} {l.kind}: {l.text}
        </Text>
      ))}
    </Box>
  )
}
