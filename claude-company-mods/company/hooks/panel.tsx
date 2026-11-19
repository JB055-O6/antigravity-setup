import type { Panel, PanelLine } from '../types'

export const PANE_ID = 'company'

export const EMPTY_PANEL: Panel = {
  version: '',
  crew: 0,
  crewTotal: 5,
  roster: [],
  directives: [],
  economy: false,
  routed: 0,
  governed: 0,
  diet: 0,
  log: [],
  runs: [],
}

export type Block = { name: string; ok: boolean; what: string; lines: string[] }

const last = (log: PanelLine[], kind: string, n = 3) =>
  log.filter((l) => l.kind === kind).slice(-n).map((l) => `#${l.n} ${l.text}`)

// One block per part; pure, so the pane, /company and the tests read the same thing.
export function panelBlocks(p: Panel): Block[] {
  const limits =
    p.fiveHour === undefined && p.week === undefined
      ? 'Limits: no data yet (it comes after Claude finishes a reply)'
      : `Limits: 5-hour ${Math.round(p.fiveHour ?? 0)}% · week ${Math.round(p.week ?? 0)}%`
  const dirOn = p.directives.filter((d) => d.on).length
  const none = (xs: string[], t: string) => (xs.length ? xs : [t])
  return [
    {
      name: 'CHARTER',
      ok: true,
      what: 'Your 21 rules and the 4 directives, added to every request.',
      lines: ['Loaded at session start.'],
    },
    {
      name: 'ROUTER',
      ok: true,
      what: 'Sends each subagent to the cheapest model that does the task well.',
      lines: [`${p.routed} subagents routed.`, ...none(last(p.log, 'route'), 'No subagent yet.')],
    },
    {
      name: 'GOVERNOR',
      ok: true,
      what: 'Corrects wasteful effort; moves Fable work to Opus (no credits).',
      lines: [`${p.governed} effort fixes.`, ...none(last(p.log, 'governor'), 'No fix needed yet.')],
    },
    {
      name: 'METER',
      ok: true,
      what: 'Watches your Pro limits; economy mode saves tokens near them.',
      lines: [
        limits,
        p.economy
          ? 'Economy: ON. Max effort is cut to xhigh to save tokens.'
          : 'Economy: off. It starts at 5-hour 90% or week 85%.',
      ],
    },
    {
      name: 'DIET',
      ok: true,
      what: 'Keeps the context small: short reports, capped big reads and searches.',
      lines: [`${p.diet} cuts.`, ...none(last(p.log, 'diet'), 'No cut yet.')],
    },
    {
      name: 'CREW',
      ok: p.crew === p.crewTotal,
      what: `${p.crew}/${p.crewTotal} helpers ready. Live and recent subagents below.`,
      lines: [
        ...p.roster.map((r) => `${r.name}: ${r.model} ${r.effort}, ${r.does}`),
        ...none(
          p.runs.slice(-5).map(
            (r) => `${r.status === 'running' ? '▶ running' : r.status === 'done' ? '✓ done' : r.status === 'failed' ? '✗ failed' : '◆ background'} ${r.type} on ${r.model} ${r.effort}, ${r.steps} steps: ${r.task}`,
          ),
          'No subagent has run yet.',
        ),
      ],
    },
    {
      name: 'DIRECTIVES',
      ok: p.directives.length > 0 && dirOn === p.directives.length,
      what: 'ponytail, headroom, i-have-adhd, caveman: how Claude works and writes.',
      lines: [p.directives.length ? p.directives.map((d) => `${d.name} ${d.on ? 'ON' : 'OFF'}`).join(' · ') : 'Checking…'],
    },
  ]
}

export function headline(p: Panel): string {
  const all = panelBlocks(p).every((b) => b.ok)
  return all ? `● company ${p.version} ACTIVE: all 7 parts on` : `● company ${p.version}: a part needs attention`
}

// The same blocks as plain text, for /company.
export function panelText(p: Panel, placed: string): string {
  return [
    headline(p),
    placed,
    ...panelBlocks(p).map((b) => [`[${b.ok ? '✓' : '✗'} ${b.name}] ${b.what}`, ...b.lines.map((l) => `   ${l}`)].join('\n')),
  ].join('\n')
}

type C = { Box: any; Text: any }

export function PanelView({ Box, Text }: C, p: Panel) {
  const blocks = panelBlocks(p)
  const all = blocks.every((b) => b.ok)
  return (
    <Box flexDirection="column" gap={1}>
      <Text weight="bold" size="heading" color={all ? 'success' : 'warning'}>
        {headline(p)}
      </Text>
      {blocks.map((b) => (
        <Box flexDirection="column" borderStyle="round" borderColor={b.ok ? 'success' : 'error'} paddingX={1}>
          <Text weight="bold" color={b.ok ? 'success' : 'error'}>
            {b.ok ? '✓ ' : '✗ '}
            {b.name}
          </Text>
          <Text dimColor>{b.what}</Text>
          {b.lines.map((l) => (
            <Text>{l}</Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
