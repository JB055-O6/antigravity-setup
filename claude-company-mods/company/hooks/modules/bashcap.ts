// Bash cap: cuts huge Bash output, main loop and subagents alike. It keeps the head, the tail and
// the error lines, and saves the whole output under the session scratchpad until the session ends.
import type { EngineInterface, MatchedHook, On } from 'claude-code'
import { capLimits, cutOutput, deleteArgv, dropNotice, kb, outDir } from '../bashcut'
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

// After `next`: an output over the threshold is cut, then saved whole. Left alone: an errored
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
  const path = await outPath($, e.tool_use_id)
  let c = cutOutput(rec.stdout, path === undefined ? lim : { ...lim, path })
  if (!c.cut) return r
  // Saved only once the cut is sure, so no file is left unused. A failed write is an expected case:
  // the marker then says "not saved", which is shorter than a path, so the cut still holds.
  if (path !== undefined && !(await $.fs.write(path, rec.stdout).then(() => true, () => false))) c = cutOutput(rec.stdout, lim)
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

// `<scratchpad>/company-out/<tool_use_id>.txt`, or undefined when there is no scratchpad.
async function outPath($: EngineInterface, id: string): Promise<string | undefined> {
  try {
    const dir = outDir((await $.session.info()).scratchpadDir)
    return dir === undefined ? undefined : `${dir}/${id.replace(/[^\w-]/g, '_') || 'output'}.txt`
  } catch {
    return undefined
  }
}

// Deletes `<scratchpad>/company-out`. Never throws. The outputs may hold secrets, so a folder
// that is still there afterwards gets one chat notice that names it.
async function dropOutputs($: EngineInterface): Promise<void> {
  let dir: string | undefined
  let argv: string[]
  try {
    const info = await $.session.info()
    dir = outDir(info.scratchpadDir)
    if (dir === undefined || !(await $.fs.exists(dir))) return
    argv = deleteArgv(dir, info.platform)
  } catch {
    // Nothing known to delete.
    return
  }
  try {
    await $.process.run(argv, { timeoutMs: DROP_MS })
  } catch {
    // A missing command, a refusal or a timeout: the check below tells.
  }
  try {
    // An exit code alone does not prove it: `rmdir /s` can end 0 with files left.
    if (!(await $.fs.exists(dir))) return
  } catch {
    // Unknown: tell the user.
  }
  try {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: dropNotice(dir) }] } })
  } catch {
    // No chat to post in.
  }
}
