// The rtk rules (spec 7.1): which commands go to `rtk rewrite`, which rewrites stand, and the
// light set. Pure: no `$`.

export const MAX_COMMAND = 2000

// An `rtk ` at a command start: the start of the line, or after `&& `, `|| `, `; `, `| `.
const AT_START = /(^|&& |\|\| |; |\| )rtk /g

// The commands the light mode rewrites, as they follow `rtk `.
export const LIGHT: readonly RegExp[] = [
  /^(git|ls|tree|find|wc)(\s|$)/,
  /^docker (ps|images)(\s|$)/,
  /^kubectl get(\s|$)/,
  /^(pytest|jest|vitest|phpunit|pest)(\s|$)/,
  /^(cargo|go) test(\s|$)/,
]

// Skip a newline (a script), a heredoc, a command already in rtk form, and a long command.
export function shouldTry(cmd: string): boolean {
  return cmd.length > 0 && cmd.length <= MAX_COMMAND && !/[\n\r]/.test(cmd) && !cmd.includes('<<') && !/^\s*rtk\s/.test(cmd)
}

// The rewrite, or null. Only exit 3 with text counts, and only when removing each `rtk ` at a
// command start gives the original exactly. Each removed `rtk ` must also sit outside quotes
// in the original, or it changed a string, not a command.
export function acceptRewrite(original: string, stdout: string, exitCode: number): string | null {
  const out = stdout.trim()
  if (exitCode !== 3 || !out || out === original) return null
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

// Light: every rtk part of the rewrite is in LIGHT. Full: any rewrite rtk knows.
export function inMode(rewritten: string, mode: 'light' | 'full'): boolean {
  if (mode === 'full') return true
  return [...rewritten.matchAll(AT_START)].every((m) => LIGHT.some((re) => re.test(rewritten.slice(m.index + m[0].length))))
}

// The ToolUse card (Task 16). rtk's history keeps no size per command, so it says only this.
export function rtkCard(): string {
  return 'RTK: this command runs in its compact form. Claude sees less output.'
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
