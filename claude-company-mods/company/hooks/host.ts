// Host side of the shared state: the pane atom, the status line and boot.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { EMPTY_PANEL } from './panel'
import { directiveState, directivesNote } from './directives'
import { dietTotal } from './diet'
import { governedTotal, meterLine, nextEconomy, readWindows } from './governor'
import { CREW } from './crew'
import { note, type Shared } from './core'

const LABEL: Record<string, string> = { start: 'COMPANY', route: 'ROUTER', governor: 'GOVERNOR', meter: 'METER', diet: 'DIET', crew: 'CREW' }

// Change the tag when Panel's fields change: it declines what an older version stored.
export const panel = atom({ plugin: 'company', key: 'panel' } as const, EMPTY_PANEL, { shape: 'panel-2' })

// The validator lets `read` take only an atom made in its own file, so register.tsx reads through here.
export function readPanel($: EngineInterface) {
  return read($, panel)
}

export function showStatus($: EngineInterface, st: Shared): void {
  try {
    $.ui.status(
      meterLine({
        economy: st.economy,
        windows: st.windows,
        routed: st.routedTotal,
        governed: governedTotal(),
        diet: dietTotal(),
      }) + (st.directives ? ` · ${st.directives}` : ''),
    )
  } catch {
    // The line is best-effort.
  }
  // The pane redraws from this snapshot.
  void update($, panel, () => ({
    version: st.version,
    crew: st.crew,
    crewTotal: CREW.length,
    roster: CREW.map((a) => ({ name: a.name, model: a.model, effort: a.effort, does: a.does })),
    directives: st.dirs,
    ...(st.windows.fiveHour !== undefined ? { fiveHour: st.windows.fiveHour } : {}),
    ...(st.windows.week !== undefined ? { week: st.windows.week } : {}),
    economy: st.economy,
    routed: st.routedTotal,
    governed: governedTotal(),
    diet: dietTotal(),
    log: st.log,
    runs: st.runs,
  })).catch(() => {})
  // No pane on screen (a cloud session seen from an app): post each new action as a chat
  // notice. The model never reads notices, so they cost no tokens.
  const fresh = st.log.filter((l) => l.n > st.shown)
  st.shown = st.seq
  if (!st.paneShown) {
    for (const l of fresh) {
      void $.session
        .append({ message: { type: 'system', content: [{ type: 'text', text: `company · ${LABEL[l.kind] ?? l.kind.toUpperCase()} · ${l.text}` }] } })
        .catch(() => {})
    }
  }
}

// Everything a session needs, run at start and again by /company in a live session.
export async function boot($: EngineInterface, st: Shared): Promise<number> {
  let crew = 0
  for (const a of CREW) {
    try {
      await $.agent.register({
        name: a.name,
        description: a.description,
        prompt: a.prompt,
        model: a.model,
        effort: a.effort,
        ...(a.tools ? { tools: a.tools } : {}),
      })
      crew++
    } catch {
      // One agent failing to register must not stop the others or the session.
    }
  }
  st.crew = crew
  let enabled: unknown
  let loaded: string[] = []
  try {
    enabled = await $.settings.read({ key: 'enabledPlugins' })
  } catch {
    // Unknown: the command list below may still tell.
  }
  try {
    loaded = (await $.command.list()).map((c) => c.plugin ?? (c.name.includes(':') ? (c.name.split(':')[0] ?? '') : '')).filter(Boolean)
  } catch {
    // Unknown: settings alone decide.
  }
  // Both reads failed: unknown, so show nothing rather than a false "0/4".
  if (enabled !== undefined || loaded.length) {
    st.dirs = directiveState(enabled, loaded)
    st.directives = directivesNote(enabled, loaded)
  }
  try {
    const v = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }
    if (typeof v.version === 'string') st.version = v.version
  } catch {
    // The version is only shown.
  }
  note(st, 'start', `company ${st.version} on: charter, router, governor, meter, diet, crew ${crew}/${CREW.length}, ${st.directives}`)
  try {
    await applyLimits($, st, (await $.session.usage()).rateLimits)
  } catch {
    showStatus($, st)
  }
  return crew
}

// Apply one reading of the rate-limit windows. Best-effort: never throws.
export async function applyLimits($: EngineInterface, st: Shared, limits: unknown): Promise<void> {
  try {
    // A reading without a window keeps the last known value of that window.
    // readWindows checks each field; a non-list throws into the catch below.
    const w = { ...st.windows, ...readWindows(limits as Parameters<typeof readWindows>[0]) }
    const was = st.economy
    st.windows = w
    st.economy = nextEconomy(was, w)
    if (st.economy !== was) {
      note(st, 'meter', st.economy ? `economy ON at 5h ${Math.round(w.fiveHour ?? 0)}% · week ${Math.round(w.week ?? 0)}%` : 'economy off')
      try {
        if (st.economy) {
          const five = w.fiveHour ?? 0
          $.ui.toast(
            five >= 90
              ? `Economy mode on: five-hour window at ${Math.round(five)}%`
              : `Economy mode on: weekly window at ${Math.round(w.week ?? 0)}%`,
          )
        } else {
          $.ui.toast(
            `Economy mode off: five-hour window at ${Math.round(w.fiveHour ?? 0)}%, weekly at ${Math.round(w.week ?? 0)}%`,
          )
        }
      } catch {
        // A toast failing changes nothing.
      }
    }
    try {
      if (st.economy && !was) st.economySince = Number(await $.clock.now())
      if (!st.economy) st.economySince = undefined
      await $.store.set('meter', {
        ...(st.economySince !== undefined ? { economySince: st.economySince } : {}),
        ...(w.fiveHour !== undefined ? { lastFiveHour: w.fiveHour } : {}),
        ...(w.week !== undefined ? { lastWeek: w.week } : {}),
      })
    } catch {
      // Persisting is best-effort.
    }
  } catch {
    // Leave the previous values.
  }
  showStatus($, st)
}
