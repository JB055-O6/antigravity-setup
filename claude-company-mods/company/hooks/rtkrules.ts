// The rtk rules (spec 7.1, amended): which commands go to `rtk rewrite`, which rewrites stand,
// and the read-only forms. Pure: no `$`.

export const MAX_COMMAND = 2000

// An `rtk ` at a command start: the start of the line, or after `&& `, `|| `, `; `, `| `.
const AT_START = /(^|&& |\|\| |; |\| )rtk /g

// A read-only form: its first words, then a rule on the rest. `never`: no word may match.
// `only`: every word must match. `full`: rtk may run it in full mode only. `asTyped`: read-only,
// but rtk never runs it (cd changes the folder of what follows; cat, head and tail map to
// `rtk read`, which changes the words, so the reversible rule refuses that rewrite).
export type Form = { words: readonly string[]; never?: RegExp; only?: RegExp; full?: true; asTyped?: true }

const OUTPUT = /^--output(=|$)/
const FIND_WRITES = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/

// Everything else is a write, or may be one: never rewritten, in any mode.
export const FORMS: readonly Form[] = [
  { words: ['git', 'status'] },
  { words: ['git', 'log'], never: OUTPUT },
  { words: ['git', 'diff'], never: OUTPUT },
  { words: ['git', 'show'], never: OUTPUT },
  { words: ['git', 'blame'], never: OUTPUT },
  // List only: any other word names a branch to make, or an action.
  { words: ['git', 'branch'], only: /^(-a|-r|-l|-v|-vv|--all|--remotes|--list|--show-current|--verbose|--no-color)$/ },
  { words: ['ls'] },
  // `-o` names an output file, alone or in a bundle (`-ao`).
  { words: ['tree'], never: /^(-[^-]*o|--output)/ },
  { words: ['find'], never: FIND_WRITES },
  { words: ['wc'] },
  { words: ['grep'] },
  // `--pre` runs a command on each file.
  { words: ['rg'], never: /^--pre/ },
  { words: ['docker', 'ps'] },
  { words: ['docker', 'images'] },
  { words: ['docker', 'logs'] },
  { words: ['kubectl', 'get'] },
  { words: ['kubectl', 'describe'] },
  { words: ['kubectl', 'logs'] },
  { words: ['git', 'stash', 'list'], never: OUTPUT, full: true },
  { words: ['diff'], full: true },
  { words: ['gh', 'pr', 'list'], full: true },
  { words: ['gh', 'pr', 'view'], full: true },
  { words: ['gh', 'issue', 'list'], full: true },
  { words: ['gh', 'issue', 'view'], full: true },
  { words: ['gh', 'run', 'list'], full: true },
  { words: ['gh', 'run', 'view'], full: true },
  { words: ['docker', 'compose', 'ps'], full: true },
  { words: ['du'], full: true },
  { words: ['df'], full: true },
  { words: ['jq'], full: true },
  { words: ['pip', 'list'], full: true },
  { words: ['helm', 'list'], full: true },
  { words: ['cd'], asTyped: true },
  { words: ['pwd'], asTyped: true },
  { words: ['echo'], asTyped: true },
  { words: ['true'], asTyped: true },
  { words: ['false'], asTyped: true },
  { words: ['cat'], asTyped: true },
  { words: ['head'], asTyped: true },
  { words: ['tail'], asTyped: true },
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
  return FORMS.find((f) => {
    if (w.length < f.words.length || f.words.some((x, i) => w[i] !== x)) return false
    const rest = w.slice(f.words.length)
    return !rest.some((x) => f.never?.test(x)) && (!f.only || rest.every((x) => f.only!.test(x)))
  })
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
