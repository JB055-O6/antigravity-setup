import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared } from '../core'
import { FORMS } from '../rtkrules'
import { COMPANY, MIRRORS, QUESTION, digestHex, mergeSettings, setupStatus, unmergeSettings } from './setup'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const SETTINGS = '/home/me/.claude/settings.json'
const BAK = `${SETTINGS}.company-bak`
const BIN = '/home/me/.local/bin'
const DL = '/home/me/.claude/company-setup'
const ARCHIVE = `${DL}/rtk-x86_64-unknown-linux-musl.tar.gz`
const ENOENT = (what: string) => ({ deny: `spawn ${what} ENOENT` }) as never

type Verdict = { decision: 'allow' | 'ask' | 'deny'; rule?: string }
type World = {
  env?: Record<string, string>
  machine?: { sysname: string; machine: string }
  // The box: a label, free text, 'dismiss' (the ask rejects) or 'hang' (never answered).
  ask?: string
  files?: Record<string, string>
  rtk?: boolean
  // false: RTK runs only by its full path in the bin folder.
  onPath?: boolean
  curl?: boolean
  graphify?: 'present' | 'uv' | 'pipx' | 'pip' | 'none'
  python?: string
  check?: (cmd: string) => Verdict
  store?: Record<string, unknown> | 'broken'
}

// The engine beneath the plugin: env, machine, store, files, processes, permission checks, the box.
function world(on: On, o: World = {}) {
  mock.env(on, o.env ?? { HOME: '/home/me' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.machine', () => ({ value: { sysname: 'Linux', release: '6.8.0', machine: 'x86_64', packageManagers: [], runtimes: [], ...o.machine } }))
  const held: Record<string, unknown> = o.store === 'broken' ? {} : { ...o.store }
  on('store.get', (_, e) => (o.store === 'broken' ? ({ deny: 'store unreadable' } as never) : { value: held[e.key] }))
  on('store.set', (_, e) => ((held[e.key] = e.value), { value: undefined }))
  on('store.delete', (_, e) => (delete held[e.key], { value: undefined }))
  const notices: string[] = []
  on('session.append', (_, e, next) => {
    const t = String((e.message.content as any)[0]?.text ?? '')
    if (t.startsWith('company · SETUP')) notices.push(t)
    return next(e)
  })
  const asked: unknown[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const qs = (e as any).questions as { question: string; options: { label: string }[] }[]
    asked.push(qs)
    if (o.ask === 'dismiss') return { deny: 'The user dismissed the question.' } as never
    if (o.ask === 'hang') return new Promise(() => {}) as never
    return { result: { questions: qs, answers: { [qs[0]!.question]: o.ask ?? 'Yes' } } } as never
  })
  const checked: string[] = []
  on('tool.check', { tool: 'Bash' }, (_, e) => {
    const c = (e.input as { command: string }).command
    if (e.tool_use_id === undefined) checked.push(c)
    return (o.check ?? (() => ({ decision: 'ask' })))(c) as never
  })
  const files: Record<string, string> = { ...o.files }
  const writes: string[] = []
  const reads: { path: string; as: string; offset?: number; length?: number }[] = []
  const enoent = (path: string) => ({ deny: `open ${path} failed: ENOENT` }) as never
  // The test host is not Windows: it puts its own folder before a `C:\\` path. Take it off.
  const norm = (path: string) => path.replace(/^.*?(?=[A-Za-z]:\\)/, '')
  on('fs.read', (_, e) => {
    const path = norm(e.path)
    if (!(path in files)) return enoent(path)
    reads.push({ path, as: e.as, ...(e.offset !== undefined ? { offset: e.offset } : {}), ...(e.length !== undefined ? { length: e.length } : {}) })
    const all = files[path]!
    if (e.as !== 'bytes') return { value: all }
    const at = e.offset ?? 0
    return { value: { base64: btoa(all.slice(at, at + (e.length ?? all.length))) } }
  })
  on('fs.stat', (_, e) => (norm(e.path) in files ? { value: { kind: 'file', size: files[norm(e.path)]!.length, mtimeMs: 0, isLink: false } } : enoent(e.path)))
  on('fs.exists', (_, e) => ({ value: norm(e.path) in files || Object.keys(files).some((f) => f.startsWith(`${norm(e.path)}/`)) }))
  on('fs.write', (_, e) => {
    files[norm(e.path)] = e.text
    writes.push(norm(e.path))
    return { value: undefined }
  })
  // rtk and graphify on the PATH or in the bin folder once installed.
  let rtk = o.rtk ?? false
  let graphify = o.graphify === 'present'
  const runs: string[][] = []
  const res = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const [cmd = '', a1 = ''] = argv
    const name = cmd.split(/[\\/]/).pop()!
    if (name === 'rtk' || name === 'rtk.exe') return !rtk || (cmd === name && o.onPath === false) ? ENOENT(cmd) : a1 === '--version' ? res('rtk 1.2.1\n') : res('{}')
    if (name === 'graphify' || name === 'graphify.exe') return graphify ? res('graphify 0.9.120\n') : ENOENT(cmd)
    if (cmd === 'curl') {
      if (o.curl === false) return res('', 6)
      files[argv[argv.indexOf('-o') + 1]!] = 'not the pinned archive'
      return res()
    }
    if (cmd === 'tar') return (rtk = true), res()
    if (cmd === 'mkdir' || cmd === 'rm' || cmd === 'cmd') return res()
    if (cmd === 'uv' || cmd === 'pipx') return o.graphify === cmd ? ((graphify = true), res()) : ENOENT(cmd)
    if (cmd === 'python3' || cmd === 'python') {
      if (a1 === '--version') return o.python ? res(`${o.python}\n`) : ENOENT(cmd)
      return o.graphify === 'pip' ? ((graphify = true), res()) : res('', 1)
    }
    return ENOENT(cmd)
  })
  const ran = (cmd: string) => runs.filter((a) => a[0] === cmd)
  return { held, files, writes, reads, runs, ran, notices, asked, checked }
}

// Lets the box and the setup it starts run to their end. The hash is the engine's crypto, which
// answers later than a microtask, so each round also waits for one digest.
async function settle() {
  for (let k = 0; k < 40; k++) {
    await crypto.subtle.digest('SHA-256', new Uint8Array(0))
    for (let j = 0; j < 100; j++) await Promise.resolve()
  }
}

// The person allows git status (the engine's own read-only check) and find, its write form too
// (their own rule), and git log only as a read: its write form asks.
const ALLOWS = (c: string): Verdict =>
  c === 'git status' || c === 'git log' ? { decision: 'allow' } : c === 'find' || c === 'find . -delete' ? { decision: 'allow', rule: 'Bash(find:*)' } : { decision: 'ask' }
const OLD = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Bash(git push:*)"] },\n  "prependPlugins": ["mine@local"]\n}\n'

test('Yes: one box at start, rules for allowed originals only, Company first, a backup and a record', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: OLD }, check: ALLOWS })
  await $.session.start({ ...START })
  await settle()
  expect(w.asked).toEqual([[{ question: QUESTION, header: expect.any(String), options: [{ label: 'Yes', description: '' }, { label: 'Not now', description: '' }], multiSelect: false }]])
  const s = JSON.parse(w.files[SETTINGS]!)
  // The person's keys, rules and order stay; only the mirrors are added, and Company goes first.
  expect(s.model).toBe('opus')
  expect(s.permissions.deny).toEqual(['Bash(git push:*)'])
  expect(s.permissions.allow).toEqual(['Bash(npm test:*)', 'Bash(rtk git status:*)', 'Bash(rtk find:*)'])
  expect(s.prependPlugins).toEqual([COMPANY, 'mine@local'])
  expect(w.files[BAK]).toBe(OLD)
  expect(w.writes).toEqual([BAK, SETTINGS])
  expect(w.held.setupAdded).toEqual({ allow: ['Bash(rtk git status:*)', 'Bash(rtk find:*)'], plugins: [COMPANY] })
  expect(w.held.setup).toEqual({ state: 'done' })
  expect(w.notices.length).toBe(1)
  expect(w.notices[0]).toContain('Setup is done.')
  // Both were present at the right version: nothing was downloaded or installed.
  expect(w.ran('curl').length + w.ran('uv').length + w.ran('pipx').length).toBe(0)
  // A later session never asks again.
  await $.session.start({ ...START })
  await settle()
  expect(w.asked.length).toBe(1)
})

test('mirrors: each added rule is the RTK form of an original that runs with no prompt; never rtk:* or a write', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: '{}' }, check: ALLOWS })
  await $.session.start({ ...START })
  await settle()
  const added = (w.held.setupAdded as { allow: string[] }).allow
  const allowed = MIRRORS.filter((m) => ALLOWS(m.sample).decision === 'allow' && (!m.probe || ALLOWS(m.probe).decision === 'allow')).map((m) => m.rule)
  expect(added).toEqual(allowed)
  expect(added).not.toContain('Bash(rtk:*)')
  // git log runs with no prompt only as a read, so its write form decides: no mirror.
  expect(added).not.toContain('Bash(rtk git log:*)')
  expect(w.checked).toContain('git log --output=x')
  // Every mirror is a read-only form rtk runs (cat as rtk read), as a narrow prefix rule.
  const forms = FORMS.filter((f) => !f.asTyped).map((f) => `Bash(rtk ${f.words.join(' ')}:*)`)
  expect(MIRRORS.map((m) => m.rule)).toEqual([...forms, 'Bash(rtk read:*)'])
  expect(MIRRORS.some((m) => /push|commit|checkout|reset|rm |mv |install|^Bash\(rtk:/.test(m.rule))).toBe(false)
})

test('a mode that allows every command: only allows a settings rule gave count', async ($, on) => {
  // bypassPermissions: everything allowed with no rule; the person's own find rule still counts.
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: '{}' }, check: (c) => (c.startsWith('find') ? { decision: 'allow', rule: 'Bash(find:*)' } : { decision: 'allow' }) })
  await $.session.start({ ...START })
  await settle()
  expect((w.held.setupAdded as { allow: string[] }).allow).toEqual(['Bash(rtk find:*)'])
})

test('Not now: the flag is declined, nothing runs or changes, and the box does not come back', async ($, on) => {
  const w = world(on, { ask: 'Not now', files: { [SETTINGS]: OLD } })
  await $.session.start({ ...START })
  await settle()
  expect(w.held.setup).toEqual({ state: 'declined' })
  expect(w.writes).toEqual([])
  expect(w.ran('curl')).toEqual([])
  await $.session.start({ ...START })
  await settle()
  expect(w.asked.length).toBe(1)
})

for (const ask of ['dismiss', 'Maybe later'] as const) {
  test(`a box that is ${ask === 'dismiss' ? 'dismissed (the ask rejects)' : 'answered with free text'}: the flag stays unset and the box comes back next session`, async ($, on) => {
    const w = world(on, { ask, files: { [SETTINGS]: OLD } })
    await $.session.start({ ...START })
    await settle()
    expect(w.held.setup).toBeUndefined()
    expect(w.writes).toEqual([])
    await $.session.start({ ...START })
    await settle()
    expect(w.asked.length).toBe(2)
  })
}

test('the box never holds up session start', async ($, on) => {
  const w = world(on, { ask: 'hang' })
  await $.session.start({ ...START })
  expect(w.asked.length).toBe(1)
})

const NEVER: [string, World, Partial<typeof START>][] = [
  ['a -p run', {}, { isInteractive: false as never, surface: null as never }],
  ['CI', { env: { HOME: '/home/me', CI: 'true' } }, {}],
  ['GitHub Actions', { env: { HOME: '/home/me', GITHUB_ACTIONS: 'true' } }, {}],
  ['a cloud session', { env: { HOME: '/home/me', CLAUDE_CODE_REMOTE: 'true' } }, {}],
  ['an SSH login', { env: { HOME: '/home/me', SSH_CONNECTION: '1 2 3 4' } }, {}],
  ['a store that cannot be read', { store: 'broken' }, {}],
  ['a machine already set up', { store: { setup: { state: 'done' } } }, {}],
]
for (const [name, o, start] of NEVER) {
  test(`${name}: no box, nothing runs`, async ($, on) => {
    const w = world(on, o)
    await $.session.start({ ...START, ...start })
    await settle()
    expect(w.asked).toEqual([])
    expect(w.writes).toEqual([])
    expect(w.ran('curl')).toEqual([])
  })
}

test('invalid settings JSON: one notice, and nothing installed or written', async ($, on) => {
  const w = world(on, { files: { [SETTINGS]: '{ "model": "opus", }' }, check: ALLOWS })
  await $.session.start({ ...START })
  await settle()
  expect(w.notices).toEqual([expect.stringContaining(`${SETTINGS} is not valid JSON. Company made no changes.`)])
  expect(w.files[SETTINGS]).toBe('{ "model": "opus", }')
  expect(w.writes).toEqual([])
  expect(w.ran('curl').length + w.ran('tar').length + w.ran('uv').length).toBe(0)
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'settings.json is not valid JSON' })
})

test('a hash mismatch: nothing installed or written, the download is deleted, one notice', async ($, on) => {
  const w = world(on, { files: { [SETTINGS]: OLD }, check: ALLOWS })
  await $.session.start({ ...START })
  await settle()
  const [curl] = w.ran('curl')
  expect(curl).toEqual(['curl', '-fsSL', '--proto', '=https', '--max-filesize', '67108864', '--create-dirs', '-o', ARCHIVE, 'https://github.com/rtk-ai/rtk/releases/download/v1.2.1/rtk-x86_64-unknown-linux-musl.tar.gz'])
  // The hash is read from the archive's bytes, before any unpack.
  expect(w.reads).toContainEqual({ path: ARCHIVE, as: 'bytes', offset: 0, length: 'not the pinned archive'.length })
  expect(w.ran('tar')).toEqual([])
  expect(w.ran('uv').length + w.ran('pipx').length).toBe(0)
  expect(w.writes).toEqual([])
  expect(w.files[SETTINGS]).toBe(OLD)
  expect(w.ran('rm')).toEqual([['rm', '-rf', '--', DL]])
  expect(w.notices).toEqual([expect.stringContaining('the RTK download does not have the correct SHA-256')])
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'RTK download has the wrong SHA-256' })
})

test('no network: one notice, nothing written, and the module stays on', async ($, on) => {
  const w = world(on, { curl: false, files: { [SETTINGS]: OLD } })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  const held: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: held[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    held[e.key] = { value: e.value, version: (held[e.key]?.version ?? 0) + 1 }
    return { value: { isSet: true, version: held[e.key]!.version } }
  })
  await $.session.start({ ...START })
  await settle()
  expect(w.notices).toEqual([expect.stringContaining('Company cannot download RTK')])
  expect(w.writes).toEqual([])
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'RTK download failed' })
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } } as never)
  const health = (held.health?.value as { value: any } | undefined)?.value
  expect(health.setup).toEqual({ on: true, fails: 0, streak: 0 })
})

test('Windows: the paths under USERPROFILE with backslashes, the zip build, rmdir for the download', async ($, on) => {
  const home = 'C:\\Users\\me'
  const w = world(on, { env: { USERPROFILE: home }, machine: { sysname: 'Windows_NT', machine: 'x86_64' }, files: { [`${home}\\.claude\\settings.json`]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  const zip = `${home}\\.claude\\company-setup\\rtk-x86_64-pc-windows-msvc.zip`
  expect(w.ran('curl')[0]).toContain(zip)
  expect(w.ran('curl')[0]!.at(-1)).toBe('https://github.com/rtk-ai/rtk/releases/download/v1.2.1/rtk-x86_64-pc-windows-msvc.zip')
  expect(w.runs).toContainEqual([`${home}\\.local\\bin\\rtk.exe`, '--version'])
  expect(w.ran('cmd')).toEqual([['cmd', '/d', '/c', 'rmdir', '/s', '/q', `${home}\\.claude\\company-setup`]])
})

test('Windows with RTK present: settings.json under USERPROFILE, python for pip', async ($, on) => {
  const home = 'C:\\Users\\me'
  const path = `${home}\\.claude\\settings.json`
  const w = world(on, { env: { USERPROFILE: home }, machine: { sysname: 'Windows_NT', machine: 'x86_64' }, rtk: true, graphify: 'pip', python: 'Python 3.12.4', check: ALLOWS })
  await $.session.start({ ...START })
  await settle()
  expect(w.ran('python')).toContainEqual(['python', '-m', 'pip', 'install', '--user', 'graphifyy==0.9.120'])
  expect(w.writes).toEqual([path])
  expect(JSON.parse(w.files[path]!).prependPlugins).toEqual([COMPANY])
  expect(w.held.setup).toEqual({ state: 'done' })
})

test('graphify: uv missing, so pipx; pip only with Python 3.11 or newer; else the steps', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'pipx', files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.ran('uv')).toEqual([['uv', 'tool', 'install', 'graphifyy==0.9.120']])
  expect(w.ran('pipx')).toEqual([['pipx', 'install', 'graphifyy==0.9.120']])
  expect(w.ran('python3')).toEqual([])
  expect(w.held.setup).toEqual({ state: 'done' })
})

test('graphify with no uv, no pipx and Python 3.10: the steps, settings still merged, setup failed', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'none', python: 'Python 3.10.12', files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.ran('python3')).toEqual([['python3', '--version']])
  expect(w.notices.length).toBe(1)
  expect(w.notices[0]).toContain('Company cannot install graphify. It needs uv, pipx or Python 3.11. Install uv, then run: uv tool install graphifyy==0.9.120')
  expect(JSON.parse(w.files[SETTINGS]!).prependPlugins).toEqual([COMPANY])
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'graphify not installed' })
})

test('RTK in the bin folder but not on the PATH: no download, and the notice says to add the folder', async ($, on) => {
  const w = world(on, { rtk: true, onPath: false, graphify: 'present', files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.runs).toContainEqual([`${BIN}/rtk`, 'gain'])
  expect(w.ran('curl')).toEqual([])
  expect(w.notices[0]).toContain(`Add ${BIN} to your PATH. Then start a new session.`)
  expect(w.held.setup).toEqual({ state: 'done' })
})

test('an older backup stays; no settings file gets a new one with no backup', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: '{}', [BAK]: '{"old":1}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.files[BAK]).toBe('{"old":1}')
  expect(w.writes).toEqual([SETTINGS])
})

test('no settings file: one is made with Company first, and no backup', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present' })
  await $.session.start({ ...START })
  await settle()
  expect(w.writes).toEqual([SETTINGS])
  expect(JSON.parse(w.files[SETTINGS]!)).toEqual({ permissions: { allow: [] }, prependPlugins: [COMPANY] })
  expect(w.notices[0]).not.toContain('copy of your old settings')
})

test('mergeSettings dedupes, keeps the order, and refuses what it cannot merge', () => {
  const m = mergeSettings('{"permissions":{"allow":["a"]},"prependPlugins":["x","company@synced"]}', ['a', 'b', 'b'])
  expect('refuse' in m).toBe(false)
  if ('refuse' in m) return
  expect(JSON.parse(m.text)).toEqual({ permissions: { allow: ['a', 'b'] }, prependPlugins: ['x', COMPANY] })
  expect(m.added).toEqual({ allow: ['b'], plugins: [] })
  expect((mergeSettings('  \n', []) as { added: unknown }).added).toEqual({ allow: [], plugins: [COMPANY] })
  expect(mergeSettings('[1]', [])).toEqual({ refuse: 'is not a JSON object' })
  expect(mergeSettings('{"permissions":{"allow":"x"}}', [])).toEqual({ refuse: 'has a permissions.allow that is not a list' })
  expect(mergeSettings('{"prependPlugins":"x"}', [])).toEqual({ refuse: 'has a prependPlugins that is not a list' })
})

test('undo takes out only the recorded additions; the person edits after setup stay', () => {
  const m = mergeSettings(OLD, ['Bash(rtk git status:*)'])
  if ('refuse' in m) throw new Error(m.refuse)
  // After setup the person adds a rule and a key of their own.
  const edited = JSON.parse(m.text)
  edited.permissions.allow.push('Bash(make:*)')
  edited.theme = 'dark'
  const u = unmergeSettings(JSON.stringify(edited), m.added)
  if ('refuse' in u) throw new Error(u.refuse)
  expect(u.removed).toBe(2)
  expect(JSON.parse(u.text)).toEqual({ ...JSON.parse(OLD), permissions: { allow: ['Bash(npm test:*)', 'Bash(make:*)'], deny: ['Bash(git push:*)'] }, theme: 'dark' })
  // A file setup made: undo leaves no empty lists behind.
  const fresh = mergeSettings(undefined, ['Bash(rtk ls:*)'])
  if ('refuse' in fresh) throw new Error(fresh.refuse)
  expect(JSON.parse((unmergeSettings(fresh.text, fresh.added) as { text: string }).text)).toEqual({})
  expect(unmergeSettings('{,', fresh.added)).toEqual({ refuse: 'is not valid JSON' })
})

test('setupStatus reads the shared state; the digest is SHA-256', async () => {
  const s = createShared(['setup'])
  expect(setupStatus(s)).toEqual({ state: 'not asked' })
  s.setup = { state: 'failed', reason: 'RTK download failed', running: false }
  expect(setupStatus(s)).toEqual({ state: 'failed', reason: 'RTK download failed' })
  expect(await digestHex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
