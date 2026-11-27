import { expect, test } from 'claude-code/testing'
import { LIGHT, acceptRewrite, inMode, rtkCard, shouldTry } from './rtkrules'

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

test('acceptRewrite: no rewrite unless exit 3 with text', () => {
  expect(acceptRewrite('git status', '', 3)).toBeNull()
  expect(acceptRewrite('git status', ' \n', 3)).toBeNull()
  expect(acceptRewrite('git status', 'rtk git status', 1)).toBeNull()
  // Exit 0 also prints a rewrite (allow rules cover it); only 3 is taken.
  expect(acceptRewrite('git status', 'rtk git status', 0)).toBeNull()
  expect(acceptRewrite('git status', 'rtk git status', 2)).toBeNull()
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

test('inMode: light takes only the listed commands, full takes every rewrite', () => {
  for (const c of [
    'rtk git status', 'cd x && rtk git log -5', 'rtk git diff | head -50', 'rtk ls -la', 'rtk tree -L 2', 'rtk find . -name "*.ts"',
    'rtk wc -l a', 'rtk docker ps', 'rtk docker images', 'rtk kubectl get pods', 'rtk pytest -q', 'rtk jest', 'rtk vitest',
    'rtk cargo test', 'rtk go test ./...', 'rtk phpunit', 'rtk pest',
  ]) expect([c, inMode(c, 'light')]).toEqual([c, true])
  for (const c of ['rtk read README.md', 'ls | rtk grep foo', 'rtk git status && rtk grep x .', 'rtk docker logs x', 'rtk kubectl logs x', 'rtk cargo build', 'rtk gitx', 'rtk git-foo']) {
    expect([c, inMode(c, 'light')]).toEqual([c, false])
    expect(inMode(c, 'full')).toBe(true)
  }
  expect(LIGHT.length).toBeGreaterThan(0)
})

test('the card says only that the compact form ran: rtk keeps no size per command', () => {
  expect(rtkCard()).toBe('RTK: this command runs in its compact form. Claude sees less output.')
})
