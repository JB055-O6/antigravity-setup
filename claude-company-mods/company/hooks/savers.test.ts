import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { SKILL_MD } from './fixtures/skills'
import { BUNDLED, COMPACT, type SaverId, loadSavers, ponytailUltra, stripFrontmatter } from './savers'

const IDS = Object.keys(BUNDLED) as SaverId[]
const DIR = '${CLAUDE_SKILL_DIR}'

// Each test gets roots of its own: loadSavers keeps what it read for the session.
function roots(tag: string): Record<SaverId, string> {
  return { caveman: `/${tag}/caveman`, headroom: `/${tag}/headroom`, ponytail: `/${tag}/ponytail`, 'i-have-adhd': `/${tag}/adhd` }
}
const skill = (r: Record<SaverId, string>, id: SaverId) => `${r[id]}/skills/${id}/SKILL.md`
const installed = (r: Record<SaverId, string>) => Object.fromEntries(IDS.map((id) => [skill(r, id), SKILL_MD[id]]))

// The engine's fs beneath: files by path (text or raw bytes), read as bytes up to `length`; each read is kept.
function engine(files: Record<string, string | Uint8Array>) {
  const reads: string[] = []
  const fs = {
    read: async (path: string, o?: { as?: string; length?: number }) => {
      reads.push(path)
      const f = files[path]
      if (f === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
      if (o?.as !== 'bytes') throw new Error('test engine answers bytes only')
      const bytes = (typeof f === 'string' ? new TextEncoder().encode(f) : f).slice(0, o.length)
      return { base64: btoa(String.fromCharCode(...bytes)) }
    },
  }
  return { eng: { fs } as unknown as EngineInterface, reads }
}

test('stripFrontmatter removes the --- block and keeps the body as it is', () => {
  expect(stripFrontmatter('---\nname: x\ndescription: >\n  y\n---\n\n# T\nbody\n')).toBe('\n# T\nbody\n')
  expect(stripFrontmatter('---\r\nname: x\r\n---\r\n# T\r\n')).toBe('# T\r\n')
  expect(stripFrontmatter('---\n---\n# T\n')).toBe('# T\n')
  // No frontmatter: unchanged. A rule line later in the body stays.
  expect(stripFrontmatter('# T\n\n---\n\nmore\n')).toBe('# T\n\n---\n\nmore\n')
  expect(stripFrontmatter('---\nname: x\n')).toBe('---\nname: x\n')
})

test('every BUNDLED text is the installed body of today, byte for byte, with the folder named in words', () => {
  expect([...IDS].sort()).toEqual(['caveman', 'headroom', 'i-have-adhd', 'ponytail'])
  for (const id of IDS) expect(BUNDLED[id]).toBe(stripFrontmatter(SKILL_MD[id]).replaceAll(DIR, 'the headroom skill folder'))
  expect(SKILL_MD.headroom).toContain(DIR)
  expect(BUNDLED.headroom).toContain('`the headroom skill folder` is the folder that contains this file.')
  // Measured bodies (UTF-8 bytes): caveman 2,115; ponytail 3,029; i-have-adhd 6,781.
  const bytes = (s: string) => new TextEncoder().encode(s).length
  expect([bytes(BUNDLED.caveman), bytes(BUNDLED.ponytail), bytes(BUNDLED['i-have-adhd'])]).toEqual([2115, 3029, 6781])
})

test('COMPACT has one short line per saver, each naming its saver', () => {
  for (const id of IDS) {
    expect(COMPACT[id].startsWith(`${id}: `)).toBe(true)
    expect(COMPACT[id].length).toBeLessThanOrEqual(300)
    expect(COMPACT[id]).not.toContain('\n')
  }
})

test('ponytailUltra puts the level line first, then the body unchanged', () => {
  const t = ponytailUltra(BUNDLED.ponytail)
  expect(t.split('\n')[0]).toBe('PONYTAIL level: ultra (set by the company leader).')
  expect(t).toBe(`PONYTAIL level: ultra (set by the company leader).\n${BUNDLED.ponytail}`)
})

test('installed SKILL.md bodies are used, frontmatter stripped, the skill folder put in', async () => {
  const r = roots('ok')
  const { eng } = engine(installed(r))
  const got = await loadSavers(eng, r)
  expect(got.source).toEqual({ caveman: 'installed', headroom: 'installed', ponytail: 'installed', 'i-have-adhd': 'installed' })
  expect(got.text.caveman).toBe(BUNDLED.caveman)
  expect(got.text.ponytail).toBe(BUNDLED.ponytail)
  expect(got.text['i-have-adhd']).toBe(BUNDLED['i-have-adhd'])
  expect(got.text.headroom).toBe(stripFrontmatter(SKILL_MD.headroom).replaceAll(DIR, '/ok/headroom/skills/headroom'))
})

test('an installed body is read once: two loads, one fs.read per file, same texts', async () => {
  const r = roots('once')
  const { eng, reads } = engine(installed(r))
  const a = await loadSavers(eng, r)
  const b = await loadSavers(eng, r)
  expect(reads.sort()).toEqual(IDS.map((id) => skill(r, id)).sort())
  expect(b).toEqual(a)
})

test('a SKILL.md of 9,000 B gives the bundled copy; 8,000 B is still read', async () => {
  const r = roots('big')
  const files = installed(r)
  files[skill(r, 'caveman')] = `---\nname: caveman\n---\n${'a'.repeat(9000 - 22)}`
  files[skill(r, 'headroom')] = `---\nname: headroom\n---\n${'b'.repeat(8000 - 23)}`
  expect(new TextEncoder().encode(files[skill(r, 'caveman')] as string).length).toBe(9000)
  const got = await loadSavers(engine(files).eng, r)
  expect(got.source.caveman).toBe('bundled')
  expect(got.text.caveman).toBe(BUNDLED.caveman)
  expect(got.source.headroom).toBe('installed')
  expect(got.text.headroom).toBe('b'.repeat(8000 - 23))
})

test('bad UTF-8, a failed read, a blank body, no root or a root that is no absolute path: the bundled copy', async () => {
  const r = roots('bad')
  const files: Record<string, string | Uint8Array> = installed(r)
  files[skill(r, 'caveman')] = new Uint8Array([0x23, 0x20, 0xc3, 0x28, 0x0a])
  delete files[skill(r, 'headroom')]
  files[skill(r, 'ponytail')] = '---\nname: ponytail\n---\n\n  \n'
  const { eng, reads } = engine(files)
  const got = await loadSavers(eng, { ...r, 'i-have-adhd': 'i-have-adhd@i-have-adhd' })
  expect(got.source).toEqual({ caveman: 'bundled', headroom: 'bundled', ponytail: 'bundled', 'i-have-adhd': 'bundled' })
  for (const id of IDS) expect(got.text[id]).toBe(BUNDLED[id])
  // A root the engine gives as a provenance (hosted cloud) is never read against the working folder.
  expect(reads.some((p) => p.startsWith('i-have-adhd@'))).toBe(false)

  const none = engine({})
  const empty = await loadSavers(none.eng, {})
  expect(empty.text).toEqual(BUNDLED)
  expect(none.reads).toEqual([])
})

test('${CLAUDE_SKILL_DIR} is never in any text the savers give', async () => {
  // A `$&` in the folder stays as it is (no replacement pattern).
  const r = roots('d$&')
  const files = installed(r)
  files[skill(r, 'caveman')] = `---\nname: caveman\n---\nRun ${DIR}/a.py, then ${DIR}/b.py.\n`
  const got = await loadSavers(engine(files).eng, r)
  expect(got.text.caveman).toBe('Run /d$&/caveman/skills/caveman/a.py, then /d$&/caveman/skills/caveman/b.py.\n')
  const all = [...Object.values(BUNDLED), ...Object.values(COMPACT), ...Object.values(got.text), ponytailUltra(BUNDLED.ponytail)]
  for (const t of all) expect(t).not.toContain(DIR)
})
