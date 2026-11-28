import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const END = { reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as const
const TIMEOUT = 'process.run timed out after 2000 ms'

type Rewrite = (cmd: string) => { stdout: string; exitCode: number } | 'timeout'
// rtk's own answer for the commands these tests use: git, grep and false at a command start get
// `rtk ` (exit 3); anything else has no rewrite (exit 1).
const RTK_REWRITE: Rewrite = (cmd) => {
  const out = cmd.replace(/(^|&& |\| )(git|grep|false)\b/g, '$1rtk $2')
  return out === cmd ? { stdout: '', exitCode: 1 } : { stdout: `${out}\n`, exitCode: 3 }
}

// Hooks here stand for the engine beneath the plugin.
function quiet(on: On, env: Record<string, string> = {}) {
  mock.store(on)
  mock.env(on, env)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
}

// The rtk binary: `--version` (null: not installed; 'timeout': it hangs), `rewrite` and `gain`
// (its totals, in turn). A refusal rejects the caller's run, as the engine's timeout and a
// binary that does not start do.
function rtk(on: On, o: { version?: string | null; rewrite?: Rewrite; gain?: number[]; bin?: string; gone?: () => boolean } = {}) {
  const runs: string[][] = []
  const timeouts: Array<number | undefined> = []
  let g = 0
  const res = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    timeouts.push(e.init?.timeoutMs)
    if (argv[0] !== (o.bin ?? 'rtk') || o.version === null || o.gone?.()) return { deny: `spawn ${argv[0]} ENOENT` } as never
    if (argv[1] === '--version') return o.version === 'timeout' ? ({ deny: TIMEOUT } as never) : res(o.version ?? 'rtk 1.2.1\n')
    if (argv[1] === 'gain') return res(JSON.stringify({ summary: { total_commands: 1, total_saved: o.gain?.[Math.min(g++, o.gain.length - 1)] ?? 0 } }))
    if (argv[1] === 'rewrite' && argv[2] === '--') {
      const r = (o.rewrite ?? RTK_REWRITE)(argv[3]!)
      if (r === 'timeout') return { deny: TIMEOUT } as never
      return res(r.stdout, r.exitCode)
    }
    throw new Error(`unexpected rtk call: ${argv.join(' ')}`)
  })
  return { runs, timeouts, rewrites: () => runs.filter((a) => a[1] === 'rewrite').map((a) => a[3]) }
}

// Lets work a hook left unawaited (session end's gain read) run to its end.
async function settle() {
  for (let k = 0; k < 100; k++) await Promise.resolve()
}

// The permission check: `decide` answers per command. `asked` keeps the commands a plugin's
// query checked (no tool_use_id); core's own check of the call that runs is not in it.
function perms(on: On, decide: (cmd: string) => 'allow' | 'ask' | 'deny' = () => 'allow') {
  const asked: string[] = []
  on('tool.check', { tool: 'Bash' }, (_, e) => {
    const c = (e.input as { command: string }).command
    if (e.tool_use_id === undefined) asked.push(c)
    return { decision: decide(c) }
  })
  return asked
}

// The Bash tool: keeps each command that reaches it.
function bash(on: On, stdout = 'ok\n') {
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.push(e.command)
    return { result: { stdout, stderr: '', interrupted: false } } as never
  })
  return seen
}

// $.state for company over an object the test reads: session.end writes health and the ledger there.
function state(on: On) {
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    const was = held[e.key] ?? { value: undefined, version: 0 }
    held[e.key] = { value: e.value, version: was.version + 1 }
    return { value: { isSet: true, version: was.version + 1 } }
  })
  return (key: 'health' | 'ledger' | 'panel') => (held[key]?.value as { value: any } | undefined)?.value
}

test('a rewrite runs the rtk form; rtk gain is read once per turn and at session end, and its growth counts as saved', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on, { gain: [100, 130, 150, 170] })
  const asked = perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'cd x && git log -5', agentId: 'a1' })
  await $.turn.start({ text: 'next', turnId: 't2' })
  await $.tool.call({ tool: 'Bash', command: 'git diff --stat' })
  // Piped: left as typed, and rtk is not even asked.
  await $.tool.call({ tool: 'Bash', command: 'git diff | head -50' })
  await $.tool.call({ tool: 'Bash', command: 'git show HEAD' })
  expect(seen).toEqual(['rtk git status', 'cd x && rtk git log -5', 'rtk git diff --stat', 'git diff | head -50', 'rtk git show HEAD'])
  expect(r.rewrites()).toEqual(['git status', 'cd x && git log -5', 'git diff --stat', 'git show HEAD'])
  // Only the original is queried; the rtk form gets core's own check of the call (per-call check).
  expect(asked).toEqual(['git status', 'cd x && git log -5', 'git diff --stat', 'git show HEAD'])
  // The start total, then one read per turn with a rewrite.
  expect(r.runs.filter((a) => a[1] === 'gain')).toHaveLength(3)
  expect(new Set(r.timeouts)).toEqual(new Set([2000]))
  // `git show HEAD` ran after this turn's read: session end reads once more.
  await $.session.end({ ...END })
  await settle()
  expect(r.runs.filter((a) => a[1] === 'gain')).toEqual(Array(4).fill(['rtk', 'gain', '-f', 'json', '-p']))
  expect(read('ledger').rtk).toEqual({ added: 0, saved: 70, acted: 4 })
  expect(read('health').rtk).toMatchObject({ on: true, fails: 0 })
})

test('session end reads no gain when every rewrite was counted', async ($, on) => {
  quiet(on)
  const r = rtk(on, { gain: [100, 130] })
  perms(on)
  bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.session.end({ ...END })
  await settle()
  expect(r.runs.filter((a) => a[1] === 'gain')).toHaveLength(2)
})

test('a deny rule on the original: rtk is not run, and core refuses the command as typed', async ($, on) => {
  quiet(on)
  const r = rtk(on, { rewrite: (c) => ({ stdout: `rtk ${c}`, exitCode: 3 }) })
  // Only the plain form is denied, as `Bash(git log:*)` is: the rtk form would slip past it.
  const asked = perms(on, (c) => (c.startsWith('git log') ? 'deny' : 'allow'))
  const seen = bash(on)
  await $.session.start({ ...START })
  const got = await $.tool.call({ tool: 'Bash', command: 'git log -5' })
  expect(got.isError).toBe(true)
  expect(seen).toEqual([])
  expect(asked).toEqual(['git log -5'])
  expect(r.rewrites()).toEqual([])
})

// The engine's check of real calls (with a tool_use_id): `decide` answers; `ids` keeps each id per command.
function core(on: On, decide: (cmd: string, id?: string) => 'allow' | 'ask' | 'deny') {
  const ids: Record<string, string> = {}
  on('tool.check', { tool: 'Bash' }, (_, e) => {
    const c = (e.input as { command: string }).command
    if (e.tool_use_id !== undefined) ids[c] = e.tool_use_id
    return { decision: decide(c, e.tool_use_id) }
  })
  return ids
}

test('per-call check: core asks on the rtk form of an allowed original; that one call is allowed, nothing else', async ($, on) => {
  quiet(on)
  rtk(on)
  // No allow rule covers the rtk form, so core asks (the original is allowed).
  let later: 'allow' | 'ask' | 'deny' = 'ask'
  const ids = core(on, (c, id) => (!c.startsWith('rtk ') ? 'allow' : id === undefined ? 'allow' : later))
  // The Bash tool runs only a call core let through.
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => (seen.push(e.command), { result: { stdout: 'ok\n', stderr: '', interrupted: false } }) as never)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['rtk git status'])
  const id = ids['rtk git status']!
  const check = (command: string, tool_use_id?: string) => $.tool.check({ tool: 'Bash', input: { command }, ...(tool_use_id ? { tool_use_id } : {}) } as never)
  // Used once: the same id again, another id, a command changed beneath, an rtk command nobody rewrote.
  expect((await check('rtk git status', id)).decision).toBe('ask')
  expect((await check('rtk git status', 'other-id')).decision).toBe('ask')
  expect((await check('rtk git log -5', 'typed-id')).decision).toBe('ask')
  // A deny stays a deny, on a recorded rewrite too.
  later = 'deny'
  const got = await $.tool.call({ tool: 'Bash', command: 'git log -5' })
  expect(got.isError).toBe(true)
  expect(seen).toEqual(['rtk git status'])
})

test('per-call check: a recorded rewrite whose command changed beneath, or with another id, stays an ask', async ($, on) => {
  quiet(on)
  rtk(on)
  // The rtk form is allowed during the call (an rtk rule of the person's), so the record stays unused.
  let rule = true
  const ids = core(on, (c) => (!c.startsWith('rtk ') || rule ? 'allow' : 'ask'))
  bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  rule = false
  const id = ids['rtk git status']!
  const check = (command: string, tool_use_id: string) => $.tool.check({ tool: 'Bash', input: { command }, tool_use_id } as never)
  expect((await check('rtk git status --short', id)).decision).toBe('ask')
  expect((await check('rtk git status', 'other-id')).decision).toBe('ask')
  expect((await check('rtk git status', id)).decision).toBe('allow')
})

test('rtk missing: off as not installed, not a failure, and commands run as typed', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on, { version: null })
  const asked = perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status'])
  expect(r.runs).toEqual([['rtk', '--version']])
  expect(asked).toEqual([])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed', fails: 0 })
})

test('a --version that times out is a failure, not missing; rtk then rests', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on, { version: 'timeout' })
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status'])
  expect(r.rewrites()).toEqual([])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: true, fails: 1, lastErr: expect.stringContaining(TIMEOUT) })
})

test('a --version that hangs in three sessions in a row turns rtk off', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on, { version: 'timeout' })
  for (let n = 0; n < 4; n++) await $.session.start({ ...START })
  // Off after the third: the fourth start never probes.
  expect(r.runs).toEqual(Array(3).fill(['rtk', '--version']))
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'errors', fails: 3, streak: 3 })
})

test('a binary gone in mid-session: off as not installed, not a failure', async ($, on) => {
  quiet(on)
  const read = state(on)
  let gone = false
  const r = rtk(on, { gone: () => gone })
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  gone = true
  await $.tool.call({ tool: 'Bash', command: 'git log -5' })
  await $.tool.call({ tool: 'Bash', command: 'git diff' })
  expect(seen).toEqual(['rtk git status', 'git log -5', 'git diff'])
  expect(r.rewrites()).toEqual(['git status', 'git log -5'])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed', fails: 0 })
})

for (const ci of ['false', '0', '', ' ']) {
  test(`CI=${JSON.stringify(ci)} is no CI: rtk probes and rewrites`, async ($, on) => {
    quiet(on, { CI: ci, GITHUB_ACTIONS: 'false' })
    rtk(on)
    perms(on)
    const seen = bash(on)
    await $.session.start({ ...START })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(seen).toEqual(['rtk git status'])
  })
}

test('GITHUB_ACTIONS=true alone is CI: off (cloud)', async ($, on) => {
  quiet(on, { GITHUB_ACTIONS: 'true' })
  const read = state(on)
  const r = rtk(on)
  await $.session.start({ ...START })
  expect(r.runs).toEqual([])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'cloud' })
})

test('a --version answer that is not rtk\'s counts as missing', async ($, on) => {
  quiet(on)
  const read = state(on)
  rtk(on, { version: 'rust type kit 0.3\n' })
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status'])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed' })
})

test('on Windows the probe also tries rtk.exe, and the rewrite runs it', async ($, on) => {
  quiet(on)
  on('session.info', () => ({ value: { transcriptPath: '', platform: 'windows' } }))
  const r = rtk(on, { bin: 'rtk.exe' })
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['rtk git status'])
  expect(r.runs.slice(0, 3)).toEqual([['rtk', '--version'], ['rtk.exe', '--version'], ['rtk.exe', 'gain', '-f', 'json', '-p']])
  expect(r.runs).toContainEqual(['rtk.exe', 'rewrite', '--', 'git status'])
})

for (const [where, platform, env, path] of [
  ['in ~/.local/bin', 'linux', { HOME: '/home/me' }, '/home/me/.local/bin/rtk'],
  ['on Windows in %USERPROFILE%\\.local\\bin', 'windows', { USERPROFILE: 'C:\\Users\\me' }, 'C:\\Users\\me\\.local\\bin\\rtk.exe'],
] as const) {
  test(`RTK not on the PATH but ${where}: rtk is on, and every later call runs it by that path`, async ($, on) => {
    quiet(on, env)
    on('session.info', () => ({ value: { transcriptPath: '', platform } }))
    const read = state(on)
    const r = rtk(on, { bin: path })
    perms(on)
    const seen = bash(on)
    await $.session.start({ ...START })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(seen).toEqual(['rtk git status'])
    expect(r.runs).toContainEqual([path, 'rewrite', '--', 'git status'])
    expect(r.runs.filter((a) => a[1] !== '--version').every((a) => a[0] === path)).toBe(true)
    await $.session.end({ ...END })
    expect(read('health').rtk).toMatchObject({ on: true, fails: 0 })
  })
}

test('RTK on no PATH and not in ~/.local/bin: off as not installed', async ($, on) => {
  quiet(on, { HOME: '/home/me' })
  const read = state(on)
  const r = rtk(on, { version: null })
  perms(on)
  bash(on)
  await $.session.start({ ...START })
  expect(r.runs).toEqual([['rtk', '--version'], ['/home/me/.local/bin/rtk', '--version']])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed', fails: 0 })
})

test('the Bash tool cannot find rtk: the command runs again as typed, and rtk rests', async ($, on) => {
  quiet(on)
  const read = state(on)
  rtk(on)
  perms(on)
  const seen: string[] = []
  const gone = 'Exit code 127\n/bin/bash: line 1: rtk: command not found'
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.push(e.command)
    return (e.command.startsWith('rtk ') ? { isError: true, result: gone, text: gone } : { result: { stdout: 'ok\n', stderr: '', interrupted: false } }) as never
  })
  await $.session.start({ ...START })
  const out = await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(out).toMatchObject({ result: { stdout: 'ok\n' } })
  expect(seen).toEqual(['rtk git status', 'git status', 'git status'])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed', fails: 0 })
})

test('the Bash tool cannot find rtk, with no error (a later part ends 0): the command runs again as typed, and rtk rests for the session', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on)
  perms(on)
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.push(e.command)
    const stderr = e.command.startsWith('rtk ') ? 'zsh: command not found: rtk\n' : ''
    return { result: { stdout: 'ok\n', stderr, interrupted: false } } as never
  })
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'Bash', command: 'git log' })
  expect(seen).toEqual(['rtk git status', 'git status', 'git log'])
  // The miss is kept: no more rewrites this session.
  expect(r.rewrites()).toEqual(['git status'])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'not installed', fails: 0 })
})

test('a grep that prints the shell\'s words on stdout: rtk stays on, and the command runs once', async ($, on) => {
  quiet(on)
  const read = state(on)
  rtk(on)
  perms(on)
  const seen = bash(on, './notes.txt:3:zsh: command not found: rtk\n')
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'grep -rn "command not found: rtk" .' })
  expect(seen).toEqual(['rtk grep -rn "command not found: rtk" .'])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: true, fails: 0 })
})

// `false` is not a form rtk may run any more (ruling): a read-only form that fails stands in for it.
test('a rewritten command that fails still ends non-zero', async ($, on) => {
  quiet(on)
  rtk(on)
  perms(on)
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    seen.push(e.command)
    return { isError: true, result: 'Error: Exit code 128', text: 'Error: Exit code 128' } as never
  })
  await $.session.start({ ...START })
  const got = await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['rtk git status'])
  expect(got).toMatchObject({ isError: true, text: 'Error: Exit code 128' })
})

test('a 2,000 ms timeout: the command runs as typed, and one failure counts', async ($, on) => {
  quiet(on)
  const read = state(on)
  const r = rtk(on, { rewrite: () => 'timeout' })
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status'])
  expect(r.timeouts.at(-1)).toBe(2000)
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: true, fails: 1, streak: 1, lastErr: expect.stringContaining(TIMEOUT) })
})

test('three timeouts in a row turn rtk off; a reply in between clears the streak', async ($, on) => {
  quiet(on)
  const read = state(on)
  let slow = [true, false, true, true, true]
  const r = rtk(on, { rewrite: (c) => (slow.shift() ? 'timeout' : RTK_REWRITE(c)) })
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status', 'rtk git status', 'git status', 'git status', 'git status', 'git status'])
  // Off after the third timeout in a row: the sixth call never runs rtk.
  expect(r.rewrites()).toHaveLength(5)
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'errors', fails: 4, streak: 3 })
})

test('bashcap still cuts the output when rtk times out, has no rewrite, or rewrites, on the same call', async ($, on) => {
  quiet(on)
  on('session.info', () => ({ value: { transcriptPath: '', scratchpadDir: '/sp' } }))
  on('fs.write', () => ({ value: undefined }))
  const r = rtk(on, { rewrite: (c) => (c === 'git log' ? 'timeout' : c === 'ls' ? { stdout: '', exitCode: 1 } : RTK_REWRITE(c)) })
  perms(on)
  const seen = bash(on, 'line ok\n'.repeat(2500))
  await $.session.start({ ...START })
  for (const command of ['git log', 'ls', 'git status']) {
    const got = await $.tool.call({ tool: 'Bash', command })
    expect((got.result as { stdout: string }).stdout).toContain('[company: ')
  }
  expect(r.rewrites()).toEqual(['git log', 'ls', 'git status'])
  expect(seen).toEqual(['git log', 'ls', 'rtk git status'])
})

test('a call for an attached machine (_host) is never touched', async ($, on) => {
  quiet(on)
  const r = rtk(on)
  const asked = perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status', _host: 'laptop' } as never)
  expect(seen).toEqual(['git status'])
  expect(r.rewrites()).toEqual([])
  expect(asked).toEqual([])
})

test('under CI rtk is off (cloud) and never probed', async ($, on) => {
  quiet(on, { CI: 'true' })
  const read = state(on)
  const r = rtk(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen).toEqual(['git status'])
  expect(r.runs).toEqual([])
  await $.session.end({ ...END })
  expect(read('health').rtk).toMatchObject({ on: false, off: 'cloud', fails: 0 })
})

for (const [env, want] of [[{}, 'diff a b'], [{ COMPANY_RTK_MODE: 'full' }, 'rtk diff a b']] as [Record<string, string>, string][]) {
  test(`mode ${env.COMPANY_RTK_MODE ?? 'light (the default)'}: diff is full only, grep is in both`, async ($, on) => {
    quiet(on, env)
    rtk(on, { rewrite: (c) => ({ stdout: `rtk ${c}`, exitCode: 3 }) })
    perms(on)
    const seen = bash(on)
    await $.session.start({ ...START })
    await $.tool.call({ tool: 'Bash', command: 'diff a b' })
    await $.tool.call({ tool: 'Bash', command: 'grep -rn foo .' })
    expect(seen).toEqual([want, 'rtk grep -rn foo .'])
  })
}

// Ruling: rtk offers these (exit 0), and both permission checks allow them; none is ever rewritten.
for (const env of [{}, { COMPANY_RTK_MODE: 'full' }] as Record<string, string>[]) {
  test(`mode ${env.COMPANY_RTK_MODE ?? 'light'}: a mutating command is never rewritten`, async ($, on) => {
    quiet(on, env)
    const r = rtk(on, { rewrite: (c) => ({ stdout: `rtk ${c}`, exitCode: 0 }) })
    perms(on)
    const seen = bash(on)
    await $.session.start({ ...START })
    const cmds = ['git push --force', 'git commit -m x', 'git checkout -- .', 'git reset --hard', 'rm -rf build', 'find . -name x -delete', 'npm install x', 'git status && git push']
    for (const command of cmds) await $.tool.call({ tool: 'Bash', command })
    expect(seen).toEqual(cmds)
    // rtk never even sees them.
    expect(r.rewrites()).toEqual([])
  })
}

test('skip rules: a heredoc and a command already in rtk form never reach rtk', async ($, on) => {
  quiet(on)
  const r = rtk(on)
  perms(on)
  const seen = bash(on)
  await $.session.start({ ...START })
  await $.tool.call({ tool: 'Bash', command: "git apply <<'EOF'" })
  await $.tool.call({ tool: 'Bash', command: 'rtk git status' })
  expect(seen).toEqual(["git apply <<'EOF'", 'rtk git status'])
  expect(r.rewrites()).toEqual([])
})

test('project rtk filters: one notice, and company never runs rtk trust', async ($, on) => {
  quiet(on)
  const r = rtk(on)
  on('fs.exists', (_, e) => ({ value: e.path === '/repo/.rtk/filters.toml' }))
  const notices: string[] = []
  on('session.append', (_, e, next) => (notices.push(String((e.message.content as any)[0]?.text ?? '')), next(e)))
  await $.session.start({ ...START })
  expect(notices.filter((n) => n.includes('.rtk/filters.toml'))).toEqual(['company · RTK · This repo has RTK filters in .rtk/filters.toml. Company does not trust them.'])
  expect(r.runs.some((a) => a.includes('trust'))).toBe(false)
})
