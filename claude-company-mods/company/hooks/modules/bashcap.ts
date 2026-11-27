// Bash cap: cuts huge Bash output, main loop and subagents alike. It keeps the head, the tail and
// the error lines, and saves the whole output under the session scratchpad until the session ends.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { capLimits, cutOutput, kb, outDir } from '../bashcut'
import { acted, beneath, estimateTokens, fail, isOn, noteOf, ok, saved, type Ctx } from '../core'
import { showStatus } from '../host'
import { ready, save } from '../persist'

type Bash = MatchedHook<'tool.call', { readonly tool: 'Bash' }>

// The delete's bound at session end: the whole chain has 1.5 s, and the final flush takes up to 1 s.
const DROP_MS = 400

export function registerBashcap(on: On, ctx: Ctx): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await ready($, ctx.shared)
    if (!isOn(ctx)) return next(e)
    try { const r = await bashcapCall($, e, beneath(next), ctx); ok(ctx); return r } catch (err) { fail(ctx, err); throw err }
  })
  // No isOn pass-through: outputs saved before the breaker turned the module off still go.
  // Nothing to count: dropOutputs never throws, and an error from `next` is the engine's.
  on('session.end', {}, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      await dropOutputs($)
    }
  })
}

// After `next`: an output over the threshold is saved whole, then cut. Left alone: an errored
// result (the engine refuses a string where Bash's record goes, and cuts error text near 10 KB
// itself), an image, and output over 30,000 chars, which the engine saved and shows as a preview.
async function bashcapCall($: EngineInterface, e: Parameters<Bash>[1], next: Parameters<Bash>[2], ctx: Ctx) {
  const r = await next(e)
  if (r.deny !== undefined || r.isError) return r
  const rec = r.result
  if (typeof rec?.stdout !== 'string' || rec.isImage || rec.persistedOutputPath !== undefined) return r
  // The engine joins stderr into stdout (V11 probe), so stdout is the whole output.
  const lim = capLimits(ctx.shared.economy)
  if (rec.stdout.length <= lim.over) return r
  const path = await saveOutput($, e.tool_use_id, rec.stdout)
  const c = cutOutput(rec.stdout, path === undefined ? lim : { ...lim, path })
  if (!c.cut) return r
  try {
    acted(ctx)
    saved(ctx, estimateTokens(c.originalChars - c.keptChars))
    noteOf(ctx, `Bash output cut: Claude sees ${kb(c.keptChars)} KB of ${kb(c.originalChars)} KB`)
    showStatus($, ctx.shared)
    void save($, ctx.shared)
  } catch {
    // Counting is best-effort.
  }
  // A new answer without core's `ref`: core maps this record for the model as the tool's result.
  return { result: { ...rec, stdout: c.text }, context: r.context }
}

// `<scratchpad>/company-out/<tool_use_id>.txt`, or undefined when there is no scratchpad or the
// write fails: both are expected cases, not faults.
async function saveOutput($: EngineInterface, id: string, text: string): Promise<string | undefined> {
  try {
    const dir = outDir((await $.session.info()).scratchpadDir)
    if (dir === undefined) return undefined
    const path = `${dir}/${id.replace(/[^\w-]/g, '_') || 'output'}.txt`
    await $.fs.write(path, text)
    return path
  } catch {
    return undefined
  }
}

// Deletes `<scratchpad>/company-out`; the engine's fs has no delete. Never throws.
// shortcut: `rm` only, so on Windows the files stay in the scratchpad; add a Windows command if users need it.
async function dropOutputs($: EngineInterface): Promise<void> {
  try {
    const dir = outDir((await $.session.info()).scratchpadDir)
    if (dir === undefined || !(await $.fs.exists(dir))) return
    await $.process.run(['rm', '-rf', '--', dir], { timeoutMs: DROP_MS })
  } catch {
    // A missing rm, a refusal or a timeout leaves the files in the scratchpad.
  }
}
