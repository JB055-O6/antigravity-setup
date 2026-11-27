import { expect, test } from 'claude-code/testing'
import { FORMS, acceptRewrite, inMode, parts, rtkCard, shouldTry } from './rtkrules'

test('shouldTry: heredoc, newline, rtk prefix, empty and over 2,000 chars are skipped', () => {
  expect(shouldTry('git status')).toBe(true)
  expect(shouldTry("cat <<'EOF' > a.txt")).toBe(false)
  expect(shouldTry('git status\ngit log')).toBe(false)
  expect(shouldTry('git status\rgit log')).toBe(false)
  expect(shouldTry('rtk git status')).toBe(false)
  expect(shouldTry('  rtk git status')).toBe(false)
  expect(shouldTry('')).toBe(false)
  const at = (n: number) => 'ls ' + 'a'.repeat(n - 3)
  expect(shouldTry(at(2000))).toBe(true)
  expect(shouldTry(at(2001))).toBe(false)
})

test('acceptRewrite: the rtk form of a command and of a chain', () => {
  expect(acceptRewrite('git status', 'rtk git status\n', 3)).toBe('rtk git status')
  expect(acceptRewrite('cd x && git log -5', 'cd x && rtk git log -5\n', 3)).toBe('cd x && rtk git log -5')
  expect(acceptRewrite('git status; false', 'rtk git status; false', 3)).toBe('rtk git status; false')
  expect(acceptRewrite('git log -5 || true', 'rtk git log -5 || true', 3)).toBe('rtk git log -5 || true')
  expect(acceptRewrite('ls | grep foo', 'ls | rtk grep foo', 3)).toBe('ls | rtk grep foo')
})

// Review Focus 1: pipes and redirects stay exactly as typed.
test('pipes and redirects: accepted only when they stay exactly as typed', () => {
  for (const [original, stdout, want] of [
    ['git diff | head -50', 'rtk git diff | head -50', 'rtk git diff | head -50'],
    ['git diff | head -50', 'rtk git diff', null],
    ['git diff | head -50', 'rtk git diff | head -5', null],
    ['git diff | head -50', 'rtk git diff |head -50', null],
    ['git diff | head -50', 'rtk git diff | rtk head -50', 'rtk git diff | rtk head -50'],
    ['git log > out.txt', 'rtk git log > out.txt', 'rtk git log > out.txt'],
    ['git log > out.txt', 'rtk git log', null],
    ['git log > out.txt', 'rtk git log >> out.txt', null],
    ['git log > out.txt', 'rtk git log > out.txt 2>&1', null],
    ['git status 2>&1', 'rtk git status 2>&1', 'rtk git status 2>&1'],
    ['git status 2>&1', 'rtk git status', null],
  ] as const) expect([original, stdout, acceptRewrite(original, stdout, 3)]).toEqual([original, stdout, want])
})

test('acceptRewrite: no rewrite unless exit 3 or 0 with new text', () => {
  expect(acceptRewrite('git status', '', 3)).toBeNull()
  expect(acceptRewrite('git status', ' \n', 3)).toBeNull()
  expect(acceptRewrite('git status', 'rtk git status', 1)).toBeNull()
  expect(acceptRewrite('git status', 'rtk git status', 2)).toBeNull()
  // Exit 0: the user's allow rules cover the command; the same rules hold as for 3.
  expect(acceptRewrite('git status', 'rtk git status\n', 0)).toBe('rtk git status')
  expect(acceptRewrite('git status', 'git status', 0)).toBeNull()
  expect(acceptRewrite('git status', 'rtk git status -s', 0)).toBeNull()
  // The same text back is no rewrite.
  expect(acceptRewrite('git status', 'git status', 3)).toBeNull()
})

test('acceptRewrite: any change but an added rtk is refused', () => {
  // Quoting
  expect(acceptRewrite("git commit -m 'a b'", 'rtk git commit -m "a b"', 3)).toBeNull()
  expect(acceptRewrite("git commit -m 'a b'", "rtk git commit -m 'a b'", 3)).toBe("rtk git commit -m 'a b'")
  // An env prefix: rtk after `FOO=1 ` is not at a command start the rule knows.
  expect(acceptRewrite('FOO=1 git status', 'FOO=1 rtk git status', 3)).toBeNull()
  // Words dropped or changed
  expect(acceptRewrite('vitest run', 'rtk vitest', 3)).toBeNull()
  expect(acceptRewrite('npx jest', 'rtk jest', 3)).toBeNull()
  expect(acceptRewrite('cat README.md', 'rtk read README.md', 3)).toBeNull()
  // An rtk the original already has is not removed to make the two match.
  expect(acceptRewrite('cd x && rtk git log', 'rtk cd x && rtk git log', 3)).toBeNull()
})

test('acceptRewrite: an rtk put inside quotes changes the text, so it is refused', () => {
  expect(acceptRewrite('echo "a && git status"', 'echo "a && rtk git status"', 3)).toBeNull()
  expect(acceptRewrite("echo 'a; git log' && git log", "echo 'a; rtk git log' && rtk git log", 3)).toBeNull()
  expect(acceptRewrite('echo "it\'s" && git log', 'echo "it\'s" && rtk git log', 3)).toBe('echo "it\'s" && rtk git log')
  expect(acceptRewrite('echo \\" && git log', 'echo \\" && rtk git log', 3)).toBe('echo \\" && rtk git log')
})

test('acceptRewrite: a leading dash in the arguments keeps the check whole', () => {
  expect(acceptRewrite('rm -rf dist && git status', 'rm -rf dist && rtk git status', 3)).toBe('rm -rf dist && rtk git status')
  expect(acceptRewrite('rm -rf dist && git status', 'rm dist && rtk git status', 3)).toBeNull()
  expect(acceptRewrite('rm -rf dist && git status', 'rtk rm -rf dist && rtk git status', 3)).toBe('rtk rm -rf dist && rtk git status')
  expect(acceptRewrite('ls -la', 'rtk ls -la', 3)).toBe('rtk ls -la')
  expect(acceptRewrite('ls -la', 'rtk ls', 3)).toBeNull()
})

test('inMode: light takes the read-only forms, full adds more read-only forms', () => {
  for (const c of [
    'rtk git status', 'cd x && rtk git log -5', 'rtk git diff | head -50', 'rtk git show HEAD', 'rtk git blame a.ts', 'rtk git branch',
    'rtk git branch -a', 'rtk ls -la', 'rtk tree -L 2', 'rtk find . -name "*.ts" -type f', 'rtk wc -l a', 'ls | rtk grep foo',
    'rtk rg -n "a|b" src', 'rtk docker ps', 'rtk docker images', 'rtk docker logs x', 'rtk kubectl get pods', 'rtk kubectl describe pod x',
    'rtk kubectl logs x', 'rtk git status; false', 'rtk git log -5 || true', 'rtk git status 2>&1', 'rtk ls 2>/dev/null', 'rtk git diff >/dev/null',
    "rtk git log --format='%h $s'", 'rtk find . \\( -name a -o -name b \\)',
  ]) {
    expect([c, inMode(c, 'light')]).toEqual([c, true])
    expect([c, inMode(c, 'full')]).toEqual([c, true])
  }
  for (const c of ['rtk git stash list', 'rtk diff a b', 'rtk gh pr list', 'rtk gh issue view 3', 'rtk docker compose ps', 'rtk du -sh .', 'rtk df -h', 'rtk jq . a.json', 'rtk pip list', 'rtk helm list']) {
    expect([c, inMode(c, 'light')]).toEqual([c, false])
    expect([c, inMode(c, 'full')]).toEqual([c, true])
  }
  // Test runners are not on the list (yet), and cat, head and tail stand only as typed.
  for (const c of ['rtk pytest -q', 'rtk cargo test', 'rtk go test ./...', 'rtk jest', 'rtk read README.md', 'rtk cat a', 'rtk head -5 a', 'rtk cd x && rtk ls', 'rtk gitx', 'rtk git-foo']) {
    expect([c, inMode(c, 'light'), inMode(c, 'full')]).toEqual([c, false, false])
  }
  expect(FORMS.every((f) => f.words.length > 0)).toBe(true)
})

// Ruling: a mutating command is never rewritten, in any mode, even when rtk offers it and the
// permission checks allow both forms.
const FORBIDDEN = [
  'git push origin main', 'git push --force', 'git commit -m x', 'git checkout -- .', 'git switch main', 'git reset --hard',
  'git rebase main', 'git merge x', 'git branch -d x', 'git branch new', 'git branch -D x', 'git stash', 'git stash pop', 'rm -rf x', 'mv a b', 'cp a b',
  'find . -delete', 'find . -name x -exec rm {} \\;', 'find . -execdir rm {} +', 'find . -ok rm {} \\;', 'find . -okdir rm {} \\;',
  'find . -fprint out', 'find . -fprint0 out', 'find . -fprintf out %p', 'find . -fls out', 'find . "-delete"', "find . '-exec' rm {} +",
  'npm install x', 'pip install x', 'cargo add x', 'go get x', 'git log --output=x', 'git diff --output x', 'tree -o out', 'rg --pre sh foo',
  'git status && git push', 'git push && git status', 'git status; rm -rf x', 'git status;git push', 'git status | xargs rm', 'git log > out.txt',
  'git log >> out.txt', 'git status & git push', 'git log $(git push)', 'git log `git push`', 'git log "$X"', 'find . $ACTION', '(git push)',
  'git status |& tee x', 'ls < x', 'FOO=1 git status', 'sudo ls', 'git status | tee out.txt', 'cat a | sh', 'git -C x push',
] as const

test('forbidden forms: never rewritten in light or full, whatever rtk offers', () => {
  for (const cmd of FORBIDDEN) {
    // rtk's offer: `rtk ` at every command start, or at the first one only.
    for (const offer of [cmd.replace(/(^|&& |\|\| |; |\| )/g, '$1rtk '), `rtk ${cmd}`]) {
      const out = acceptRewrite(cmd, offer, 3)
      for (const mode of ['light', 'full'] as const) expect([cmd, offer, mode, out !== null && inMode(out, mode)]).toEqual([cmd, offer, mode, false])
    }
  }
})

test('parts: words as the shell passes them; null for what the check cannot read', () => {
  expect(parts('cd x && git log -5 | head -50')).toEqual([['cd', 'x'], ['git', 'log', '-5'], ['head', '-50']])
  expect(parts(`grep -rn "a|b; c" 'x && y' .`)).toEqual([['grep', '-rn', 'a|b; c', 'x && y', '.']])
  expect(parts('git status 2>&1 | wc -l')).toEqual([['git', 'status'], ['wc', '-l']])
  expect(parts('ls &>/dev/null')).toEqual([['ls']])
  for (const c of ['git status;', '; ls', 'ls &', 'ls > a', 'ls 2> a', 'ls >/dev/nullx', 'ls "a', 'ls \\', 'ls $HOME', 'echo "$(id)"', 'echo `id`', 'ls\nrm x']) {
    expect([c, parts(c)]).toEqual([c, null])
  }
})

test('the card says only that the compact form ran: rtk keeps no size per command', () => {
  expect(rtkCard()).toBe('RTK: this command runs in its compact form. Claude sees less output.')
})
