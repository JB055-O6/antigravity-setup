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
          : 'Economy: off. It starts at 5-hour 75% or week 75%.',
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
            (r) => `${r.status === 'running' ? '▶ running' : r.status === 'done' ? '✓ done' : r.status === 'failed' ? '✗ failed' : r.status === 'ended' ? '■ ended' : '◆ background'} ${r.type} on ${r.model} ${r.effort}, ${r.steps} steps: ${r.task}`,
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

// The /company report: a summary card, then the crew, then recent actions.
export function panelText(p: Panel, placed: string): string {
  const blocks = panelBlocks(p)
  const all = blocks.every((b) => b.ok)
  const bar = '━'.repeat(44)
  const thin = '─'.repeat(44)
  const limits =
    p.fiveHour === undefined && p.week === undefined
      ? 'limits: waiting for data'
      : `5h ${Math.round(p.fiveHour ?? 0)}% · week ${Math.round(p.week ?? 0)}%`
  const running = p.runs.filter((r) => r.status === 'running').length
  const summary: [string, boolean, string][] = [
    ['CHARTER', true, '21 rules + 4 directives in every request'],
    ['ROUTER', true, `${p.routed} subagents sent to the cheapest fit`],
    ['GOVERNOR', true, `${p.governed} effort fixes · no Fable`],
    ['METER', true, `${limits} · economy ${p.economy ? 'ON (max → xhigh)' : 'off'}`],
    ['DIET', true, `${p.diet} cuts to keep the context small`],
    ['CREW', p.crew === p.crewTotal, `${p.crew}/${p.crewTotal} ready · ${running} running`],
    ['DIRECTIVES', blocks[6]!.ok, p.directives.length ? p.directives.map((d) => (d.on ? d.name : `${d.name} OFF`)).join(' · ') : 'checking'],
  ]
  const recent = p.log.filter((l) => l.kind !== 'start').slice(-6)
  return [
    bar,
    ` COMPANY ${p.version} · ${all ? 'ACTIVE · all 7 parts on' : 'CHECK · a part needs attention'}`,
    bar,
    ...summary.map(([n, ok, t]) => `${ok ? '✓' : '✗'} ${n.padEnd(11)}${t}`),
    thin,
    'CREW',
    ...p.roster.map((r) => `  ${r.name.padEnd(10)}${`${r.model} · ${r.effort}`.padEnd(16)}${r.does}`),
    ...p.runs.slice(-5).map((r) => `  ${r.status === 'running' ? '▶' : r.status === 'done' ? '✓' : r.status === 'failed' ? '✗' : r.status === 'ended' ? '■' : '◆'} ${r.type} · ${r.model} ${r.effort} · ${r.steps} steps · ${r.task}`),
    thin,
    'RECENT',
    ...(recent.length ? recent.map((l) => `  #${l.n} ${l.kind.toUpperCase().padEnd(9)}${l.text}`) : ['  nothing yet']),
    thin,
    placed,
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
