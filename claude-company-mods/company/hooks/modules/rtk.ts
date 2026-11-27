// RTK: rewrites Bash commands to their rtk form, which prints less. Safety comes first: a rewrite
// stands only when it gives back the command as typed, every part is a read-only form (a write is
// never rewritten, in any mode), and both forms are allowed with no prompt. Device calls are never touched.
// Each expected miss (no rtk, a timeout, no rewrite, a refusal) runs the command as typed and
// never throws: a throw would take bashcap's hook on the same call out with it.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { acted, beneath, fail, isDeviceTool, isOn, noteOf, ok, saved, setOff, type Ctx } from '../core'
import { showStatus } from '../host'
import { ready, save } from '../persist'
import { acceptRewrite, inMode, shouldTry } from '../rtkrules'

type Start = MatchedHook<'session.start', {}>
type Bash = MatchedHook<'tool.call', { readonly tool: 'Bash' }>
export type RtkMode = 'light' | 'full'

// The mode when COMPANY_RTK_MODE does not name one; the benchmark sets it (Task 18).
export const DEFAULT_MODE: RtkMode = 'light'
const RUN_MS = 2000
// rtk reads a repo's own filters only after `rtk trust`, which company never runs.
const FILTERS = '.rtk/filters.toml'

// This load's rtk: the binary the probe found (none: rtk rests), the mode, the last
// `rtk gain` total, whether this turn has read it, and whether a rewrite ran since the last read.
type Rt = { bin?: string; mode: RtkMode; gain?: number; gainRead: boolean; unread: boolean }

// A run that could not start because the binary is gone, not because rtk failed.
const missing = (err: unknown) => /ENOENT/.test(String(err))
// CI=false, 0 or empty is no CI.
const truthy = (v: string | undefined) => !!v && !/^(false|0|)$/i.test(v.trim())

export function registerRtk(on: On, ctx: Ctx): void {
  // shortcut: a hot reload fires no session.start, so rtk rests until the next session; probe on the first call if reloads matter in use.
  const rt: Rt = { mode: DEFAULT_MODE, gainRead: false, unread: false }
  on('session.start', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await rtkStart($, e, beneath(next), ctx, rt); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  // Observe only: a new turn may read `rtk gain` again.
  on('turn.start', (_, e, next) => {
    rt.gainRead = false
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    // No ok() here: rtkCall counts a timeout itself and goes on, and ok() would clear that streak.
    try { return await rtkCall($, e, beneath(next), ctx, rt) } catch (err) { fail(ctx, err); throw err }
  })
  // The last turn's rewrites: one more `rtk gain` read. Not awaited: the whole chain has 1.5 s,
  // and the host's final write has run already, so this write is best-effort.
  on('session.end', {}, ($, e, next) => {
    if (rt.unread && rt.bin !== undefined) void addGain($, ctx, rt, rt.bin).then(() => save($, ctx.shared))
    return next(e)
  })
}

// Before the modules beneath: CI turns rtk off; else the probe finds the binary, or rtk is off
// as not installed (not a failure).
async function rtkStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], ctx: Ctx, rt: Rt) {
  rt.bin = undefined
  rt.gain = undefined
  const unset = () => undefined
  if (truthy(await $.env.get('CI').catch(unset)) || truthy(await $.env.get('GITHUB_ACTIONS').catch(unset))) {
    setOff(ctx, 'cloud')
    noteOf(ctx, 'off: CI run')
    return next(e)
  }
  const mode = await $.env.get('COMPANY_RTK_MODE').catch(unset)
  rt.mode = mode === 'light' || mode === 'full' ? mode : DEFAULT_MODE
  const windows = await $.session.info().then((i) => i.platform === 'windows', () => false)
  // A binary that does not start is missing; one that times out or fails otherwise is a failure.
  let broke: unknown
  for (const bin of windows ? ['rtk', 'rtk.exe'] : ['rtk']) {
    const v = await $.process.run([bin, '--version'], { timeoutMs: RUN_MS }).catch((err: unknown) => {
      if (!missing(err)) broke ??= err
    })
    if (v && v.exitCode === 0 && /^rtk \d/.test(v.stdout)) {
      rt.bin = bin
      break
    }
  }
  if (rt.bin === undefined) {
    // rtk stays on with no binary, so it rests this session; the error shows in its health.
    if (broke !== undefined) fail(ctx, broke)
    else {
      setOff(ctx, 'not installed')
      noteOf(ctx, 'off: not installed')
    }
    return next(e)
  }
  // The start total, so the first turn's delta is this session's alone.
  rt.gain = await gainTotal($, rt.bin)
  if (await $.fs.exists(`${e.cwd}/${FILTERS}`).catch(() => false)) noteOf(ctx, `This repo has RTK filters in ${FILTERS}. Company does not trust them.`)
  return next(e)
}

async function rtkCall($: EngineInterface, e: Parameters<Bash>[1], next: Parameters<Bash>[2], ctx: Ctx, rt: Rt) {
  let cmd: string | null = null
  try {
    cmd = await rewrite($, e, ctx, rt)
  } catch (err) {
    // The command runs as typed. A binary gone since the probe is off as not installed;
    // a timeout or another refusal is one failure.
    if (missing(err)) {
      setOff(ctx, 'not installed')
      noteOf(ctx, 'off: not installed')
    } else fail(ctx, err)
  }
  if (cmd === null) return next(e)
  const r = await next({ ...e, command: cmd })
  acted(ctx)
  rt.unread = true
  if (!rt.gainRead && rt.bin !== undefined) {
    rt.gainRead = true
    await addGain($, ctx, rt, rt.bin)
  }
  void save($, ctx.shared)
  return r
}

// The rtk form of the call's command, or null to run it as typed. Throws only when rtk fails.
async function rewrite($: EngineInterface, e: Parameters<Bash>[1], ctx: Ctx, rt: Rt): Promise<string | null> {
  const cmd = e.command
  // `_host` names the person's machine (Remote Control): never touched. Read with no type: the
  // engine types have it only where the session has attached machines. Any value but none counts.
  const host = (e as { readonly _host?: unknown })._host
  const device = (host !== undefined && host !== null && host !== '') || isDeviceTool(e.tool)
  // Only a read-only command goes to rtk at all: a write never meets it.
  if (rt.bin === undefined || typeof cmd !== 'string' || device || !shouldTry(cmd) || !inMode(cmd, 'full')) return null
  // The tool's arguments as the permission check reads them.
  const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...args } = e
  // Permission first: a command that is denied or asks for a prompt stays as typed, and rtk is not run.
  if (!(await allowed($, args))) return null
  const run = await $.process.run([rt.bin, 'rewrite', '--', cmd], { timeoutMs: RUN_MS })
  ok(ctx)
  const out = acceptRewrite(cmd, run.stdout, run.exitCode)
  if (out === null || !inMode(out, rt.mode)) return null
  // Core checks the rewritten call: an allow rule for the command may not cover its rtk form.
  if (!(await allowed($, { ...args, command: out }))) {
    ctx.shared.skippedPermission += 1
    showStatus($, ctx.shared)
    return null
  }
  return out
}

// Allowed with no prompt. A check that rejects counts as a refusal.
async function allowed($: EngineInterface, input: object): Promise<boolean> {
  return $.tool.check({ tool: 'Bash', input }).then((v) => v.decision === 'allow', () => false)
}

// rtk's own count of the tokens it kept out (`rtk gain`, this project), or undefined.
async function gainTotal($: EngineInterface, bin: string): Promise<number | undefined> {
  try {
    const g = await $.process.run([bin, 'gain', '-f', 'json', '-p'], { timeoutMs: RUN_MS })
    const n: unknown = (JSON.parse(g.stdout) as { summary?: { total_saved?: unknown } }).summary?.total_saved
    return g.exitCode === 0 && typeof n === 'number' && Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

// The growth since the last read goes to `saved`. Best-effort: a failed read counts nothing.
// shortcut: `rtk gain -p` counts every rtk run in this project, a parallel session's too; per-session ids need rtk support.
async function addGain($: EngineInterface, ctx: Ctx, rt: Rt, bin: string): Promise<void> {
  const now = await gainTotal($, bin)
  if (now === undefined) return
  if (rt.gain !== undefined && now > rt.gain) saved(ctx, now - rt.gain)
  rt.gain = now
  rt.unread = false
}
