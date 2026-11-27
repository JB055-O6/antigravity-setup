// Where RTK and graphify are when the PATH does not hold their folders. Setup puts RTK in
// <home>/.local/bin; uv and pipx put graphify in their bin folder (by default the same one), pip
// --user in its scripts folder. A lookup that fails gives no path: the caller then finds no binary.
import type { EngineInterface } from 'claude-code'
import { missing } from './core'

const RUN_MS = 5000
// pip's --user scripts folder for this Python: ~/.local/bin, %APPDATA%\Python\Python3xx\Scripts on
// Windows, ~/Library/Python/3.x/bin for the macOS framework build (`--user-base` alone misses the last two).
const PIP_SCRIPTS = 'import sysconfig; print(sysconfig.get_path("scripts", sysconfig.get_preferred_scheme("user")))'

// HOME, or USERPROFILE on Windows, with no separator at the end.
export async function homeDir($: EngineInterface, win: boolean): Promise<string | undefined> {
  const home = win ? await $.env.get('USERPROFILE').catch(() => undefined) : await $.env.get('HOME').catch(() => undefined)
  return home?.replace(/[\\/]+$/, '') || undefined
}

export function join(win: boolean, ...parts: string[]): string {
  return parts.join(win ? '\\' : '/')
}

export function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
}

// The names the PATH finds: on Windows with `.exe` too.
export function bare(name: string, win: boolean): string[] {
  return win ? [name, `${name}.exe`] : [name]
}

export async function rtkPaths($: EngineInterface, win: boolean): Promise<string[]> {
  const home = await homeDir($, win)
  return home ? [join(win, home, '.local', 'bin', win ? 'rtk.exe' : 'rtk')] : []
}

// uv's tool bin folder, then <home>/.local/bin, then pip's --user scripts folder.
export async function graphifyPaths($: EngineInterface, win: boolean): Promise<string[]> {
  const home = await homeDir($, win)
  const dirs = [await lineOf($, ['uv', 'tool', 'dir', '--bin']), home ? join(win, home, '.local', 'bin') : '', await lineOf($, [win ? 'python' : 'python3', '-c', PIP_SCRIPTS])]
  return [...new Set(dirs.filter((d) => d).map((d) => join(win, d.replace(/[\\/]+$/, ''), win ? 'graphify.exe' : 'graphify')))]
}

// The first line a command prints, or '' when it fails.
async function lineOf($: EngineInterface, argv: string[]): Promise<string> {
  const r = await $.process.run(argv, { timeoutMs: RUN_MS }).catch(() => undefined)
  return r?.exitCode === 0 ? (r.stdout.trim().split(/\r?\n/)[0] ?? '') : ''
}

// The first of `bins` whose `--version` matches. `broke`: a run that failed other than by a missing
// binary (a timeout), which the caller counts as a failure when no binary answers.
export async function firstBin($: EngineInterface, bins: readonly string[], version: RegExp, timeoutMs: number): Promise<{ bin?: string; broke?: unknown }> {
  let broke: unknown
  for (const b of bins) {
    const v = await $.process.run([b, '--version'], { timeoutMs }).catch((err: unknown) => {
      if (!missing(err)) broke ??= err
    })
    if (v && v.exitCode === 0 && version.test(v.stdout)) return { bin: b }
  }
  return broke === undefined ? {} : { broke }
}
