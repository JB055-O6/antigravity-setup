import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import { createShared } from '../core'
import { RTK } from '../pins'
import { COMPANY, PONYTAIL, QUESTION, digestHex, loadFlag, mergeSettings, rtkFits, runSetup, setupStatus, unmergeSettings } from './setup'

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const SETTINGS = '/home/me/.claude/settings.json'
const BAK = `${SETTINGS}.company-bak`
const BIN = '/home/me/.local/bin'
const DL = '/home/me/.claude/company-setup'
// Each run downloads into a folder of its own under DL.
const RUN_DIR = /^\/home\/me\/\.claude\/company-setup\/[0-9a-f-]{36}$/
const ASSET = 'rtk-x86_64-unknown-linux-musl.tar.gz'
const ENOENT = (what: string) => ({ deny: `spawn ${what} ENOENT` }) as never

type World = {
  env?: Record<string, string>
  machine?: { sysname: string; machine: string }
  // The box: a label, free text, 'dismiss' (the ask rejects) or 'hang' (never answered).
  ask?: string
  files?: Record<string, string>
  rtk?: boolean
  // What `rtk --version` prints (default rtk 1.2.1).
  rtkVersion?: string
  // settings.json gets this text while graphify installs (the person or another session edits it).
  edit?: string
  // false: RTK runs only by its full path in the bin folder.
  onPath?: boolean
  curl?: boolean
  graphify?: 'present' | 'uv' | 'pipx' | 'pip' | 'none'
  // graphify answers only by this full path, not on the PATH.
  graphifyAt?: string
  python?: string
  pipScripts?: string
  // 'hang': the store never answers the setup flag.
  store?: Record<string, unknown> | 'broken' | 'hang'
  // The store answers the setup flag only once this settles.
  flagWait?: Promise<void>
  // Earlier runs' folders under the download folder: name -> mtimeMs.
  runDirs?: Record<string, number>
}

// The engine beneath the plugin: env, machine, store, files, processes, permission checks, the box.
function world(on: On, o: World = {}) {
  mock.env(on, o.env ?? { HOME: '/home/me' })
  // The order of the start beneath and the setup flag read.
  const order: string[] = []
  on('session.start', (_, e) => (order.push('start'), { cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('session.machine', () => ({ value: { sysname: 'Linux', release: '6.8.0', machine: 'x86_64', packageManagers: [], runtimes: [], ...o.machine } }))
  const held: Record<string, unknown> = o.store === 'broken' || o.store === 'hang' ? {} : { ...o.store }
  on('store.get', (_, e) => {
    if (e.key === 'setup') order.push('flag')
    if (o.store === 'hang' && e.key === 'setup') return new Promise(() => {}) as never
    if (o.flagWait && e.key === 'setup') return o.flagWait.then(() => ({ value: held[e.key] })) as never
    return o.store === 'broken' ? ({ deny: 'store unreadable' } as never) : { value: held[e.key] }
  })
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
  on('fs.list', (_, e) =>
    norm(e.path) === DL && o.runDirs ? { value: Object.entries(o.runDirs).map(([name, mtimeMs]) => ({ name, kind: 'dir', size: 0, mtimeMs, isLink: false })) } : enoent(e.path),
  )
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
    if (name === 'rtk' || name === 'rtk.exe') return !rtk || (cmd === name && o.onPath === false) ? ENOENT(cmd) : a1 === '--version' ? res(`${o.rtkVersion ?? 'rtk 1.2.1'}\n`) : res('{}')
    if (name === 'graphify' || name === 'graphify.exe') return graphify && (o.graphifyAt === undefined || cmd === o.graphifyAt) ? res('graphify 0.9.120\n') : ENOENT(cmd)
    // uv's tool bin folder, and pip's --user scripts folder (`python -c`).
    if (cmd === 'uv' && a1 === 'tool' && argv[2] === 'dir') return o.graphify === 'uv' ? res(`${BIN}\n`) : ENOENT(cmd)
    if ((cmd === 'python3' || cmd === 'python') && a1 === '-c') return o.python ? res(`${o.pipScripts ?? BIN}\n`) : ENOENT(cmd)
    if (cmd === 'curl') {
      if (o.curl === false) return res('', 6)
      files[argv[argv.indexOf('-o') + 1]!] = 'not the pinned archive'
      return res()
    }
    if (cmd === 'tar') return (rtk = true), res()
    if (cmd === 'mkdir' || cmd === 'rm' || cmd === 'cmd' || cmd === 'mv') return res()
    if ((cmd === 'uv' || cmd === 'pipx') && o.edit !== undefined) files[SETTINGS] = o.edit
    if (cmd === 'uv' || cmd === 'pipx') return o.graphify === cmd ? ((graphify = true), res()) : ENOENT(cmd)
    if (cmd === 'python3' || cmd === 'python') {
      if (a1 === '--version') return o.python ? res(`${o.python}\n`) : ENOENT(cmd)
      return o.graphify === 'pip' ? ((graphify = true), res()) : res('', 1)
    }
    return ENOENT(cmd)
  })
  const ran = (cmd: string) => runs.filter((a) => a[0] === cmd)
  return { held, files, writes, reads, runs, ran, notices, asked, order }
}

// Lets the box and the setup it starts run to their end. The hash is the engine's crypto, which
// answers later than a microtask, so each round also waits for one digest.
async function settle() {
  for (let k = 0; k < 40; k++) {
    await crypto.subtle.digest('SHA-256', new Uint8Array(0))
    for (let j = 0; j < 100; j++) await Promise.resolve()
  }
}

const OLD = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(npm test:*)", "Bash(find:*)"], "deny": ["Bash(git push:*)"] },\n  "prependPlugins": ["mine@local"]\n}\n'

test('Yes: one box at start, Company first, ponytail ultra, no allow rule, a backup and a record', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: OLD } })
  await $.session.start({ ...START })
  await settle()
  expect(w.asked).toEqual([[{ question: QUESTION, header: expect.any(String), options: [{ label: 'Yes', description: '' }, { label: 'Not now', description: '' }], multiSelect: false }]])
  const s = JSON.parse(w.files[SETTINGS]!)
  // The person's keys, rules and order stay; Company goes first. No rule at all for rtk: the rtk
  // module checks each rewrite per call.
  expect(s.model).toBe('opus')
  expect(s.permissions).toEqual(JSON.parse(OLD).permissions)
  expect(w.files[SETTINGS]).not.toContain('Bash(rtk')
  expect(s.prependPlugins).toEqual([COMPANY, 'mine@local'])
  expect(s.env).toEqual({ [PONYTAIL]: 'ultra' })
  expect(w.files[BAK]).toBe(OLD)
  expect(w.writes).toEqual([BAK, SETTINGS])
  expect(w.held.setupAdded).toEqual({ plugins: [COMPANY], made: ['env'], ponytail: {} })
  expect(w.held.setup).toEqual({ state: 'done' })
  expect(w.notices.length).toBe(1)
  expect(w.notices[0]).toContain('Setup is done.')
  expect(w.notices[0]).toContain(`It sets ${PONYTAIL} to ultra.`)
  // The new backup states its date.
  expect(w.notices[0]).toMatch(new RegExp(`A copy of your settings from \\d{4}-\\d{2}-\\d{2} is in ${BAK.replace(/\./g, '\\.')}\\.`))
  // Both on the PATH: no word about it.
  expect(w.notices[0]).not.toContain('PATH')
  // Both were present at the right version: nothing was downloaded or installed.
  expect(w.ran('curl').length + w.ran('uv').length + w.ran('pipx').length).toBe(0)
  // A later session never asks again.
  await $.session.start({ ...START })
  await settle()
  expect(w.asked.length).toBe(1)
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
  const w = world(on, { files: { [SETTINGS]: '{ "model": "opus", }' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.notices).toEqual([expect.stringContaining(`${SETTINGS} is not valid JSON. Company made no changes.`)])
  expect(w.files[SETTINGS]).toBe('{ "model": "opus", }')
  expect(w.writes).toEqual([])
  expect(w.ran('curl').length + w.ran('tar').length + w.ran('uv').length).toBe(0)
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'settings.json is not valid JSON' })
})

test('a hash mismatch: nothing installed or written, the download is deleted, one notice', async ($, on) => {
  const w = world(on, { files: { [SETTINGS]: OLD } })
  await $.session.start({ ...START })
  await settle()
  const [curl] = w.ran('curl')
  const archive = curl![8]!
  const dir = archive.slice(0, -ASSET.length - 1)
  expect(dir).toMatch(RUN_DIR)
  expect(curl).toEqual(['curl', '-fsSL', '--proto', '=https', '--max-filesize', '67108864', '--create-dirs', '-o', `${dir}/${ASSET}`, `https://github.com/rtk-ai/rtk/releases/download/v1.2.1/${ASSET}`])
  // The hash is read from the archive's bytes, before any unpack.
  expect(w.reads).toContainEqual({ path: archive, as: 'bytes', offset: 0, length: 'not the pinned archive'.length })
  expect(w.ran('tar')).toEqual([])
  expect(w.ran('uv').length + w.ran('pipx').length).toBe(0)
  expect(w.writes).toEqual([])
  expect(w.files[SETTINGS]).toBe(OLD)
  // Only this run's folder goes: another run's download stays.
  expect(w.ran('rm')).toEqual([['rm', '-rf', '--', dir]])
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
  const zip = w.ran('curl')[0]![8]!
  const dir = zip.slice(0, -'\\rtk-x86_64-pc-windows-msvc.zip'.length)
  expect(dir).toMatch(/^C:\\Users\\me\\\.claude\\company-setup\\[0-9a-f-]{36}$/)
  expect(w.ran('curl')[0]!.at(-1)).toBe('https://github.com/rtk-ai/rtk/releases/download/v1.2.1/rtk-x86_64-pc-windows-msvc.zip')
  expect(w.runs).toContainEqual([`${home}\\.local\\bin\\rtk.exe`, '--version'])
  expect(w.ran('cmd')).toEqual([['cmd', '/d', '/c', 'rmdir', '/s', '/q', dir]])
})

test('Windows with RTK present: settings.json under USERPROFILE, python for pip', async ($, on) => {
  const home = 'C:\\Users\\me'
  const path = `${home}\\.claude\\settings.json`
  const w = world(on, { env: { USERPROFILE: home }, machine: { sysname: 'Windows_NT', machine: 'x86_64' }, rtk: true, graphify: 'pip', python: 'Python 3.12.4' })
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
  expect(w.ran('uv').filter((a) => a[2] === 'install')).toEqual([['uv', 'tool', 'install', 'graphifyy==0.9.120']])
  expect(w.ran('pipx')).toEqual([['pipx', 'install', 'graphifyy==0.9.120']])
  expect(w.ran('python3').filter((a) => a[1] !== '-c')).toEqual([])
  expect(w.held.setup).toEqual({ state: 'done' })
})

test('graphify with no uv, no pipx and Python 3.10: the steps, settings still merged, setup failed', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'none', python: 'Python 3.10.12', files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.ran('python3').filter((a) => a[1] !== '-c')).toEqual([['python3', '--version']])
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

test('graphify by pip into a scripts folder off the PATH, RTK off it too: done, and the notice names both folders once', async ($, on) => {
  const scripts = '/home/me/.pyuser/bin'
  const w = world(on, { rtk: true, onPath: false, graphify: 'pip', python: 'Python 3.12.1', pipScripts: scripts, graphifyAt: `${scripts}/graphify`, files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.held.setup).toEqual({ state: 'done' })
  expect(w.notices[0]).toContain(`Add ${BIN} and ${scripts} to your PATH. Then start a new session.`)
})

test('an older backup stays, and the notice gives its date, never "your old settings"', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: '{}', [BAK]: '{"old":1}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.files[BAK]).toBe('{"old":1}')
  expect(w.writes).toEqual([SETTINGS])
  // The test file system dates every file 0 ms.
  expect(w.notices[0]).toContain(`A copy of your settings from 1970-01-01 is in ${BAK}.`)
  expect(w.notices[0]).not.toContain('old settings')
})

test('no settings file: one is made with Company first, and no backup', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present' })
  await $.session.start({ ...START })
  await settle()
  expect(w.writes).toEqual([SETTINGS])
  expect(JSON.parse(w.files[SETTINGS]!)).toEqual({ prependPlugins: [COMPANY], env: { [PONYTAIL]: 'ultra' } })
  expect(w.notices[0]).not.toContain('A copy of your settings')
})

test('mergeSettings keeps the order, adds Company once, and refuses what it cannot merge', () => {
  const m = mergeSettings('{"permissions":{"allow":["a"]},"prependPlugins":["x","company@synced"]}')
  expect('refuse' in m).toBe(false)
  if ('refuse' in m) return
  expect(JSON.parse(m.text)).toEqual({ permissions: { allow: ['a'] }, prependPlugins: ['x', COMPANY], env: { [PONYTAIL]: 'ultra' } })
  expect(m.added).toEqual({ plugins: [], made: ['env'], ponytail: {} })
  expect((mergeSettings('  \n') as { added: unknown }).added).toEqual({ plugins: [COMPANY], made: ['prependPlugins', 'env'], ponytail: {} })
  expect(mergeSettings('[1]')).toEqual({ refuse: 'is not a JSON object' })
  expect(mergeSettings('{"prependPlugins":"x"}')).toEqual({ refuse: 'has a prependPlugins that is not a list' })
  expect(mergeSettings('{"env":["x"]}')).toEqual({ refuse: 'has an env that is not an object' })
})

test('undo takes out only the recorded additions; the person edits after setup stay', () => {
  const m = mergeSettings(OLD)
  if ('refuse' in m) throw new Error(m.refuse)
  // After setup the person adds a rule and a key of their own.
  const edited = JSON.parse(m.text)
  edited.permissions.allow.push('Bash(make:*)')
  edited.theme = 'dark'
  const u = unmergeSettings(JSON.stringify(edited), m.added)
  if ('refuse' in u) throw new Error(u.refuse)
  // Company and ponytail's mode.
  expect(u.removed).toBe(2)
  expect(JSON.parse(u.text)).toEqual({ ...JSON.parse(OLD), permissions: { allow: ['Bash(npm test:*)', 'Bash(find:*)', 'Bash(make:*)'], deny: ['Bash(git push:*)'] }, theme: 'dark' })
  // A file setup made: undo leaves no empty lists behind.
  const fresh = mergeSettings(undefined)
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

test('the setup flag is read after the start beneath; a store that does not answer in time shows no box', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const w = world(on, { store: 'hang' })
  await $.session.start({ ...START })
  await clock.advance(1500)
  await settle()
  expect(w.order).toEqual(['start', 'flag'])
  expect(w.asked).toEqual([])
})

test('settings.json changed while setup ran: no write, no backup, one notice', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'uv', files: { [SETTINGS]: OLD }, edit: '{"theme":"dark"}' })
  await $.session.start({ ...START })
  await settle()
  expect(w.writes).toEqual([])
  expect(w.files[SETTINGS]).toBe('{"theme":"dark"}')
  expect(w.held.setupAdded).toBeUndefined()
  expect(w.notices).toEqual([expect.stringContaining(`${SETTINGS} changed while setup ran. Company changed no settings.`)])
  expect(w.held.setup).toEqual({ state: 'failed', reason: 'settings.json changed during setup' })
})

test('a setup run in progress in another session: no box', async ($, on) => {
  const w = world(on, { store: { setupRun: { at: Date.now() } } })
  await $.session.start({ ...START })
  await settle()
  expect(w.asked).toEqual([])
})

test('CLAUDE_CONFIG_DIR: settings.json and the download folder are there', async ($, on) => {
  const cfg = '/cfg/claude'
  const w = world(on, { env: { HOME: '/home/me', CLAUDE_CONFIG_DIR: `${cfg}/` }, rtk: true, graphify: 'present', files: { [`${cfg}/settings.json`]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.writes).toEqual([`${cfg}/settings.json.company-bak`, `${cfg}/settings.json`])
  expect(w.files[SETTINGS]).toBeUndefined()
})

test('RTK newer than the pin: kept, never downgraded', async ($, on) => {
  const w = world(on, { rtk: true, rtkVersion: 'rtk 1.3.0', graphify: 'present', files: { [SETTINGS]: '{}' } })
  await $.session.start({ ...START })
  await settle()
  expect(w.ran('curl')).toEqual([])
  expect(w.held.setup).toEqual({ state: 'done' })
  expect([rtkFits('rtk 1.2.1'), rtkFits('rtk 1.10.0\n'), rtkFits('rtk 2.0.0'), rtkFits('rtk 1.2.0'), rtkFits('rtk 0.9.9'), rtkFits('rtk dev')]).toEqual([true, true, true, false, false, false])
})

test('undo keeps the empty lists the person had before setup', () => {
  const m = mergeSettings('{"prependPlugins":[],"env":{}}')
  if ('refuse' in m) throw new Error(m.refuse)
  expect(m.added.made).toEqual([])
  const u = unmergeSettings(m.text, m.added) as { text: string }
  expect(JSON.parse(u.text)).toEqual({ prependPlugins: [], env: {} })
})

test('ponytail: absent -> ultra and undo removes it; "full" -> ultra and undo gives "full" back; "ultra" -> nothing recorded', () => {
  const round = (text: string) => {
    const m = mergeSettings(text)
    if ('refuse' in m) throw new Error(m.refuse)
    const u = unmergeSettings(m.text, m.added) as { text: string }
    return { env: JSON.parse(m.text).env, ponytail: m.added.ponytail, undone: JSON.parse(u.text) }
  }
  expect(round('{"env":{"X":"1"}}')).toEqual({ env: { X: '1', [PONYTAIL]: 'ultra' }, ponytail: {}, undone: { env: { X: '1' } } })
  expect(round(`{"env":{"${PONYTAIL}":"full"}}`)).toEqual({ env: { [PONYTAIL]: 'ultra' }, ponytail: { was: 'full' }, undone: { env: { [PONYTAIL]: 'full' } } })
  expect(round(`{"env":{"${PONYTAIL}":"ultra"}}`).ponytail).toBeUndefined()
  // Set to another mode after setup: undo leaves it.
  const m = mergeSettings('{}')
  if ('refuse' in m) throw new Error(m.refuse)
  const later = JSON.parse(m.text)
  later.env[PONYTAIL] = 'lite'
  expect(JSON.parse((unmergeSettings(JSON.stringify(later), m.added) as { text: string }).text).env).toEqual({ [PONYTAIL]: 'lite' })
})

test('a later run records ponytail\'s mode from just before it: run 1 had full, the person set lite, undo gives lite', async ($, on) => {
  const w = world(on, { rtk: true, graphify: 'present', files: { [SETTINGS]: `{"env":{"${PONYTAIL}":"full"}}` } })
  await $.session.start({ ...START })
  await settle()
  expect((w.held.setupAdded as { ponytail: unknown }).ponytail).toEqual({ was: 'full' })
  // The person sets lite; a second run (the flag cleared, as the pane's Set up does).
  const now = JSON.parse(w.files[SETTINGS]!)
  now.env[PONYTAIL] = 'lite'
  w.files[SETTINGS] = JSON.stringify(now)
  delete w.held.setup
  await $.session.start({ ...START })
  await settle()
  const rec = w.held.setupAdded as Parameters<typeof unmergeSettings>[1]
  expect(rec.ponytail).toEqual({ was: 'lite' })
  expect(JSON.parse((unmergeSettings(w.files[SETTINGS]!, rec) as { text: string }).text).env).toEqual({ [PONYTAIL]: 'lite' })
})

test('a flag the store gives after 1.5 s fills the dashboard state and never brings the box', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const w = world(on, { store: { setup: { state: 'done' } }, flagWait: clock.sleep(3000) })
  // $.state for company: the pane snapshot the dashboard draws from.
  const state: Record<string, { value: unknown; version: number }> = {}
  on('state.get', (_, e, next) => (e.plugin === 'company' ? { value: state[e.key] ?? { value: undefined, version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    if (e.plugin !== 'company') return next(e)
    state[e.key] = { value: e.value, version: (state[e.key]?.version ?? 0) + 1 }
    return { value: { isSet: true, version: state[e.key]!.version } }
  })
  const pane = () => (state.panel?.value as { value?: { setup?: unknown } } | undefined)?.value?.setup
  await $.session.start({ ...START })
  await clock.advance(1500)
  await settle()
  expect(pane()).not.toEqual({ state: 'done' })
  await clock.advance(2000)
  await settle()
  expect(w.asked).toEqual([])
  expect(pane()).toEqual({ state: 'done' })
  // The state the late answer goes into: loaded when nothing changed since the read began.
  const st = createShared(['setup'])
  const before = st.setup
  loadFlag(st, { state: 'done' }, before)
  expect(setupStatus(st)).toEqual({ state: 'done' })
  // A run that ended since then keeps its own state.
  const st2 = createShared(['setup'])
  const before2 = st2.setup
  st2.setup = { state: 'failed', reason: 'RTK download failed', running: false }
  loadFlag(st2, { state: 'declined' }, before2)
  expect(setupStatus(st2)).toEqual({ state: 'failed', reason: 'RTK download failed' })
})

test('run folders of a killed run go once they are 15 min old; a younger one and other names stay', async ($, on) => {
  const old = '11111111-1111-4111-8111-111111111111'
  const young = '22222222-2222-4222-8222-222222222222'
  const w = world(on, { files: { [SETTINGS]: OLD }, runDirs: { [old]: 0, [young]: Date.now(), 'keep-me': 0 } })
  await $.session.start({ ...START })
  await settle()
  const rm = w.ran('rm').map((a) => a[3])
  expect(rm).toContain(`${DL}/${old}`)
  expect(rm).not.toContain(`${DL}/${young}`)
  expect(rm).not.toContain(`${DL}/keep-me`)
})

test('a download with the pinned SHA-256: unpacked and checked in the run folder, then moved to the bin folder', async () => {
  // runSetup runs here with a plain stand-in for `$`, so the pin it reads is this file's copy: set,
  // for this test only, to the real SHA-256 of a fake archive.
  const fake = 'a fake rtk archive'
  const real = RTK.assets['linux-x64']!
  RTK.assets['linux-x64'] = { name: ASSET, sha256: await digestHex(new TextEncoder().encode(fake)) }
  const files: Record<string, string> = { [SETTINGS]: '{}' }
  const held: Record<string, unknown> = {}
  const runs: string[][] = []
  let unpacked = ''
  let installed = false
  const res = (stdout = '', exitCode = 0) => ({ exitCode, stdout, stderr: '' })
  const missing = (what: string) => Promise.reject(new Error(`spawn ${what} ENOENT`))
  const engine = {
    session: { machine: async () => ({ sysname: 'Linux', release: '6.8.0', machine: 'x86_64' }), append: async () => undefined },
    env: { get: async (k: string) => (k === 'HOME' ? '/home/me' : undefined) },
    store: { get: async (k: string) => held[k], set: async (k: string, v: unknown) => void (held[k] = v), delete: async (k: string) => void delete held[k] },
    clock: { now: async () => 5_000_000 },
    ui: { status: () => undefined },
    fs: {
      read: async (path: string, o?: { offset?: number; length?: number }) => {
        if (!(path in files)) throw new Error(`open ${path} failed: ENOENT`)
        return o ? { base64: btoa(files[path]!.slice(o.offset ?? 0, (o.offset ?? 0) + (o.length ?? files[path]!.length))) } : files[path]
      },
      stat: async (path: string) => {
        if (!(path in files)) throw new Error(`stat ${path} failed: ENOENT`)
        return { kind: 'file', size: files[path]!.length, mtimeMs: 0, isLink: false }
      },
      list: async () => [],
      exists: async () => false,
      write: async (path: string, text: string) => void (files[path] = text),
    },
    process: {
      run: async (argv: string[]) => {
        runs.push(argv)
        const [cmd = '', a1 = ''] = argv
        if (cmd === 'curl') return (files[argv[argv.indexOf('-o') + 1]!] = fake), res()
        if (cmd === 'tar') return (unpacked = `${argv[argv.indexOf('-C') + 1]}/rtk`), res()
        if (cmd === 'mv') return (installed = argv[3] === unpacked), res()
        if (cmd === 'mkdir' || cmd === 'rm') return res()
        // RTK answers by the unpacked path once tar ran, then on the PATH once it moved.
        if ((cmd === unpacked && unpacked) || (cmd === 'rtk' && installed)) return a1 === '--version' ? res('rtk 1.2.1\n') : res('{}')
        if (cmd === 'graphify') return res('graphify 0.9.120\n')
        return missing(cmd)
      },
    },
  }
  try {
    const st = createShared(['setup'])
    await runSetup(engine as never, st)
    const dir = runs.find((a) => a[0] === 'curl')![8]!.slice(0, -ASSET.length - 1)
    expect(dir).toMatch(RUN_DIR)
    const at = (cmd: string, a1?: string) => runs.findIndex((a) => a[0] === cmd && (a1 === undefined || a[1] === a1))
    expect(runs.filter((a) => a[0] === 'tar')).toEqual([['tar', '-xzf', `${dir}/${ASSET}`, '-C', dir, 'rtk']])
    // The new binary answers in the run folder, and only then moves to the bin folder.
    expect(at(`${dir}/rtk`, '--version')).toBeGreaterThan(at('tar'))
    expect(at('mv')).toBeGreaterThan(at(`${dir}/rtk`, 'gain'))
    expect(runs.filter((a) => a[0] === 'mv')).toEqual([['mv', '-f', '--', `${dir}/rtk`, `${BIN}/rtk`]])
    expect(at('rm')).toBeGreaterThan(at('mv'))
    expect(runs.filter((a) => a[0] === 'rm')).toEqual([['rm', '-rf', '--', dir]])
    expect(setupStatus(st)).toEqual({ state: 'done' })
    expect(JSON.parse(files[SETTINGS]!).prependPlugins).toEqual([COMPANY])
  } finally {
    RTK.assets['linux-x64'] = real
  }
})

test('the box names the settings change and the copy; each sentence has 20 words or fewer and no -ing word', () => {
  expect(QUESTION).toContain('It changes your settings.json and keeps a copy.')
  expect(QUESTION).not.toContain('allow')
  for (const sentence of QUESTION.split(/(?<=[.?])\s+/)) {
    expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20)
    expect(/\b\w+ing\b/.test(sentence)).toBe(false)
  }
})
