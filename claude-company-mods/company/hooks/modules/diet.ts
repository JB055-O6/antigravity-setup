// Diet: caps big file reads and search output, main loop and subagents alike, and tells each
// subagent to report in short form.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { acted, added, beneath, capText, estimateTokens, fail, isOn, noteOf, ok, saved, type Ctx } from '../core'
import { DIET_BLOCK, GREP_LINES, READ_LINES, dietPrompt, readNote, shouldCapRead } from '../diet'
import { showStatus } from '../host'
import { ready, save } from '../persist'

type Spawn = MatchedHook<'agent.spawn', {}>
type Read = MatchedHook<'tool.call', { readonly tool: 'Read' }>
type Grep = MatchedHook<'tool.call', { readonly tool: 'Grep' }>

export function registerDiet(on: On, ctx: Ctx): void {
  on('agent.spawn', {}, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await dietSpawn($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await dietRead($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await dietGrep($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
}

// The compact-report block: not for forks, teammates, resumes or workflow agents.
// The host's spawn hook above shows the status once, after the route is counted.
async function dietSpawn($: EngineInterface, e: Parameters<Spawn>[1], next: Parameters<Spawn>[2], ctx: Ctx) {
  const prompt = e.fork || e.isTeammate || e.resume || e.workflow ? null : dietPrompt(e.prompt, capText(ctx, 'subagentPrompt', DIET_BLOCK))
  if (prompt === null) return next(e)
  const result = await next({ ...e, prompt })
  try {
    if (!result.deny) {
      added(ctx, prompt.length - e.prompt.length)
      acted(ctx)
      noteOf(ctx, 'subagent told to report in 25 lines or less')
      void save($, ctx.shared)
    }
  } catch {
    // Bookkeeping must never disturb the spawn.
  }
  return result
}

// A whole-file Read of a big text file gets READ_LINES lines and a note on how to read on.
async function dietRead($: EngineInterface, e: Parameters<Read>[1], next: Parameters<Read>[2], ctx: Ctx) {
  // An offset, a limit or pages: the caller chose a range.
  if (e.offset != null || e.limit != null || e.pages != null) return next(e)
  let size: number | undefined
  try {
    const stat = await $.fs.stat(e.file_path)
    if (stat.kind === 'file' && shouldCapRead(e.file_path, stat.size)) size = stat.size
  } catch {
    // No stat (a missing file, say) is an expected case: the call goes down untouched.
  }
  if (size === undefined) return next(e)
  const result = await next({ ...e, limit: READ_LINES })
  if (result.deny !== undefined || result.isError) return result
  const note = readNote(size)
  try {
    acted(ctx)
    added(ctx, note.length)
    // Estimate: file bytes less the chars returned; nothing when the text is absent or longer.
    if (typeof result.text === 'string') saved(ctx, estimateTokens(Math.max(0, size - result.text.length)))
    noteOf(ctx, `big file read capped at ${READ_LINES} lines (${Math.round(size / 1024)} KB)`)
    showStatus($, ctx.shared)
    void save($, ctx.shared)
  } catch {
    // Counting is best-effort.
  }
  return { ...result, context: [...(result.context ?? []), note] }
}

// Content output without a head_limit gets GREP_LINES; an explicit one (0 = no limit) is kept.
async function dietGrep($: EngineInterface, e: Parameters<Grep>[1], next: Parameters<Grep>[2], ctx: Ctx) {
  if (e.output_mode !== 'content' || e.head_limit != null) return next(e)
  const result = await next({ ...e, head_limit: GREP_LINES })
  try {
    if (result.deny === undefined && !result.isError) {
      acted(ctx)
      noteOf(ctx, `search output capped at ${GREP_LINES} lines`)
      showStatus($, ctx.shared)
      void save($, ctx.shared)
    }
  } catch {
    // Counting is best-effort.
  }
  return result
}
