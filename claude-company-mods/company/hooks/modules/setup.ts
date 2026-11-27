// Setup: once per machine, one engine Yes/No box at session start. Yes installs RTK and graphify
// (pinned), adds allow rules for the RTK form of the read-only commands that already run with no
// prompt, and makes Company load first. It edits the person's own settings.json: it reads and
// checks the file first, writes a backup, merges, and records each addition, so undo takes back
// only those. Each expected miss (a dismissed box, no network, a hash mismatch, invalid JSON) ends
// in one notice and never throws: a throw would take the other company hooks on session.start with it.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { deleteArgv } from '../bashcut'
import { beneath, cutCodePoints, fail, isOn, missing, ok, redact, truthy, type Ctx, type SetupState, type Shared } from '../core'
import { showStatus } from '../host'
import { ready } from '../persist'
import { GRAPHIFY, RTK } from '../pins'
import { FORMS } from '../rtkrules'

type Start = MatchedHook<'session.start', {}>
type Added = { allow: string[]; plugins: string[] }
// Where setup works on this machine. `key` names the RTK build (`linux-x64`); none for an unknown machine.
type Place = { win: boolean; key?: string; sep: string; bin: string; settings: string; dl: string }
// How a run ends: the notice, and the reason the dashboard shows when it did not do it all.
type End = { reason?: string; text: string }

export const QUESTION =
  'Company can set up this machine. It installs RTK and graphify, lets RTK shrink read-only commands you already allow, and loads Company first. Set it up now?'
export const COMPANY = 'company@synced'
const BASE = `https://github.com/rtk-ai/rtk/releases/download/${RTK.version}`
const GRAPHIFY_VERSION = GRAPHIFY.split('==')[1]
const RUN_MS = 30_000
const DL_MS = 300_000
const PIP_MS = 600_000
// The most bytes one $.fs.read gives.
const CHUNK = 4 * 1024 * 1024
// A command nobody allows: when it runs with no prompt, the mode allows every command, and only an
// allow that a settings rule gave counts.
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

// Each RTK read-only form: a sample of the command as typed, and the allow rule for its RTK form.
// cat runs as `rtk read`. Never `Bash(rtk:*)`, never a write form.
export const MIRRORS: readonly { sample: string; probe?: string; rule: string }[] = [
  ...FORMS.filter((f) => !f.asTyped).map((f) => {
    const sample = f.words.join(' ')
    return { sample, probe: WRITE_PROBE[sample], rule: `Bash(rtk ${sample}:*)` }
  }),
  { sample: 'cat', rule: 'Bash(rtk read:*)' },
]

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

// Reads the flag; on a machine never asked, a person at the prompt gets the box once this session.
// The box is not awaited: the session starts while it shows.
async function setupStart($: EngineInterface, e: Parameters<Start>[1], next: Parameters<Start>[2], st: Shared) {
  // A store that cannot be read: unknown, so no box.
  const flag = await $.store.get('setup').then(readFlag, () => null)
  if (flag) st.setup = { ...flag, running: st.setup.running }
  const r = await next(e)
  if (flag === undefined && e.isInteractive !== false && !st.offMachine && !(await ci($))) void offer($, st)
  return r
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
  try {
    end = await setUp($)
  } catch (err) {
    const why = cutCodePoints(redact(String(err)), 120)
    end = { reason: why, text: `Setup stopped: ${why}. ${AGAIN}` }
  }
  const flag = { state: end.reason === undefined ? 'done' : 'failed', ...(end.reason !== undefined ? { reason: end.reason } : {}) } as const
  st.setup = { ...flag, running: false }
  await $.store.set('setup', flag).catch(() => {})
  tell($, end.text)
  showStatus($, st)
}

// The settings file is checked first, so a file Company cannot merge stops setup before anything
// changes; RTK next, so a failed download or a hash mismatch also stops it with nothing changed.
async function setUp($: EngineInterface): Promise<End> {
  const p = await place($)
  if (!p) return { reason: 'no home folder', text: 'Setup stopped: Company cannot find your home folder. Company made no changes.' }
  const bad = parse(await readText($, p.settings))
  if (typeof bad === 'string') return refused(p, bad)
  const rtk = await installRtk($, p)
  if (rtk) return rtk
  // The rtk module finds RTK on the PATH only.
  const path = (await run($, [p.win ? 'rtk.exe' : 'rtk', '--version'], RUN_MS))?.exitCode === 0 ? '' : ` Add ${p.bin} to your PATH. Then start a new session.`
  const graph = await installGraphify($, p)
  const rules = await mirrorRules($)
  const merged = mergeSettings(await readText($, p.settings), rules)
  if ('refuse' in merged) return refused(p, merged.refuse)
  const bak = await writeSettings($, p.settings, merged)
  const n = merged.added.allow.length
  const done =
    `Company added ${n} RTK allow ${n === 1 ? 'rule' : 'rules'} to ${p.settings} and loads first from the next session.` +
    (bak ? ` A copy of your old settings is in ${bak}.` : '')
  if (graph) return { reason: graph.reason, text: `RTK ${RTK.version.slice(1)} is on this machine.${path} ${done} ${graph.text}` }
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
  const home = (win ? await $.env.get('USERPROFILE').catch(() => undefined) : await $.env.get('HOME').catch(() => undefined))?.replace(/[\\/]+$/, '')
  if (!home) return undefined
  const sep = win ? '\\' : '/'
  const at = (...names: string[]) => [home, ...names].join(sep)
  return { win, ...(os && arch ? { key: `${os}-${arch}` } : {}), sep, bin: at('.local', 'bin'), settings: at('.claude', 'settings.json'), dl: at('.claude', 'company-setup') }
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

// RTK at the pinned version that answers `rtk gain`: on the PATH, or in the bin folder.
async function hasRtk($: EngineInterface, path: string): Promise<boolean> {
  for (const bin of ['rtk', path]) {
    const v = await run($, [bin, '--version'], RUN_MS)
    if (v?.exitCode === 0 && /^rtk (\S+)/.exec(v.stdout.trim())?.[1] === RTK.version.slice(1) && (await run($, [bin, 'gain'], RUN_MS))?.exitCode === 0) return true
  }
  return false
}

// Downloads the pinned build, checks its SHA-256 before it unpacks, and puts the binary in the bin folder.
async function installRtk($: EngineInterface, p: Place): Promise<End | undefined> {
  const exe = p.win ? 'rtk.exe' : 'rtk'
  const path = `${p.bin}${p.sep}${exe}`
  if (await hasRtk($, path)) return undefined
  const asset = p.key === undefined ? undefined : RTK.assets[p.key]
  if (!asset) return { reason: 'no RTK build for this machine', text: `Setup stopped: RTK ${RTK.version} has no build for this machine (${p.key ?? 'unknown'}). Company made no changes.` }
  const archive = `${p.dl}${p.sep}${asset.name}`
  try {
    const got = await run($, ['curl', '-fsSL', '--proto', '=https', '--max-filesize', '67108864', '--create-dirs', '-o', archive, `${BASE}/${asset.name}`], DL_MS)
    if (got?.exitCode !== 0) return { reason: 'RTK download failed', text: `Setup stopped: Company cannot download RTK. Check the network connection. Company made no changes. ${AGAIN}` }
    if ((await sha256($, archive)) !== asset.sha256) {
      return { reason: 'RTK download has the wrong SHA-256', text: 'Setup stopped: the RTK download does not have the correct SHA-256. Company did not install it and made no changes.' }
    }
    if (!(await $.fs.exists(p.bin).catch(() => false))) await run($, p.win ? ['cmd', '/d', '/c', 'mkdir', p.bin] : ['mkdir', '-p', '--', p.bin], RUN_MS)
    const x = await run($, ['tar', p.win ? '-xf' : '-xzf', archive, '-C', p.bin, exe], RUN_MS)
    if (x?.exitCode !== 0) return { reason: 'RTK did not unpack', text: `Setup stopped: Company cannot unpack RTK into ${p.bin}. Company changed no settings. ${AGAIN}` }
  } finally {
    await run($, deleteArgv(p.dl, p.win ? 'windows' : undefined), RUN_MS)
  }
  if (!(await hasRtk($, path))) return { reason: 'RTK does not start', text: `Setup stopped: RTK in ${p.bin} does not start. Company changed no settings. ${AGAIN}` }
  return undefined
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

async function hasGraphify($: EngineInterface, path: string): Promise<boolean> {
  for (const bin of ['graphify', path]) {
    const v = await run($, [bin, '--version'], RUN_MS)
    if (v?.exitCode === 0 && /^graphify (\S+)/.exec(v.stdout.trim())?.[1] === GRAPHIFY_VERSION) return true
  }
  return false
}

// uv, else pipx, else pip for Python 3.11 or newer; else the steps.
async function installGraphify($: EngineInterface, p: Place): Promise<End | undefined> {
  const path = `${p.bin}${p.sep}${p.win ? 'graphify.exe' : 'graphify'}`
  if (await hasGraphify($, path)) return undefined
  const py = p.win ? 'python' : 'python3'
  for (const argv of [['uv', 'tool', 'install', GRAPHIFY], ['pipx', 'install', GRAPHIFY], [py, '-m', 'pip', 'install', '--user', GRAPHIFY]]) {
    if (argv[0] === py && !(Number(/^Python 3\.(\d+)/.exec((await run($, [py, '--version'], RUN_MS))?.stdout.trim() ?? '')?.[1]) >= 11)) continue
    if ((await run($, argv, PIP_MS))?.exitCode === 0 && (await hasGraphify($, path))) return undefined
  }
  return {
    reason: 'graphify not installed',
    text: `Company cannot install graphify. It needs uv, pipx or Python 3.11. Install uv, then run: uv tool install ${GRAPHIFY}`,
  }
}

// The rules to add: the mirror of each form whose original runs with no prompt.
async function mirrorRules($: EngineInterface): Promise<string[]> {
  const all = await verdict($, CANARY)
  const counts = (v: { decision?: unknown; rule?: unknown }) => v.decision === 'allow' && (all.decision !== 'allow' || typeof v.rule === 'string')
  const out: string[] = []
  for (const m of MIRRORS) if (counts(await verdict($, m.sample)) && (m.probe === undefined || counts(await verdict($, m.probe)))) out.push(m.rule)
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

// The backup (only when there is none yet: an older one holds the settings from before Company),
// the record of the additions, then the file. Returns the backup's path when the old file had one.
async function writeSettings($: EngineInterface, path: string, merged: { text: string; was?: string; added: Added }): Promise<string | undefined> {
  if (!merged.added.allow.length && !merged.added.plugins.length) return undefined
  const bak = `${path}.company-bak`
  if (merged.was !== undefined && !(await $.fs.exists(bak))) await $.fs.write(bak, merged.was)
  const old = await $.store.get('setupAdded')
  await $.store.set('setupAdded', {
    allow: [...new Set([...listOf(old, 'allow'), ...merged.added.allow])],
    plugins: [...new Set([...listOf(old, 'plugins'), ...merged.added.plugins])],
  })
  await $.fs.write(path, merged.text)
  return merged.was === undefined ? undefined : bak
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
    const added = { allow: listOf(rec, 'allow'), plugins: listOf(rec, 'plugins') }
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

// The settings with the rules and Company added at the front of prependPlugins (the person's order
// stays), what was added, and the old text; or why not.
export function mergeSettings(text: string | undefined, allow: readonly string[]): { text: string; was?: string; added: Added } | { refuse: string } {
  const s = parse(text)
  if (typeof s === 'string') return { refuse: s }
  const perms = (s.permissions ??= {}) as Record<string, unknown>
  const have = (perms.allow ??= []) as unknown[]
  const add = [...new Set(allow)].filter((r) => !have.includes(r))
  have.push(...add)
  const plugins = (s.prependPlugins ??= []) as unknown[]
  const first = plugins.includes(COMPANY) ? [] : [COMPANY]
  plugins.unshift(...first)
  return { text: `${JSON.stringify(s, null, 2)}\n`, ...(text !== undefined ? { was: text } : {}), added: { allow: add, plugins: first } }
}

// The settings with the recorded additions taken out, and how many; a list left empty goes.
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
    if (!(perms.allow as unknown[]).length) delete perms.allow
    if (!Object.keys(perms).length) delete s.permissions
  }
  if (Array.isArray(s.prependPlugins)) {
    s.prependPlugins = drop(s.prependPlugins, added.plugins)
    if (!(s.prependPlugins as unknown[]).length) delete s.prependPlugins
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
  return v
}

function readFlag(v: unknown): { state: SetupState; reason?: string } | undefined {
  if (!isRecord(v) || !(v.state === 'declined' || v.state === 'done' || v.state === 'failed')) return undefined
  return { state: v.state, ...(typeof v.reason === 'string' ? { reason: v.reason } : {}) }
}

function listOf(rec: unknown, key: 'allow' | 'plugins'): string[] {
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
