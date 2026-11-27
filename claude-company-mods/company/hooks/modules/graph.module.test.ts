import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared } from '../core'
import { LOCK_MS } from '../graphlock'
import { MODULE_META } from '.'
import { graphHint, graphStatus } from './graph'

const START = { cwd: '/repo/src', surface: 'terminal', isInteractive: true } as const
const END = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const
const T0 = 50_000_000
const LOCK = '/repo/graphify-out/.company.lock'
const EXCLUDE = '/repo/.git/info/exclude'
const GRAPH = '/repo/graphify-out/graph.json'
// graphify 0.9.120's two refusals to write a graph that lost nodes (watch.py).
const FEWER =
  '[graphify] WARNING: new graph has 5 nodes but existing graph.json has 9. Refusing to overwrite — you may be missing chunk files from a previous session. Pass --force to override.\n'
const SEMANTIC = '[graphify] WARNING: Refusing to overwrite — saved semantic node(s) are missing from the new graph: a, b.\n'
const PROVENANCE = '[graphify] WARNING: Refusing to overwrite — saved semantic provenance field(s) stripped from 2 node(s): a, b.\n'
const NOTHING = 'Nothing to update or rebuild failed — check output above.\n'
const UNREAD = `error: Cannot read ${GRAPH} for incremental merge: Expecting value: line 2 column 1 (char 12). Delete the file and run a full rebuild.\n${NOTHING}`
// `same`: graphify found no node or edge to change, so graph.json stays as it is.
type Run = { exitCode: number; stdout?: string; stderr?: string; same?: boolean }
type World = { git?: boolean; badWrite?: string; top?: Run; tracked?: string; graphify?: boolean; update?: () => Run | Promise<Run>; files?: Record<string, string>; links?: string[]; procs?: number[]; env?: Record<string, string> }

// The plugin's own graph runs. The hooks here stand for the engine beneath it: git, graphify,
// files, clock, notices, and $.state (read after session.end writes health and the ledger).
function world(on: On, o: World = {}) {
  mock.store(on)
  mock.env(on, o.env ?? {})
  mock.clock(on, { now: T0 })
  // The status line redraws after each graph run, an empty one too.
  let status = 0
  on('ui.status', () => (status++, { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('session.machine', () => ({ value: { sysname: 'Linux', release: '6.8.0', machine: 'x86_64', packageManagers: [], runtimes: [] } }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PID: '42' } }))
  const notices: string[] = []
  on('session.append', (_, e, next) => (notices.push(String((e.message.content as any)[0]?.text ?? '')), next(e)))
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    const was = held[e.key] ?? { value: undefined, version: 0 }
    held[e.key] = { value: e.value, version: was.version + 1 }
    return { value: { isSet: true, version: was.version + 1 } }
  })
  const read = (key: 'health' | 'ledger') => (held[key]?.value as { value: any } | undefined)?.value
  const files: Record<string, string> = { ...o.files }
  // Each write gives the file a newer time.
  const times: Record<string, number> = {}
  let tick = T0
  const links = new Set(o.links)
  const procs = o.procs ?? []
  const runs: { cmd: string; env?: Readonly<Record<string, string>> }[] = []
  const res = (r: Run) => ({ value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async (_, e) => {
    const cmd = e.argv.join(' ')
    runs.push({ cmd, env: e.init?.env })
    if (cmd === 'git rev-parse --show-toplevel') return res(o.top ?? { exitCode: 0, stdout: '/repo\n' })
    if (cmd === 'git ls-files graphify-out') return res({ exitCode: 0, stdout: o.tracked ?? '' })
    if (cmd === 'git rev-parse --git-path info/exclude') return res({ exitCode: 0, stdout: '.git/info/exclude\n' })
    if (o.graphify !== false && cmd === 'graphify --version') return res({ exitCode: 0, stdout: 'graphify 0.9.120\n' })
    if (o.graphify !== false && cmd === 'graphify update /repo') {
      const r: Run = await (o.update ?? (() => ({ exitCode: 0 })))()
      if (r.exitCode === 0 && !r.same) {
        files[GRAPH] = '{"nodes":[]}'
        times[GRAPH] = ++tick
      }
      return res(r)
    }
    return { deny: `spawn ${e.argv[0]} ENOENT` } as never
  })
  const enoent = (path: string) => ({ deny: `stat ${path} failed: ENOENT` }) as never
  // The entries right under a folder, from the file paths.
  const under = (dir: string) => {
    const seen = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, text] of Object.entries(files)) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name = '', ...rest] = path.slice(dir.length + 1).split('/')
      seen.set(name, { name, kind: rest.length ? 'dir' : 'file', size: rest.length ? 0 : text.length, mtimeMs: T0, isLink: false })
    }
    return [...seen.values()]
  }
  on('fs.stat', (_, e) => {
    if (links.has(e.path)) return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: true } }
    if (e.path in files) return { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: times[e.path] ?? T0, isLink: false } }
    return under(e.path).length ? { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } } : enoent(e.path)
  })
  on('fs.read', (_, e) => (e.path in files ? { value: files[e.path]! } : enoent(e.path)))
  const writes: string[] = []
  on('fs.write', (_, e) => {
    if (e.path === o.badWrite) return { deny: `open ${e.path} failed: EACCES` } as never
    files[e.path] = e.text
    times[e.path] = ++tick
    writes.push(e.path)
    return { value: undefined }
  })
  on('fs.list', (_, e) => ({ value: under(e.path) }))
  on('fs.exists', (_, e) => ({
    value: /^\/proc\/\d+$/.test(e.path) ? procs.includes(Number(e.path.slice(6))) : (o.git !== false && e.path === '/repo/.git') || e.path in files,
  }))
  const mine = () => runs.filter((r) => r.cmd.startsWith('git ') || r.cmd.startsWith('graphify '))
  const updates = () => runs.filter((r) => r.cmd.startsWith('graphify update')).length
  return { files, writes, runs, procs, notices, read, mine, updates, status: () => status }
}

// Lets the run a hook started and left (never awaited) go on.
async function settle(n = 3000) {
  for (let k = 0; k < n; k++) await Promise.resolve()
}

async function until(done: () => boolean) {
  for (let k = 0; k < 20000 && !done(); k++) await Promise.resolve()
  expect(done()).toBe(true)
}

function turn($: any, agentId?: string) {
  return $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) })
}

const lockOf = (pid: number, at: number, host = 'Linux 6.8.0') => JSON.stringify({ pid, at, host, session: 'other' })

test('graph: not a git repo turns the module off, and nothing runs', async ($, on) => {
  // No `.git` here or above: no git runs at all.
  const w = world(on, { git: false })
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'touch a' })
  await turn($)
  await settle()
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'not a repo', fails: 0 })
  expect(w.mine()).toEqual([])
  expect(w.writes).toEqual([])
  expect(w.notices.some((n) => n.includes('GRAPH'))).toBe(false)
})

test('graph: a .git that git does not take as a work tree is no repo either', async ($, on) => {
  const w = world(on, { top: { exitCode: 128, stderr: 'fatal: not a git repository' } })
  await $.session.start({ ...START })
  await turn($)
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'not a repo', fails: 0 })
  expect(w.mine().map((r) => r.cmd)).toEqual(['git rev-parse --show-toplevel'])
  expect(w.writes).toEqual([])
})

test('graph: a symbolic link at graphify-out is refused with a notice; nothing is written', async ($, on) => {
  const w = world(on, { links: ['/repo/graphify-out'] })
  await $.session.start({ ...START })
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'refused', fails: 0 })
  expect(w.notices).toContain('company · GRAPH · off: graphify-out is a link, so Company makes no graph')
  expect(w.mine().filter((r) => r.cmd.startsWith('graphify '))).toEqual([])
  expect(w.writes).toEqual([])
})

test('graph: a graphify-out that git tracks is refused; nothing is written', async ($, on) => {
  const w = world(on, { tracked: 'graphify-out/graph.json\n' })
  await $.session.start({ ...START })
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'refused', fails: 0 })
  expect(w.notices).toContain('company · GRAPH · off: git tracks graphify-out, so Company makes no graph')
  expect(w.mine().filter((r) => r.cmd.startsWith('graphify '))).toEqual([])
  expect(w.writes).toEqual([])
})

test('graph: a symbolic link at the exclude file is refused; no build', async ($, on) => {
  const w = world(on, { links: [EXCLUDE] })
  await $.session.start({ ...START })
  await settle()
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'refused' })
  expect(w.updates()).toBe(0)
  expect(w.writes).toEqual([])
})

test('graph: no graphify is off as not installed, not a failure; the exclude file stays', async ($, on) => {
  const w = world(on, { graphify: false, files: { [EXCLUDE]: '*.o\n' } })
  await $.session.start({ ...START })
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'not installed', fails: 0 })
  expect(w.writes).toEqual([])
})

test('graph: a CI run turns the module off; no git, no graphify', async ($, on) => {
  const w = world(on, { env: { GITHUB_ACTIONS: 'true' } })
  await $.session.start({ ...START })
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: false, off: 'cloud' })
  expect(w.mine()).toEqual([])
})

test('graph: the first build runs at session start, detached, LLM-free, under the lock; the exclude line goes in once', async ($, on) => {
  let held = ''
  let release: (() => void) | undefined
  const w = world(on, {
    files: { [EXCLUDE]: '# user\n*.o' },
    update: () => {
      held = w.files[LOCK] ?? ''
      // The first build waits for the test; later ones end at once.
      return release ? { exitCode: 0 } : new Promise<Run>((r) => (release = () => r({ exitCode: 0 })))
    },
  })
  // session.start returns while the build still runs.
  await $.session.start({ ...START })
  await until(() => release !== undefined)
  expect(w.files[GRAPH]).toBeUndefined()
  release!()
  await until(() => w.files[LOCK] === '')
  await settle()
  const up = w.runs.filter((r) => r.cmd.startsWith('graphify update'))
  expect(up.map((r) => r.cmd)).toEqual(['graphify update /repo'])
  expect(up[0]!.env).toMatchObject({
    GRAPHIFY_BACKEND: 'none', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', AWS_PROFILE: '', OLLAMA_HOST: '', GRAPHIFY_FORCE: '', GRAPHIFY_OUT: '',
    // graphify rewrites its skill copies under the home and working folders unless this is set.
    GRAPHIFY_NO_AUTO_REFRESH: '1',
  })
  expect(w.files[EXCLUDE]).toBe('# user\n*.o\ngraphify-out/\n')
  // The lock named this process while the run went on, and is free after it.
  expect(JSON.parse(held)).toMatchObject({ pid: 42, at: T0, host: 'Linux 6.8.0' })
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
  expect(w.read('ledger').graph.acted).toBe(1)
  // A second session: the exclude line is there, so the file is not written again.
  await $.session.start({ ...START })
  await until(() => w.updates() === 2)
  await settle()
  expect(w.writes.filter((p) => p === EXCLUDE)).toHaveLength(1)
})

test('graph: a graph with more nodes stays (graphify refuses the smaller one): kept, one notice, no more runs this session, never --force', async ($, on) => {
  const w = world(on, { files: { [GRAPH]: '{"nodes":[1,2,3,4,5,6,7,8,9]}' }, update: () => ({ exitCode: 1, stderr: FEWER + NOTHING }) })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  // graphify would redo the same work and refuse again: no run at the next turn ends.
  for (const s of ['b', 'c']) {
    await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: s })
    await turn($)
    await settle()
  }
  expect(w.updates()).toBe(1)
  expect(w.notices.filter((n) => n.startsWith('company · GRAPH · kept:'))).toEqual(['company · GRAPH · kept: graphify keeps the old graph; the new one lacks some of its nodes'])
  expect(w.files[GRAPH]).toBe('{"nodes":[1,2,3,4,5,6,7,8,9]}')
  expect(w.runs.some((r) => r.cmd.includes('--force'))).toBe(false)
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
  expect(w.read('ledger')?.graph?.acted ?? 0).toBe(0)
  // The next session tries once more.
  await $.session.start({ ...START })
  await until(() => w.updates() === 2)
})

test('graph: saved LLM nodes the AST-only run lacks: kept too', async ($, on) => {
  const w = world(on, { files: { [GRAPH]: '{"nodes":[1]}' }, update: () => ({ exitCode: 1, stderr: SEMANTIC + NOTHING }) })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  expect(w.notices).toContain('company · GRAPH · kept: graphify keeps the old graph; the new one lacks some of its nodes')
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
})

test('graph: saved LLM provenance the AST-only run strips: kept too, not a failure', async ($, on) => {
  const w = world(on, { files: { [GRAPH]: '{"nodes":[1]}' }, update: () => ({ exitCode: 1, stderr: PROVENANCE + NOTHING }) })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  expect(w.notices).toContain('company · GRAPH · kept: graphify keeps the old graph; the new one lacks some of its nodes')
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
})

test('graph: an old graph.json graphify cannot read is a failure with a notice, not kept; so is any other exit', async ($, on) => {
  const answers: Run[] = [{ exitCode: 1, stderr: UNREAD }, { exitCode: 2, stderr: 'Traceback\nValueError: bad\n' }]
  const w = world(on, { files: { [GRAPH]: '{"nodes": [' }, update: () => answers.shift()! })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  expect(w.notices).toContain('company · GRAPH · graphify cannot read graphify-out/graph.json. Delete it to build it again.')
  expect(w.notices.some((n) => n.includes('kept:'))).toBe(false)
  // Not kept, so the next turn end with an edit runs again.
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await turn($)
  await until(() => w.updates() === 2 && w.files[LOCK] === '')
  await settle()
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 2, lastErr: 'Error: graphify update exit 2: ValueError: bad' })
  expect(w.files[GRAPH]).toBe('{"nodes": [')
})

test('graph: a repo with no code files is a skip: no failure, no action, no notice', async ($, on) => {
  const w = world(on, { update: () => ({ exitCode: 1, stdout: '[graphify watch] No code files found - nothing to rebuild.\n', stderr: NOTHING }) })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
  expect(w.read('ledger')?.graph?.acted ?? 0).toBe(0)
  expect(w.notices.some((n) => n.includes('GRAPH'))).toBe(false)
})

test('graph: an update that changes no node or edge is not counted as an action', async ($, on) => {
  const answers: Run[] = [{ exitCode: 0 }, { exitCode: 0, same: true }]
  const w = world(on, { update: () => answers.shift()! })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  await $.tool.call({ tool: 'Bash', command: 'echo x' })
  await turn($)
  await until(() => w.updates() === 2 && w.files[LOCK] === '')
  await settle()
  await $.session.end({ ...END })
  expect(w.read('ledger').graph.acted).toBe(1)
})

test('graph: a fault while the exclude file is written leaves the graph idle: one failure, no runs', async ($, on) => {
  const w = world(on, { badWrite: EXCLUDE })
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'touch a' })
  await settle()
  // No run starts at the turn end, not even one that stops at once.
  const drawn = w.status()
  await turn($)
  await settle()
  expect(w.status()).toBe(drawn)
  expect(w.updates()).toBe(0)
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 1 })
  expect(w.read('health').graph.lastErr).toContain('EACCES')
})

test('graph: a lock another session took over during the run stays when the run ends', async ($, on) => {
  const other = lockOf(9, T0, 'Linux 6.8.0')
  const w = world(on, {
    update: () => {
      w.files[LOCK] = other
      return { exitCode: 0 }
    },
  })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1)
  await settle()
  expect(w.files[LOCK]).toBe(other)
})

test('graph: two turn ends during a run give exactly 2 runs in all; a turn with no file tool runs nothing', async ($, on) => {
  const gates: Array<() => void> = []
  const w = world(on, { update: () => new Promise<Run>((r) => gates.push(() => r({ exitCode: 0 }))) })
  await $.session.start({ ...START })
  await until(() => gates.length === 1)
  await $.tool.call({ tool: 'Bash', command: 'touch a' })
  await turn($)
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  await turn($)
  gates[0]!()
  await until(() => gates.length === 2)
  gates[1]!()
  await settle()
  expect(w.updates()).toBe(2)
  // No file tool this turn; then a subagent's turn end after a write: no run either.
  await turn($)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb', new_source: 'x' } as never)
  await turn($, 'a1')
  await settle()
  expect(w.updates()).toBe(2)
  // The main loop's turn end takes that write.
  await turn($)
  await until(() => gates.length === 3)
  gates[2]!()
  await settle()
  expect(w.updates()).toBe(3)
})

test('graph: a live lock of another process blocks the run; once that process is gone, the lock is taken over', async ($, on) => {
  const w = world(on, { files: { [LOCK]: lockOf(7, T0 - 1000) }, procs: [7] })
  await $.session.start({ ...START })
  await settle()
  expect(w.updates()).toBe(0)
  expect(w.files[LOCK]).toBe(lockOf(7, T0 - 1000))
  // Process 7 ends; the blocked request runs at the next turn end, with no file tool in it.
  w.procs.length = 0
  await turn($)
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  await $.session.end({ ...END })
  expect(w.read('health').graph).toMatchObject({ on: true, fails: 0 })
})

test('graph: a lock older than 15 min is taken over; a fresh one from another machine holds', async ($, on) => {
  const w = world(on, { files: { [LOCK]: lockOf(7, T0 - LOCK_MS - 1) }, procs: [7] })
  await $.session.start({ ...START })
  await until(() => w.updates() === 1 && w.files[LOCK] === '')
  await settle()
  // A Windows session on the same repo: its pid means nothing here, so only the 15 min bound frees it.
  w.files[LOCK] = lockOf(7, T0 - 1000, 'Windows_NT 10.0.22631')
  w.procs.length = 0
  await $.tool.call({ tool: 'Bash', command: 'touch a' })
  await turn($)
  await settle()
  expect(w.updates()).toBe(1)
})

test('graph status: building, updating, ready, kept, none, or off with its reason', () => {
  const h = createShared(MODULE_META.map((m) => m.id)).health.graph
  expect(graphStatus(h, { running: true })).toEqual({ state: 'building', reason: undefined, builtAt: undefined, bytes: undefined })
  expect(graphStatus(h, { running: true, builtAt: T0, bytes: 12 }).state).toBe('updating')
  expect(graphStatus(h, { running: false, builtAt: T0, bytes: 12 })).toEqual({ state: 'ready', reason: undefined, builtAt: T0, bytes: 12 })
  expect(graphStatus(h, { running: false }).state).toBe('none')
  expect(graphStatus(h, { running: false, builtAt: T0, kept: true }).state).toBe('kept')
  expect(graphStatus({ ...h, on: false, off: 'not installed' }, { running: false })).toMatchObject({ state: 'off', reason: 'not installed' })
})

test('graph: the hint is one line of at most 320 chars, and only with a graph', () => {
  const hint = graphHint(true)
  expect(hint).toBe('Code graph: run `graphify query "<question>" --budget 1500` or `graphify explain "<name>"` before a broad search. Never read graphify-out files whole.')
  expect(hint.length).toBeLessThanOrEqual(320)
  expect(graphHint(false)).toBe('')
})
