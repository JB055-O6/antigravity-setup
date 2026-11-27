// The rtk rules (spec 7.1, amended): which commands go to `rtk rewrite`, which rewrites stand,
// and the read-only forms. Pure: no `$`.

export const MAX_COMMAND = 2000

// An `rtk ` at a command start: the start of the line, or after `&& `, `|| `, `; `, `| `.
const AT_START = /(^|&& |\|\| |; |\| )rtk /g

// The flags a form accepts; any other flag means no rewrite. `short`: bare letters, bundled
// freely (`-la`). `shortValue`: letters that take a value (`-n5`, `-n 5`). `long`: bare long
// flags (`--` ends the flags where listed). `longValue`: `--x=v` or `--x v`. `eqOnly`: only
// `--x=v` (the tool's value is optional, so a word after it is not its value). `values`: a rule
// per flag on its value. A value in its own word may not start with `-`, except for find, which
// always takes the next word. `operands`: words that are no flag (paths, revisions, patterns);
// default yes. `find`: whole-word primaries (`-name`), each with the next word as its value.
export type Flags = {
  short?: string
  shortValue?: string
  long?: readonly string[]
  longValue?: readonly string[]
  eqOnly?: readonly string[]
  numeric?: true
  values?: Readonly<Record<string, RegExp>>
  operands?: false
  find?: true
}

// A read-only form: its first words and its flags. `full`: rtk may run it in full mode only.
// `asTyped`: read-only, but rtk never runs it (cd changes the folder of what follows; cat, head
// and tail map to `rtk read`, which changes the words, so the reversible rule refuses that rewrite).
export type Form = { words: readonly string[]; flags: Flags; full?: true; asTyped?: true }

const DIGITS = /^\d+$/
const KUBECTL: Flags = {
  short: 'A',
  shortValue: 'nolc',
  long: ['--all-namespaces'],
  longValue: ['--namespace', '--output', '--selector', '--tail', '--container'],
  values: { '-o': /^(json|yaml|wide|name)$/, '--output': /^(json|yaml|wide|name)$/, '--tail': DIGITS },
}

// Everything else is a write, may be one, or is not reviewed: never rewritten, in any mode.
export const FORMS: readonly Form[] = [
  { words: ['git', 'status'], flags: { short: 'sb', long: ['--short', '--branch', '--porcelain', '--'] } },
  {
    words: ['git', 'log'],
    flags: {
      short: 'p',
      shortValue: 'n',
      numeric: true,
      long: ['--oneline', '--stat', '--shortstat', '--name-only', '--name-status', '--graph', '--decorate', '--no-merges', '--'],
      longValue: ['--format', '--since', '--until', '--author', '--grep'],
      eqOnly: ['--pretty'],
      values: { '-n': DIGITS },
    },
  },
  { words: ['git', 'diff'], flags: { long: ['--stat', '--shortstat', '--name-only', '--name-status', '--cached', '--staged', '--'] } },
  { words: ['git', 'show'], flags: { short: 's', long: ['--stat', '--name-only', '--name-status', '--oneline', '--no-patch', '--'], longValue: ['--format'] } },
  { words: ['git', 'blame'], flags: { short: 'ws', shortValue: 'L', long: ['--'] } },
  // List only: a word that is no flag names a branch to make.
  { words: ['git', 'branch'], flags: { short: 'arvl', long: ['--all', '--remotes', '--list', '--show-current', '--verbose', '--no-color'], operands: false } },
  { words: ['ls'], flags: { short: 'laAhRtrS1dF', long: ['--'] } },
  { words: ['tree'], flags: { short: 'adf', shortValue: 'LI', long: ['--noreport'], values: { '-L': DIGITS } } },
  { words: ['find'], flags: { find: true, longValue: ['-name', '-iname', '-path', '-type', '-maxdepth', '-mindepth', '-newer', '-size', '-mtime'] } },
  { words: ['wc'], flags: { short: 'lwcmL', long: ['--'] } },
  {
    words: ['grep'],
    flags: { short: 'niwlcvFErR', shortValue: 'eABC', long: ['--'], longValue: ['--include', '--exclude'], values: { '-A': DIGITS, '-B': DIGITS, '-C': DIGITS } },
  },
  // Not `-r`: rg's `-r` rewrites what it prints.
  {
    words: ['rg'],
    flags: {
      short: 'niwlcvFS',
      shortValue: 'egtABC',
      long: ['--hidden', '--no-ignore', '--'],
      longValue: ['--glob', '--type'],
      values: { '-A': DIGITS, '-B': DIGITS, '-C': DIGITS },
    },
  },
  { words: ['docker', 'ps'], flags: { short: 'aq', shortValue: 'n', longValue: ['--format'], values: { '-n': DIGITS }, operands: false } },
  { words: ['docker', 'images'], flags: { short: 'aq', longValue: ['--format'] } },
  { words: ['docker', 'logs'], flags: { shortValue: 'n', longValue: ['--tail'], values: { '-n': DIGITS, '--tail': DIGITS } } },
  { words: ['kubectl', 'get'], flags: KUBECTL },
  { words: ['kubectl', 'describe'], flags: KUBECTL },
  { words: ['kubectl', 'logs'], flags: KUBECTL },
  { words: ['git', 'stash', 'list'], flags: { operands: false }, full: true },
  { words: ['diff'], flags: { short: 'uqrwbBi', long: ['--brief', '--'] }, full: true },
  { words: ['cd'], flags: {}, asTyped: true },
  { words: ['pwd'], flags: { operands: false }, asTyped: true },
  { words: ['echo'], flags: { short: 'ne' }, asTyped: true },
  { words: ['true'], flags: {}, asTyped: true },
  { words: ['false'], flags: {}, asTyped: true },
  { words: ['cat'], flags: { short: 'nA', long: ['--'] }, asTyped: true },
  { words: ['head'], flags: { numeric: true, shortValue: 'nc', values: { '-n': DIGITS, '-c': DIGITS } }, asTyped: true },
  { words: ['tail'], flags: { numeric: true, shortValue: 'nc', values: { '-n': DIGITS, '-c': DIGITS } }, asTyped: true },
]

// Skip a newline (a script), a heredoc, a command already in rtk form, and a long command.
export function shouldTry(cmd: string): boolean {
  return cmd.length > 0 && cmd.length <= MAX_COMMAND && !/[\n\r]/.test(cmd) && !cmd.includes('<<') && !/^\s*rtk\s/.test(cmd)
}

// The rewrite, or null. Exit 3, or 0 (the user's allow rules cover it), with text that differs
// from the original, and only when removing each `rtk ` at a command start gives the original
// exactly. Each removed `rtk ` must also sit outside quotes, or it changed a string, not a command.
export function acceptRewrite(original: string, stdout: string, exitCode: number): string | null {
  const out = stdout.trim()
  if ((exitCode !== 3 && exitCode !== 0) || !out || out === original) return null
  let back = ''
  let from = 0
  for (const m of out.matchAll(AT_START)) {
    const at = m.index + (m[1] ?? '').length
    back += out.slice(from, at)
    if (!unquoted(back)) return null
    from = at + 'rtk '.length
  }
  return back + out.slice(from) === original ? out : null
}

// Every part of the rewrite is a read-only form: an rtk part a form of this mode that rtk may
// run, any other part a read-only form as typed. A part the check cannot read is refused.
export function inMode(rewritten: string, mode: 'light' | 'full'): boolean {
  const ps = parts(rewritten)
  if (!ps) return false
  return ps.every((w) => {
    if (w[0] !== 'rtk') return formOf(w) !== undefined
    const f = formOf(w.slice(1))
    return f !== undefined && !f.asTyped && (mode === 'full' || !f.full)
  })
}

// The ToolUse card (Task 16). rtk's history keeps no size per command, so it says only this.
export function rtkCard(): string {
  return 'RTK: this command runs in its compact form. Claude sees less output.'
}

function formOf(w: readonly string[]): Form | undefined {
  return FORMS.find((f) => w.length >= f.words.length && f.words.every((x, i) => w[i] === x) && argsOk(w.slice(f.words.length), f.flags))
}

// Every word after the form's own words is a flag on its list (with a value that passes) or,
// where the form takes them, an operand.
export function argsOk(rest: readonly string[], f: Flags): boolean {
  const valueOk = (flag: string, v: string | undefined, ownWord: boolean) =>
    v !== undefined && v !== '' && (f.find || !ownWord || !v.startsWith('-')) && (f.values?.[flag]?.test(v) ?? true)
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!
    if (!w.startsWith('-') || w === '-') {
      if (f.operands === false) return false
      continue
    }
    if (f.find) {
      if (!f.longValue?.includes(w) || !valueOk(w, rest[++i], true)) return false
      continue
    }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=')
      const name = eq < 0 ? w : w.slice(0, eq)
      const v = eq < 0 ? undefined : w.slice(eq + 1)
      // After `--`, every word is an operand.
      if (w === '--' && f.long?.includes('--')) return f.operands !== false || i === rest.length - 1
      if (f.long?.includes(name) && v === undefined) continue
      if (f.eqOnly?.includes(name) && valueOk(name, v, false)) continue
      if (f.longValue?.includes(name) && (v !== undefined ? valueOk(name, v, false) : valueOk(name, rest[++i], true))) continue
      return false
    }
    if (f.numeric && DIGITS.test(w.slice(1))) continue
    // Short flags, bundled: each letter is checked; a value letter takes the rest of the word or the next one.
    for (let k = 1; k < w.length; k++) {
      const c = w[k]!
      if (f.short?.includes(c)) continue
      if (!f.shortValue?.includes(c)) return false
      const inline = w.slice(k + 1)
      if (!(inline ? valueOk(`-${c}`, inline, false) : valueOk(`-${c}`, rest[++i], true))) return false
      break
    }
  }
  return true
}

// The command split at unquoted `&&`, `||` and `;`, each part as its words with quotes removed,
// as bash passes them. Null for what this check cannot see through: a pipe (a compact left side
// changes what the right side reads), `$` (a variable or `$(...)`), backticks, `&` alone, `(`,
// `)`, `<`, a brace or a glob (`{`, `*`, `?`, `[`: a file name like `--output=x` can expand into
// a flag), a newline, an empty part, and any `>` but `>&1`, `>&2` and `> /dev/null`.
export function parts(cmd: string): string[][] | null {
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  // The word holds a quote or an escape: then a digit before `>` is a word, not a stream.
  let quoted = false
  let q = ''
  const endWord = () => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
    quoted = false
  }
  // False for an empty part.
  const endPart = () => {
    endWord()
    if (!words.length) return false
    out.push(words)
    words = []
    return true
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (q === "'") {
      if (c === "'") q = ''
      else word += c
      continue
    }
    if (c === '$' || c === '`' || c === '\n' || c === '\r') return null
    if (c === '\\') {
      const n = cmd[i + 1]
      if (n === undefined || n === '\n' || n === '\r') return null
      word += n
      i++
      inWord = quoted = true
      continue
    }
    if (q === '"') {
      if (c === '"') q = ''
      else word += c
      continue
    }
    if (c === "'" || c === '"') {
      q = c
      inWord = quoted = true
    } else if (c === ' ' || c === '\t') endWord()
    else if (c === '>' || (c === '&' && cmd[i + 1] === '>')) {
      // An unquoted lone digit right before `>` or `>>` names the stream; before `&>` it is a word.
      if (c === '>' && !quoted && /^\d$/.test(word)) {
        word = ''
        inWord = false
      } else endWord()
      const m = /^(&>|>>?)(&[12]|[ \t]*\/dev\/null)(?![^ \t;&|])/.exec(cmd.slice(i))
      if (!m) return null
      i += m[0].length - 1
    } else if ((c === '&' || c === '|') && cmd[i + 1] === c) {
      if (!endPart()) return null
      i++
    } else if (c === ';') {
      if (!endPart()) return null
    } else if ('&|()<{*?['.includes(c)) return null
    else {
      word += c
      inWord = true
    }
  }
  if (q || !endPart()) return null
  return out
}

// True when the text ends outside single and double quotes (a backslash escapes outside '').
function unquoted(s: string): boolean {
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q === "'") {
      if (c === "'") q = ''
    } else if (c === '\\') i++
    else if (q === '"') {
      if (c === '"') q = ''
    } else if (c === "'" || c === '"') q = c
  }
  return q === ''
}
