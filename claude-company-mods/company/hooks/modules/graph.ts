// Graph: builds a code graph of the git project with graphify, then keeps it up to date as files
// change. No LLM: graphify runs AST-only (GRAPHIFY_BACKEND=none, every API key variable empty).
// Runs start with `void` and are never awaited, so no hook waits for one; one runs at a time per
// repo (a lock file in graphify-out); never with --force, so a bigger graph the person made stays.
// Each miss (no repo, no graphify, a refusal, a git fault) turns the module off or counts one
// failure, and never throws: a throw would take the other company hooks on session.start with it.
import type { EngineInterface, Hook, MatchedHook, On } from 'claude-code'
import { acted, beneath, fail, isOn, missing, noteOf, ok, setOff, truthy, type Ctx, type Health, type OffReason, type Shared } from '../core'
import { bare, firstBin, graphifyPaths } from '../bins'
import { excludeWithLine, lockState } from '../graphlock'
import { showStatus } from '../host'
import { ready, save } from '../persist'

type Start = MatchedHook<'session.start', {}>
type Complete = Hook<'turn.complete'>
// Who holds the lock: the Claude process (CLAUDE_PID), its machine and session, and when it took it.
type Lock = { pid: number; at: number; host: string; session: string }
// This load's graph: the repo root and binary (none: the graph rests), this process as a lock
// holder, and whether a request came during a run or met another session's lock.
type Gr = { root?: string; bin?: string; me: Omit<Lock, 'at'>; dirty: boolean }

const GIT_MS = 5000
const PROBE_MS = 5000
const VERSION = /^graphify \d/
// The engine's longest run: graphify's own bound.
const RUN_MS = 600_000
const OUT = 'graphify-out'
const LOCK = '.company.lock'
// What graphify 0.9.120 reads to pick an LLM backend (graphify.llm.backend_detection_env_vars):
// all empty, and the backend none. GRAPHIFY_FORCE and GRAPHIFY_OUT empty too: no forced shrink,
// and the output stays in <root>/graphify-out. GRAPHIFY_NO_AUTO_REFRESH: graphify rewrites its
// skill copies in the home and the working folders at each command otherwise.
const KEYS = [
  'ANTHROPIC_API_KEY', 'MOONSHOT_API_KEY', 'OLLAMA_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY',
  'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'OLLAMA_BASE_URL', 'OLLAMA_HOST',
  'GRAPHIFY_FORCE', 'GRAPHIFY_OUT',
]
const ENV: Record<string, string> = { ...Object.fromEntries(KEYS.map((k) => [k, ''])), GRAPHIFY_BACKEND: 'none', GRAPHIFY_NO_AUTO_REFRESH: '1' }
// graphify 0.9.120's answers that need care (watch.py): a refusal to write a graph that lost nodes
// (the person's own, maybe with LLM nodes), an old graph.json it cannot read, and no code to graph.
const KEPT = /new graph has \d+ nodes but existing|saved semantic node\(s\) are missing|provenance field\(s\) stripped/
const UNREAD = /Cannot read .*graph\.json|could not be read to verify/
const NO_CODE = /No code files found/

// The line for the charter and the diet block (spec 7.2), only when graph.json exists.
export function graphHint(hasGraph: boolean): string {
  return hasGraph
    ? 'Code graph: run `graphify query "<question>" --budget 1500` or `graphify explain "<name>"` before a broad search. Never read graphify-out files whole.'
    : ''
}

export type GraphState = 'building' | 'updating' | 'ready' | 'kept' | 'none' | 'off'
// What the dashboard shows: building (no graph yet), updating, ready, kept (graphify keeps the old
// graph; no updates this session), none (no graph and no run), or off with its reason; the time
// of graph.json and the bytes in graphify-out.
export function graphStatus(h: Health, g: Shared['graph']): { state: GraphState; reason?: OffReason; builtAt?: number; bytes?: number } {
  const state: GraphState = !h.on
    ? 'off'
    : g.kept
      ? 'kept'
      : g.running
        ? g.builtAt === undefined ? 'building' : 'updating'
        : g.builtAt === undefined ? 'none' : 'ready'
  return { state, reason: h.off, builtAt: g.builtAt, bytes: g.bytes }
}

export function registerGraph(on: On, ctx: Ctx): void {
  // shortcut: a hot reload fires no session.start, so the graph rests until the next session; set it up at the first turn end if reloads matter in use.
  const gr: Gr = { me: { pid: 0, host: '', session: '' }, dirty: false }
  on('session.start', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    // No ok() here: setup calls it once graphify answers, so a hung probe builds the streak.
    try { return await graphStart($, e, beneath(next), ctx, gr) } catch (err) { fail(ctx, err); throw err }
  })
  // Observe only: a tool that can change files marks the turn, a subagent's too.
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    await ready($, ctx.shared)
    ctx.shared.touched = true
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    // No ok() here: each run calls it when graphify answers, so failed runs build the streak.
    try { return await graphComplete($, e, beneath(next), ctx, gr) } catch (err) { fail(ctx, err); throw err }
  })
}

// Before the modules beneath. Never throws for a miss: a fault in setup is one failure, and the
// session starts.
async function graphStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], ctx: Ctx, gr: Gr) {
  gr.root = gr.bin = undefined
  ctx.shared.graph.kept = false
  await setup($, e.cwd, ctx, gr).catch((err: unknown) => fail(ctx, err))
  return next(e)
}

// CI, no repo, no graphify and each refusal turn the graph off; else the exclude file gets its
// line and the first build starts. The root and binary are set last, so a fault on the way leaves
// the graph idle.
async function setup($: EngineInterface, cwd: string, ctx: Ctx, gr: Gr): Promise<void> {
  const unset = () => undefined
  const refuse = (why: string) => {
    setOff(ctx, 'refused')
    noteOf(ctx, `off: ${why}, so Company makes no graph`)
  }
  if (truthy(await $.env.get('CI').catch(unset)) || truthy(await $.env.get('GITHUB_ACTIONS').catch(unset))) {
    setOff(ctx, 'cloud')
    noteOf(ctx, 'off: CI run')
    return
  }
  // No `.git` here or above, no git, or a folder outside a work tree: no repo. A git that hangs is a failure.
  const top = (await inGit($, cwd))
    ? await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: GIT_MS }).catch((err: unknown) => {
        if (!missing(err)) throw err
      })
    : undefined
  const root = top?.exitCode === 0 ? top.stdout.trim() : ''
  if (!root) return setOff(ctx, 'not a repo')
  const out = `${root}/${OUT}`
  if (await linked($, out)) return refuse('graphify-out is a link')
  const tracked = await $.process.run(['git', 'ls-files', OUT], { cwd: root, timeoutMs: GIT_MS })
  if (tracked.exitCode !== 0) throw new Error(`git ls-files exit ${tracked.exitCode}`)
  if (tracked.stdout.trim()) return refuse('git tracks graphify-out')
  const machine = await $.session.machine().catch(unset)
  // A binary that does not start is missing; one that times out or fails otherwise is a failure.
  // Not on the PATH: the full path where uv, pipx or pip put it, used for every later run.
  const win = machine?.sysname === 'Windows_NT'
  const onPath = await firstBin($, bare('graphify', win), VERSION, PROBE_MS)
  const found = onPath.bin !== undefined ? onPath : await firstBin($, await graphifyPaths($, win), VERSION, PROBE_MS)
  const bin = found.bin
  if (bin === undefined) {
    const broke = onPath.broke ?? found.broke
    if (broke !== undefined) throw broke
    setOff(ctx, 'not installed')
    noteOf(ctx, 'off: not installed')
    return
  }
  ok(ctx)
  // The exclude file keeps graphify-out out of `git status`; written only through no link.
  const gp = await $.process.run(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: root, timeoutMs: GIT_MS })
  const path = gp.stdout.trim()
  if (gp.exitCode !== 0 || !path) throw new Error(`git rev-parse --git-path exit ${gp.exitCode}`)
  const exclude = /^([A-Za-z]:)?[\\/]/.test(path) ? path : `${root}/${path}`
  if (await linked($, exclude)) return refuse('the git exclude file is a link')
  const text = await $.fs.read(exclude).catch((err: unknown) => {
    if (missing(err)) return ''
    throw err
  })
  const added = excludeWithLine(text, `${OUT}/`)
  if (added !== null) await $.fs.write(exclude, added)
  gr.me = {
    pid: Number((await $.process.hookEnv().catch(unset))?.CLAUDE_PID) || 0,
    host: machine ? `${machine.sysname} ${machine.release}` : '',
    session: await $.session.id().catch(() => ''),
  }
  ctx.shared.graph.builtAt = await builtAt($, out)
  gr.root = root
  gr.bin = bin
  request($, ctx, gr)
}

// The main loop's turn end updates the graph when a tool could have changed files, or a request
// met another session's lock. A subagent's turn end leaves its mark for the main loop's.
async function graphComplete($: EngineInterface, e: Parameters<Complete>[1], next: Parameters<Complete>[2], ctx: Ctx, gr: Gr) {
  if (e.agentId === undefined && gr.bin !== undefined && (ctx.shared.touched || gr.dirty)) {
    ctx.shared.touched = false
    request($, ctx, gr)
  }
  return next(e)
}

// One run at a time: a request during a run marks dirty, and one more run follows. Never awaited.
// After graphify kept the old graph, none: each later run would redo the same work, refused again.
function request($: EngineInterface, ctx: Ctx, gr: Gr): void {
  if (ctx.shared.graph.kept) return
  if (ctx.shared.graph.running) {
    gr.dirty = true
    return
  }
  ctx.shared.graph.running = true
  void runs($, ctx, gr)
}

// Never rejects: an error here is the module's failure.
async function runs($: EngineInterface, ctx: Ctx, gr: Gr): Promise<void> {
  try {
    do {
      gr.dirty = false
    } while (isOn(ctx) && (await runOnce($, ctx, gr)) && gr.dirty && !ctx.shared.graph.kept)
  } catch (err) {
    fail(ctx, err)
  } finally {
    ctx.shared.graph.running = false
    // The pane shows the new state, and the notes post where no pane shows.
    showStatus($, ctx.shared)
    void save($, ctx.shared)
  }
}

// One `graphify update <root>` under the repo's lock. False when no run happened: another live
// run holds the lock (dirty, so a later turn end tries again), or the module is off.
async function runOnce($: EngineInterface, ctx: Ctx, gr: Gr): Promise<boolean> {
  const { root, bin } = gr
  if (root === undefined || bin === undefined) return false
  const out = `${root}/${OUT}`
  const lockPath = `${out}/${LOCK}`
  // A link made since the start would take the lock write out of the project.
  if ((await linked($, out)) || (await linked($, lockPath))) {
    setOff(ctx, 'refused')
    noteOf(ctx, 'off: graphify-out is a link, so Company makes no graph')
    return false
  }
  const now = await $.clock.now()
  const lock = await readLock($, lockPath)
  if (lockState(lock, now, lock !== null && (await alive($, lock, gr.me))) === 'held') {
    gr.dirty = true
    return false
  }
  // shortcut: read then write is not atomic, so two sessions in the same instant both run; graphify's own file lock queues the second. Take the lock by an exclusive create if the engine gets one.
  const mine = JSON.stringify({ ...gr.me, at: now })
  await $.fs.write(lockPath, mine)
  try {
    const was = ctx.shared.graph.builtAt
    const r = await $.process.run([bin, 'update', root], { cwd: root, env: ENV, timeoutMs: RUN_MS })
    const said = `${r.stdout}\n${r.stderr}`
    if (r.exitCode === 0) {
      ok(ctx)
      // graphify leaves graph.json as it is when no node or edge changed.
      ctx.shared.graph.builtAt = await builtAt($, out)
      if (ctx.shared.graph.builtAt !== was) acted(ctx)
    } else if (NO_CODE.test(said)) {
      // No code and no graph yet: nothing to graph, not a fault.
      ok(ctx)
    } else if (KEPT.test(said)) {
      // A graph with more nodes, or with LLM nodes the AST-only run lacks (the person's own run).
      ok(ctx)
      ctx.shared.graph.kept = true
      noteOf(ctx, 'kept: graphify keeps the old graph; the new one lacks some of its nodes')
    } else {
      if (UNREAD.test(said)) noteOf(ctx, 'graphify cannot read graphify-out/graph.json. Delete it to build it again.')
      fail(ctx, new Error(`graphify update exit ${r.exitCode}: ${r.stderr.trim().split('\n').pop() ?? ''}`))
    }
  } catch (err) {
    // A binary gone since the probe is off as not installed; a timeout is a failure. graphify
    // writes graph.json in one step, so the old graph stays either way.
    if (missing(err)) {
      setOff(ctx, 'not installed')
      noteOf(ctx, 'off: not installed')
    } else fail(ctx, err)
  } finally {
    // Free only a lock that is still this run's: another session may have taken it as stale.
    if ((await $.fs.read(lockPath).catch(() => '')) === mine) await $.fs.write(lockPath, '').catch(() => {})
    ctx.shared.graph.bytes = await diskUse($, out).catch(() => undefined)
  }
  return true
}

// git's own search, with no process: a `.git` (a folder, or a worktree's file) here or above.
async function inGit($: EngineInterface, dir: string): Promise<boolean> {
  for (let d = dir; d; d = d.slice(0, Math.max(0, d.lastIndexOf('/'), d.lastIndexOf('\\')))) {
    if (await $.fs.exists(`${d}/.git`).catch(() => false)) return true
  }
  return false
}

// A symbolic link, or a path that cannot be looked at: never written through. Not there is fine.
async function linked($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.stat(path).then((s) => s.isLink, (err: unknown) => !missing(err))
}

async function builtAt($: EngineInterface, out: string): Promise<number | undefined> {
  return $.fs.stat(`${out}/graph.json`).then((s) => s.mtimeMs, () => undefined)
}

// An empty, unreadable or odd lock file is no lock.
async function readLock($: EngineInterface, path: string): Promise<Lock | null> {
  try {
    const v = JSON.parse(await $.fs.read(path)) as Partial<Lock> | null
    return typeof v?.pid === 'number' && typeof v.at === 'number' && typeof v.host === 'string' ? (v as Lock) : null
  } catch {
    return null
  }
}

// Whether the lock's holder may still run. On Linux (WSL too) its /proc entry tells. A lock from
// another machine (a Windows and a WSL session on one repo), macOS, or no pid: live, so the
// 15 min bound decides.
// shortcut: two containers on one kernel share `host` but not pids, so one reads the other's live run as gone; graphify's own flock still keeps their writes apart.
async function alive($: EngineInterface, lock: Lock, me: Gr['me']): Promise<boolean> {
  if (lock.host !== me.host || !me.host.startsWith('Linux ') || !(lock.pid > 0)) return true
  return $.fs.exists(`/proc/${lock.pid}`).catch(() => true)
}

// Bytes in a folder, as `du` sums them; links are not followed.
async function diskUse($: EngineInterface, dir: string): Promise<number> {
  let sum = 0
  for (const f of await $.fs.list(dir)) {
    if (f.isLink) continue
    if (f.kind === 'file') sum += f.size
    else if (f.kind === 'dir') sum += await diskUse($, `${dir}/${f.name}`)
  }
  return sum
}
