// Setup: once per machine, one engine Yes/No box at session start. Yes installs RTK and graphify
// (pinned), adds allow rules for the RTK form of the read-only commands that already run with no
// prompt, and makes Company load first. It edits the person's own settings.json: it reads and
// checks the file first, writes a backup, merges, and records each addition, so undo takes back
// only those. Each expected miss (a dismissed box, no network, a hash mismatch, invalid JSON) ends
// in one notice and never throws: a throw would take the other company hooks on session.start with it.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { deleteArgv } from '../bashcut'
import { bare, firstBin, folderOf, graphifyPaths, homeDir } from '../bins'
import { beneath, cutCodePoints, fail, isOn, missing, ok, redact, truthy, type Ctx, type SetupState, type Shared } from '../core'
import { showStatus } from '../host'
import { ready, within } from '../persist'
import { GRAPHIFY, RTK } from '../pins'
import { FORMS } from '../rtkrules'

type Start = MatchedHook<'session.start', {}>
// What setup added: the rules, the plugin entry, the lists and the env it made (undo keeps what the
// person had), and ponytail's mode before setup (`was` absent: no value).
type Added = { allow: string[]; plugins: string[]; made: string[]; ponytail?: { was?: unknown } }
// Where setup works on this machine. `key` names the RTK build (`linux-x64`); none for an unknown machine.
// `settings` is under CLAUDE_CONFIG_DIR when it is set, as the engine reads it.
type Place = { win: boolean; key?: string; sep: string; bin: string; settings: string; dl: string }
// How a run ends: the notice, and the reason the dashboard shows when it did not do it all.
type End = { reason?: string; text: string }

export const QUESTION =
  'Company can set up this machine. It installs RTK and graphify, and loads Company first. It lets RTK shrink read-only commands you already allow, and sets ponytail to ultra. Set it up now?'
export const COMPANY = 'company@synced'
// ponytail (5.3.3) reads this env first: its own band and texts then say ultra, as the leader does.
export const PONYTAIL = 'PONYTAIL_DEFAULT_MODE'
const BASE = `https://github.com/rtk-ai/rtk/releases/download/${RTK.version}`
const GRAPHIFY_VERSION = GRAPHIFY.split('==')[1]
const GRAPHIFY_RE = new RegExp(`^graphify ${GRAPHIFY_VERSION?.replace(/\./g, '\\.')}(\\s|$)`)
const GRAPHIFY_FITS = (stdout: string) => GRAPHIFY_RE.test(stdout)
// The longest the start waits for the setup flag; then it is unknown, and no box shows.
const FLAG_MS = 1500
// A run another session started this long ago or less is still going on.
const RUN_FOR_MS = 15 * 60_000
const RUN_MS = 30_000
const DL_MS = 300_000
const PIP_MS = 600_000
// The most bytes one $.fs.read gives.
const CHUNK = 4 * 1024 * 1024
// A command nobody allows: when it runs with no prompt, the mode allows every command, and only an
// allow that a rule in the person's own settings.json gave counts.
const CANARY = 'company-setup-probe'
const AGAIN = 'Select Set up in the Company pane to try again.'

// Forms with a flag that writes a file, deletes or runs a program. The RTK rule covers every flag, so
// the original must run with no prompt with such a flag too (a rule of the person's), not only as a read.
const WRITE_PROBE: Record<string, string> = {
  'git log': 'git log --output=x',
  'git diff': 'git diff --output=x',
  'git show': 'git show --output=x',
  'git stash list': 'git stash list --output=x',
  'git branch': 'git branch -D x',
  find: 'find . -delete',
  rg: 'rg --pre sh x',
}

// Each form the rewriter may give (asTyped forms never get an rtk form): a sample of the command as
// typed, and the allow rule for its RTK form. Never `Bash(rtk:*)`, never a write form.
export const MIRRORS: readonly { sample: string; probe?: string; rule: string }[] = FORMS.filter((f) => !f.asTyped).map((f) => {
  const sample = f.words.join(' ')
  return { sample, probe: WRITE_PROBE[sample], rule: `Bash(rtk ${sample}:*)` }
})

// rtk 1.2.1 or newer: setup never puts the pinned build over a newer one.
export function rtkFits(stdout: string): boolean {
  const v = /^rtk (\d+)\.(\d+)\.(\d+)/.exec(stdout.trim())
  if (!v) return false
  const pin = RTK.version.slice(1).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = Number(v[i + 1]) - (pin[i] ?? 0)
    if (d) return d > 0
  }
  return true
}

// What the dashboard shows: not asked, declined (or undone), done, or failed with its reason.
export function setupStatus(s: Shared): { state: SetupState; reason?: string } {
  return { state: s.setup.state, ...(s.setup.reason !== undefined ? { reason: s.setup.reason } : {}) }
}

export function registerSetup(on: On, ctx: Ctx): void {
  on('session.start', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await setupStart($, e, beneath(next), ctx.shared); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

// The flag and the box come after the modules beneath start, and the start never waits for them.
async function setupStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], st: Shared) {
  const r = await next(e)
  void boxOnce($, st, e.isInteractive !== false).catch(() => {})
  return r
}

// Reads the flag; on a machine never asked, a person at the prompt gets the box once this session.
// A store that does not answer within FLAG_MS, or cannot be read, is unknown: no box. No box while a
// run goes on here or in another session.
async function boxOnce($: EngineInterface, st: Shared, interactive: boolean): Promise<void> {
  let stored: unknown = null
  const late = await within($, $.store.get('setup').then((v) => void (stored = v), () => {}), FLAG_MS)
  if (late || stored === null) return
  const flag = readFlag(stored)
  if (flag) st.setup = { ...flag, running: st.setup.running }
  if (flag || !interactive || st.offMachine || st.setup.running || (await ci($)) || (await runElsewhere($))) return
  await offer($, st)
}

// The time a run of this machine's setup started, in any session (every session shares the store),
// when it is RUN_FOR_MS old or less.
async function runElsewhere($: EngineInterface): Promise<boolean> {
  const r = await $.store.get('setupRun').catch(() => undefined)
  return isRecord(r) && typeof r.at === 'number' && (await now($)) - r.at < RUN_FOR_MS
}

async function now($: EngineInterface): Promise<number> {
  const t = Number(await $.clock.now().catch(() => Date.now()))
  return Number.isFinite(t) ? t : Date.now()
}

async function ci($: EngineInterface): Promise<boolean> {
  const unset = () => undefined
  return truthy(await $.env.get('CI').catch(unset)) || truthy(await $.env.get('GITHUB_ACTIONS').catch(unset))
}

// The box. A dismissed box, a `-p` run (the ask rejects) and free text leave the flag unset: the box
// comes back next session. Never throws.
async function offer($: EngineInterface, st: Shared): Promise<void> {
  let answer: string
  try {
    answer = await $.ui.ask(QUESTION, ['Yes', 'Not now'])
  } catch {
    return
  }
  if (answer === 'Yes') return runSetup($, st)
  if (answer !== 'Not now') return
  st.setup = { state: 'declined', running: st.setup.running }
  await $.store.set('setup', { state: 'declined' }).catch(() => {})
  showStatus($, st)
}

// The Yes answer, and the pane's Set up button. One run at a time; never in a cloud session.
// Never throws: the outcome is the stored flag and one notice.
export async function runSetup($: EngineInterface, st: Shared): Promise<void> {
  if (st.setup.running) return
  if (st.offMachine) return tell($, 'Setup is off in cloud sessions. Start Company on your own computer to set it up.')
  st.setup.running = true
  let end: End
  let mine = false
  try {
    if (await runElsewhere($)) {
      st.setup.running = false
      return tell($, 'Setup runs in another session now. Try again when it ends.')
    }
    // Stored before the run starts, so the box and Set up in another session wait for it.
    await $.store.set('setupRun', { at: await now($) })
    mine = true
    end = await setUp($)
  } catch (err) {
    const why = cutCodePoints(redact(String(err)), 120)
    end = { reason: why, text: `Setup stopped: ${why}. ${AGAIN}` }
  }
  if (mine) await $.store.delete('setupRun').catch(() => {})
  const flag = { state: end.reason === undefined ? 'done' : 'failed', ...(end.reason !== undefined ? { reason: end.reason } : {}) } as const
  st.setup = { ...flag, running: false }
  await $.store.set('setup', flag).catch(() => {})
  tell($, end.text)
  showStatus($, st)
}

// The settings file is checked first, so a file Company cannot merge stops setup before anything
// changes; RTK next, so a failed download or a hash mismatch also stops it with nothing changed.
// The merge works on the text of this first read; the write checks the file still holds it.
async function setUp($: EngineInterface): Promise<End> {
  const p = await place($)
  if (!p) return { reason: 'no home folder', text: 'Setup stopped: Company cannot find your home folder. Company made no changes.' }
  const was = await readText($, p.settings)
  const user = parse(was)
  if (typeof user === 'string') return refused(p, user)
  const rtk = await installRtk($, p)
  if (typeof rtk !== 'string') return rtk
  const graph = await installGraphify($, p)
  // Found by a full path, not by the PATH: the modules use that path, but RTK's rewrites run rtk by
  // its name in Bash, and your own terminal needs the PATH too.
  const away = [...new Set([rtk, typeof graph === 'string' ? graph : ''].filter((b) => /[\\/]/.test(b)).map(folderOf))]
  const path = away.length ? ` Add ${away.join(' and ')} to your PATH. Then start a new session.` : ''
  const merged = mergeSettings(was, await mirrorRules($, listOf(user.permissions, 'allow')))
  if ('refuse' in merged) return refused(p, merged.refuse)
  const saved = await writeSettings($, p.settings, merged)
  if (saved === 'changed') {
    return { reason: 'settings.json changed during setup', text: `Setup stopped: ${p.settings} changed while setup ran. Company changed no settings. ${AGAIN}` }
  }
  const n = merged.added.allow.length
  const done =
    `Company added ${n} RTK allow ${n === 1 ? 'rule' : 'rules'} to ${p.settings} and loads first from the next session.` +
    (merged.added.ponytail ? ` It sets ${PONYTAIL} to ultra.` : '') +
    (saved.bak ? ` A copy of your settings from ${saved.since} is in ${saved.bak}.` : '')
  if (typeof graph !== 'string') return { reason: graph.reason, text: `RTK ${RTK.version.slice(1)} is on this machine.${path} ${done} ${graph.text}` }
  return { text: `Setup is done. RTK ${RTK.version.slice(1)} and graphify ${GRAPHIFY_VERSION} are on this machine.${path} ${done}` }
}

function refused(p: Place, why: string): End {
  return { reason: `settings.json ${why}`, text: `Setup stopped: ${p.settings} ${why}. Company made no changes. Correct the file. ${AGAIN}` }
}

// Undefined when there is no home folder.
async function place($: EngineInterface): Promise<Place | undefined> {
  const m = await $.session.machine().catch(() => undefined)
  const win = m?.sysname === 'Windows_NT'
  const os = win ? 'win32' : m?.sysname === 'Darwin' ? 'darwin' : m?.sysname === 'Linux' ? 'linux' : undefined
  const hw = (m?.machine ?? '').toLowerCase()
  const arch = hw === 'x86_64' || hw === 'amd64' ? 'x64' : hw === 'arm64' || hw === 'aarch64' ? 'arm64' : undefined
  const home = await homeDir($, win)
  if (!home) return undefined
  const sep = win ? '\\' : '/'
  const at = (...names: string[]) => [home, ...names].join(sep)
  const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined))?.replace(/[\\/]+$/, '') || at('.claude')
  return { win, ...(os && arch ? { key: `${os}-${arch}` } : {}), sep, bin: at('.local', 'bin'), settings: `${config}${sep}settings.json`, dl: `${config}${sep}company-setup` }
}

// A run that cannot start or does not end in time is undefined.
async function run($: EngineInterface, argv: string[], timeoutMs: number) {
  return $.process.run(argv, { timeoutMs }).catch(() => undefined)
}

// The text, or undefined when there is no file. Throws when the read fails otherwise.
async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  return $.fs.read(path).catch((err: unknown) => {
    if (missing(err)) return undefined
    throw err
  })
}

// RTK at the pinned version or newer that answers `rtk gain`: its name or path.
async function hasRtk($: EngineInterface, bins: readonly string[]): Promise<string | undefined> {
  const { bin } = await firstBin($, bins, rtkFits, RUN_MS)
  return bin !== undefined && (await run($, [bin, 'gain'], RUN_MS))?.exitCode === 0 ? bin : undefined
}

// Downloads the pinned build, checks its SHA-256 before it unpacks, and puts the binary in the bin
// folder. Returns how RTK runs (its name or full path), or why not.
async function installRtk($: EngineInterface, p: Place): Promise<string | End> {
  const exe = p.win ? 'rtk.exe' : 'rtk'
  const path = `${p.bin}${p.sep}${exe}`
  const had = await hasRtk($, [...bare('rtk', p.win), path])
  if (had !== undefined) return had
  const broken = { reason: 'RTK does not start', text: `Setup stopped: RTK in ${p.bin} does not start. Company changed no settings. ${AGAIN}` }
  // A newer RTK there stays, even one that does not answer `rtk gain`.
  const there = await run($, [path, '--version'], RUN_MS)
  if (there?.exitCode === 0 && rtkFits(there.stdout)) return broken
  const asset = p.key === undefined ? undefined : RTK.assets[p.key]
  if (!asset) return { reason: 'no RTK build for this machine', text: `Setup stopped: RTK ${RTK.version} has no build for this machine (${p.key ?? 'unknown'}). Company made no changes.` }
  // A folder of this run's own: two runs never share a download.
  const tmp = `${p.dl}${p.sep}${crypto.randomUUID()}`
  const archive = `${tmp}${p.sep}${asset.name}`
  const fresh = `${tmp}${p.sep}${exe}`
  try {
    const got = await run($, ['curl', '-fsSL', '--proto', '=https', '--max-filesize', '67108864', '--create-dirs', '-o', archive, `${BASE}/${asset.name}`], DL_MS)
    if (got?.exitCode !== 0) return { reason: 'RTK download failed', text: `Setup stopped: Company cannot download RTK. Check the network connection. Company made no changes. ${AGAIN}` }
    if ((await sha256($, archive)) !== asset.sha256) {
      return { reason: 'RTK download has the wrong SHA-256', text: 'Setup stopped: the RTK download does not have the correct SHA-256. Company did not install it and made no changes.' }
    }
    // Unpacked and checked in the run's folder; only a binary that answers goes into the bin folder.
    if ((await run($, ['tar', p.win ? '-xf' : '-xzf', archive, '-C', tmp, exe], RUN_MS))?.exitCode !== 0 || (await hasRtk($, [fresh])) === undefined) return broken
    if (!(await $.fs.exists(p.bin).catch(() => false))) await run($, p.win ? ['cmd', '/d', '/c', 'mkdir', p.bin] : ['mkdir', '-p', '--', p.bin], RUN_MS)
    const moved = await run($, p.win ? ['cmd', '/d', '/c', 'move', '/y', fresh, path] : ['mv', '-f', '--', fresh, path], RUN_MS)
    if (moved?.exitCode !== 0) return { reason: 'RTK did not move', text: `Setup stopped: Company cannot put RTK into ${p.bin}. Company changed no settings. ${AGAIN}` }
  } finally {
    await run($, deleteArgv(tmp, p.win ? 'windows' : undefined), RUN_MS)
  }
  return (await hasRtk($, [...bare('rtk', p.win), path])) ?? broken
}

// The file's SHA-256 in hex, read in ranges the engine allows.
async function sha256($: EngineInterface, path: string): Promise<string> {
  const { size } = await $.fs.stat(path)
  const all = new Uint8Array(size)
  for (let at = 0; at < size; at += CHUNK) {
    const { base64 } = await $.fs.read(path, { as: 'bytes', offset: at, length: Math.min(CHUNK, size - at) })
    all.set(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), at)
  }
  return digestHex(all)
}

export async function digestHex(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// graphify at the pinned version, on the PATH or where uv, pipx or pip put it: its name or path.
async function hasGraphify($: EngineInterface, p: Place): Promise<string | undefined> {
  return (await firstBin($, bare('graphify', p.win), GRAPHIFY_FITS, RUN_MS)).bin ?? (await firstBin($, await graphifyPaths($, p.win), GRAPHIFY_FITS, RUN_MS)).bin
}

// uv, else pipx, else pip for Python 3.11 or newer; else the steps. Returns how graphify runs, or why not.
async function installGraphify($: EngineInterface, p: Place): Promise<string | End> {
  const had = await hasGraphify($, p)
  if (had !== undefined) return had
  const py = p.win ? 'python' : 'python3'
  for (const argv of [['uv', 'tool', 'install', GRAPHIFY], ['pipx', 'install', GRAPHIFY], [py, '-m', 'pip', 'install', '--user', GRAPHIFY]]) {
    if (argv[0] === py && !(Number(/^Python 3\.(\d+)/.exec((await run($, [py, '--version'], RUN_MS))?.stdout.trim() ?? '')?.[1]) >= 11)) continue
    if ((await run($, argv, PIP_MS))?.exitCode !== 0) continue
    const bin = await hasGraphify($, p)
    if (bin !== undefined) return bin
  }
  return {
    reason: 'graphify not installed',
    text: `Company cannot install graphify. It needs uv, pipx or Python 3.11. Install uv, then run: uv tool install ${GRAPHIFY}`,
  }
}

// The rules to add: the mirror of each form whose original runs with no prompt in every project. A
// rule counts only when it is in the person's own settings.json (`mine`): a project, local,
// `--settings` or policy rule holds for less. An allow with no rule counts only for the read (the
// engine's own read-only check) and never in a mode that allows every command: a write form allowed
// with no rule is a mode's or a plugin's allow.
// shortcut: a plugin's allow of a read looks like the engine's own (Company's query skips only Company's hooks); upgrade when a verdict names its source.
async function mirrorRules($: EngineInterface, mine: readonly string[]): Promise<string[]> {
  const all = await verdict($, CANARY)
  const counts = (v: { decision?: unknown; rule?: unknown }, write: boolean) =>
    v.decision === 'allow' && (typeof v.rule === 'string' ? mine.includes(v.rule) : v.rule === undefined && !write && all.decision !== 'allow')
  const out: string[] = []
  for (const m of MIRRORS) if (counts(await verdict($, m.sample), false) && (m.probe === undefined || counts(await verdict($, m.probe), true))) out.push(m.rule)
  return out
}

// The engine's verdict for a Bash command, read with no type: its fields differ per engine. A check
// that rejects is no allow.
async function verdict($: EngineInterface, command: string): Promise<{ decision?: unknown; rule?: unknown }> {
  return $.tool.check({ tool: 'Bash', input: { command } }).then(
    (v) => v as { decision?: unknown; rule?: unknown },
    () => ({}),
  )
}

// First the file is read again: a change since the first read (the person's, another session's) is
// never written over ('changed'). Then the backup (only when there is none yet: an older one holds the
// settings from before Company), the record of the additions, and the file. `since`: the backup's date.
async function writeSettings($: EngineInterface, path: string, merged: { text: string; was?: string; added: Added }): Promise<{ bak?: string; since?: string } | 'changed'> {
  if (!merged.added.allow.length && !merged.added.plugins.length && !merged.added.ponytail) return {}
  if ((await readText($, path)) !== merged.was) return 'changed'
  const bak = `${path}.company-bak`
  let since: string | undefined
  if (merged.was !== undefined) {
    const old = await $.fs.stat(bak).catch((err: unknown) => {
      if (missing(err)) return undefined
      throw err
    })
    if (!old) await $.fs.write(bak, merged.was)
    since = new Date(old ? old.mtimeMs : await now($)).toISOString().slice(0, 10)
  }
  const rec = await $.store.get('setupAdded')
  // The first record of ponytail's mode stays: it holds the value from before any setup.
  const ponytail = isRecord(rec) && isRecord(rec.ponytail) ? rec.ponytail : merged.added.ponytail
  await $.store.set('setupAdded', {
    allow: [...new Set([...listOf(rec, 'allow'), ...merged.added.allow])],
    plugins: [...new Set([...listOf(rec, 'plugins'), ...merged.added.plugins])],
    made: [...new Set([...listOf(rec, 'made'), ...merged.added.made])],
    ...(ponytail ? { ponytail } : {}),
  })
  await $.fs.write(path, merged.text)
  return since === undefined ? {} : { bak, since }
}

// The pane's Undo setup button: takes the recorded additions out of settings.json and leaves the
// rest as it is. RTK and graphify stay installed. Never throws.
export async function undoSetup($: EngineInterface, st: Shared): Promise<void> {
  if (st.setup.running) return
  st.setup.running = true
  try {
    const p = await place($)
    if (!p) return tell($, 'Undo stopped: Company cannot find your home folder. Company made no changes.')
    const rec = await $.store.get('setupAdded')
    const added = { allow: listOf(rec, 'allow'), plugins: listOf(rec, 'plugins'), made: listOf(rec, 'made'), ...(isRecord(rec) && isRecord(rec.ponytail) ? { ponytail: rec.ponytail } : {}) }
    const now = await readText($, p.settings)
    const out = now === undefined ? { text: '', removed: 0 } : unmergeSettings(now, added)
    if ('refuse' in out) return tell($, `Undo stopped: ${p.settings} ${out.refuse}. Company made no changes. Correct the file. Then select Undo setup again.`)
    if (out.removed) await $.fs.write(p.settings, out.text)
    await $.store.delete('setupAdded')
    st.setup = { ...st.setup, state: 'declined', reason: 'undone' }
    await $.store.set('setup', { state: 'declined', reason: 'undone' })
    tell($, `Company removed ${out.removed} ${out.removed === 1 ? 'entry' : 'entries'} that setup added to ${p.settings}. RTK and graphify stay installed.`)
  } catch (err) {
    tell($, `Undo stopped: ${cutCodePoints(redact(String(err)), 120)}.`)
  } finally {
    st.setup.running = false
    showStatus($, st)
  }
}

// The settings with the rules, Company at the front of prependPlugins (the person's order stays) and
// ponytail's mode ultra, what was added, and the old text; or why not.
export function mergeSettings(text: string | undefined, allow: readonly string[]): { text: string; was?: string; added: Added } | { refuse: string } {
  const s = parse(text)
  if (typeof s === 'string') return { refuse: s }
  const made = [
    ...(s.permissions === undefined ? ['permissions'] : []),
    ...(isRecord(s.permissions) && s.permissions.allow !== undefined ? [] : ['allow']),
    ...(s.prependPlugins === undefined ? ['prependPlugins'] : []),
    ...(s.env === undefined ? ['env'] : []),
  ]
  const perms = (s.permissions ??= {}) as Record<string, unknown>
  const have = (perms.allow ??= []) as unknown[]
  const add = [...new Set(allow)].filter((r) => !have.includes(r))
  have.push(...add)
  const plugins = (s.prependPlugins ??= []) as unknown[]
  const first = plugins.includes(COMPANY) ? [] : [COMPANY]
  plugins.unshift(...first)
  const env = (s.env ??= {}) as Record<string, unknown>
  const ponytail = env[PONYTAIL] === 'ultra' ? undefined : PONYTAIL in env ? { was: env[PONYTAIL] } : {}
  env[PONYTAIL] = 'ultra'
  return { text: `${JSON.stringify(s, null, 2)}\n`, ...(text !== undefined ? { was: text } : {}), added: { allow: add, plugins: first, made, ...(ponytail ? { ponytail } : {}) } }
}

// The settings with the recorded additions taken out, and how many. A list setup made goes when it
// is left empty; one the person had stays, empty or not.
export function unmergeSettings(text: string, added: Added): { text: string; removed: number } | { refuse: string } {
  const s = parse(text)
  if (typeof s === 'string') return { refuse: s }
  let removed = 0
  const drop = (list: unknown[], gone: readonly string[]) => {
    const keep = list.filter((v) => !(typeof v === 'string' && gone.includes(v)))
    removed += list.length - keep.length
    return keep
  }
  const perms = s.permissions as Record<string, unknown> | undefined
  if (perms && Array.isArray(perms.allow)) {
    perms.allow = drop(perms.allow, added.allow)
    if (!(perms.allow as unknown[]).length && added.made.includes('allow')) delete perms.allow
    if (!Object.keys(perms).length && added.made.includes('permissions')) delete s.permissions
  }
  if (Array.isArray(s.prependPlugins)) {
    s.prependPlugins = drop(s.prependPlugins, added.plugins)
    if (!(s.prependPlugins as unknown[]).length && added.made.includes('prependPlugins')) delete s.prependPlugins
  }
  // ponytail's mode goes back to what it was, unless the person set another since.
  const env = s.env
  if (added.ponytail && isRecord(env) && env[PONYTAIL] === 'ultra') {
    if ('was' in added.ponytail) env[PONYTAIL] = added.ponytail.was
    else delete env[PONYTAIL]
    removed += 1
    if (!Object.keys(env).length && added.made.includes('env')) delete s.env
  }
  return { text: `${JSON.stringify(s, null, 2)}\n`, removed }
}

// The settings object, or why Company cannot merge it. No file and a blank file are empty settings.
function parse(text: string | undefined): Record<string, unknown> | string {
  let v: unknown
  try {
    v = text === undefined || !text.trim() ? {} : JSON.parse(text)
  } catch {
    return 'is not valid JSON'
  }
  if (!isRecord(v)) return 'is not a JSON object'
  const perms = v.permissions
  if (perms !== undefined && (!isRecord(perms) || (perms.allow !== undefined && !Array.isArray(perms.allow)))) return 'has a permissions.allow that is not a list'
  if (v.prependPlugins !== undefined && !Array.isArray(v.prependPlugins)) return 'has a prependPlugins that is not a list'
  if (v.env !== undefined && !isRecord(v.env)) return 'has an env that is not an object'
  return v
}

function readFlag(v: unknown): { state: SetupState; reason?: string } | undefined {
  if (!isRecord(v) || !(v.state === 'declined' || v.state === 'done' || v.state === 'failed')) return undefined
  return { state: v.state, ...(typeof v.reason === 'string' ? { reason: v.reason } : {}) }
}

function listOf(rec: unknown, key: 'allow' | 'plugins' | 'made'): string[] {
  const v = isRecord(rec) ? rec[key] : undefined
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// One chat notice. The model never reads notices.
function tell($: EngineInterface, text: string): void {
  void $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `company · SETUP · ${text}` }] } }).catch(() => {})
}
