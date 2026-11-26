import type { Register } from 'claude-code'
import type { CrewRun } from '../types'
import { PANE_ID, PanelView, panelText } from './panel'
import { CHARTER } from './charter'
import { GREP_LINES, READ_LINES, dietPrompt, readNote, recordDiet, shouldCapRead } from './diet'
import { routeSpawn, type Route } from './router'
import { governEffort, modelFamily, recordGoverned } from './governor'
import { applyLimits, boot, readPanel, showStatus } from './host'
import { createShared, envOff, note, noteOf, resetHealth, setOff, type Ctx, type ModuleId } from './core'
import { MODULE_META } from './modules'
import { countRoute, finalFlush, ready, save, saveSoon } from './persist'

// The module id each register<Name> call below takes, in call order; a test compares it with MODULE_META.
export const MODULE_CALLS: ModuleId[] = []

export const register: Register = (on, options) => {
  let fableWarned = false
  // State every hook and module shares; `st.economy` and `st.efforts` are read synchronously by turn.step.
  const st = createShared(MODULE_META.map((m) => m.id))
  const ctx = Object.fromEntries(MODULE_META.map((m) => [m.id, { id: m.id, caps: m.caps, shared: st }])) as Record<ModuleId, Ctx>
  // Every hook but ui.render (a draw) starts with `await ready($, st)`: persisted state, loaded
  // once by whichever hook runs first after this register.

  on('session.start', async ($, e, next) => {
    await ready($, st)
    // Read once per session: the modules COMPANY_OFF names start off.
    try {
      for (const id of envOff(await $.env.get('COMPANY_OFF'))) {
        setOff(ctx[id], 'env')
        noteOf(ctx[id], 'off: env COMPANY_OFF')
      }
    } catch {
      // No variable to read: every module stays on.
    }
    await boot($, st)
    await save($, st)
    // The live pane opens by itself on the desktop app; /company opens it anywhere.
    if (e.surface === 'desktop') void $.ui.open({ id: PANE_ID, title: 'Company' }).then((o) => { st.paneShown = o.isPlaced }).catch(() => {})
    try {
      await $.command.register({
        name: 'company',
        description: 'Start or re-check the company mod in this session and show what is on',
        immediate: true,
      })
    } catch {
      // The command is a convenience; the mod works without it.
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await ready($, st)
    // A /clear or a resume starts a new conversation, and no session.start fires for it.
    if (e.reason === 'clear' || e.reason === 'resume') resetHealth(st)
    // Writes what the 2 s gap held back. Never throws.
    await finalFlush($, st)
    // The new conversation has a new session id: store the meter under it.
    if (e.reason === 'clear' || e.reason === 'resume') saveSoon($, st)
    return next(e)
  })

  on('command.run', { command: 'company' }, async ($) => {
    await ready($, st)
    await boot($, st)
    showStatus($, st)
    await save($, st)
    let placed = 'Panel: could not be opened.'
    try {
      const o = await $.ui.open({ id: PANE_ID, title: 'Company' })
      st.paneShown = o.isPlaced
      placed = o.isPlaced
        ? 'Panel: shown.'
        : `Panel: not available here (${String(o.reason).split(':')[0]}). Live actions show as "company ·" lines in the chat.`
    } catch (err) {
      placed = `Panel: refused (${String(err).slice(0, 120)}). Live actions show as "company ·" lines in the chat.`
    }
    return { text: panelText(await readPanel($), placed) }
  })

  on('session.attach', async ($, e, next) => {
    await ready($, st)
    // A cloud session gets its screen after it starts: open the pane when a desktop app attaches.
    if (e.surface === 'desktop') void $.ui.open({ id: PANE_ID, title: 'Company' }).then((o) => { st.paneShown = o.isPlaced }).catch(() => {})
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await ready($, st)
    // Pushed figures: refresh from them. Never blocks.
    try {
      await applyLimits($, st, e.rateLimits)
    } catch {
      // Keep the previous values.
    }
    // The meter goes to $.store, so economy survives a reload.
    await save($, st)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    await ready($, st)
    // Not a guard: if anything here throws, the spawn goes ahead unchanged.
    let route: Route | null = null
    let prompt: string | null = null
    try {
      const skip = e.isTeammate || e.resume || e.workflow
      route = skip
        ? null
        : routeSpawn({
            subagentType: e.fork ? 'fork' : e.subagentType,
            model: e.model,
            description: e.description,
            prompt: e.prompt,
            providerIsEngine: e.provider.plugin === 'engine',
          })
      // The compact-report block: not for forks, teammates, resumes or workflow agents.
      prompt = skip || e.fork ? null : dietPrompt(e.prompt)
    } catch {
      return next(e)
    }
    const result = await next({
      ...e,
      ...(route ? { model: route.model } : {}),
      ...(prompt !== null ? { prompt } : {}),
    })

    try {
      if (!result.deny && result.agentId) {
        // Every subagent shows in the crew block, routed or not.
        st.runs = [
          ...st.runs,
          {
            id: result.agentId,
            type: e.subagentType ?? (e.fork ? 'fork' : 'subagent'),
            model: route?.model ?? (modelFamily(result.model) ?? result.model),
            effort: route?.effort ?? 'default',
            task: (e.description ?? '').slice(0, 80),
            steps: 0,
            status: (e.background ? 'background' : 'running') as CrewRun['status'],
          },
        ].slice(-8)
        st.runByTool.set(e.tool_use_id, result.agentId)
        if (!route && prompt === null) showStatus($, st)
      }
    } catch {
      // Bookkeeping must never disturb the spawn.
    }
    try {
      if (!result.deny) {
        if (prompt !== null) {
          recordDiet('report')
          note(st, 'diet', 'subagent told to report in 25 lines or less')
          if (!route) showStatus($, st)
        }
        if (route) {
          if (result.agentId) st.efforts.set(result.agentId, route.effort)
          // In memory, so parallel spawns each count; the store write never holds up the spawn.
          countRoute(st, route.model)
          void save($, st)
          note(st, 'route', `${e.subagentType ?? 'subagent'} → ${route.model} ${route.effort} (${route.reason})`)
          showStatus($, st)
        }
      }
    } catch {
      // Bookkeeping must never disturb the spawn.
    }
    return result
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    await ready($, st)
    // Not a guard: never denies; on any error the call goes down untouched.
    let size: number | undefined
    try {
      if (!e.agentId && e.offset == null && e.limit == null && e.pages == null) {
        const stat = await $.fs.stat(e.file_path)
        if (stat.kind === 'file' && shouldCapRead(e.file_path, stat.size)) size = stat.size
      }
    } catch {
      size = undefined
    }
    if (size === undefined) return next(e)
    const result = await next({ ...e, limit: READ_LINES })
    try {
      if (result.deny !== undefined || result.isError) return result
      recordDiet('read')
      note(st, 'diet', `big file read capped at ${READ_LINES} lines (${Math.round(size / 1024)} KB)`)
      showStatus($, st)
      return { ...result, context: [...(result.context ?? []), readNote(size)] }
    } catch {
      return result
    }
  })

  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    await ready($, st)
    // Not a guard: never denies.
    if (e.agentId || e.output_mode !== 'content' || e.head_limit != null) return next(e)
    const result = await next({ ...e, head_limit: GREP_LINES })
    try {
      if (result.deny === undefined && !result.isError) {
        recordDiet('grep')
        note(st, 'diet', `search output capped at ${GREP_LINES} lines`)
        showStatus($, st)
      }
    } catch {
      // Counting is best-effort.
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    // Once per load (a reload may start here); later steps read memory only.
    await ready($, st)
    // Not a guard: on any error the step goes down unchanged.
    let out = e
    try {
      let model: string = e.model
      let effort: typeof e.effort = e.effort
      let rerouted = false
      if (e.agentId) {
        // The router's remembered subagent effort first.
        const want = st.efforts.get(e.agentId) as Route['effort'] | undefined
        if (want && want !== e.effort) effort = want
        // Fable bills usage credits, not the Pro limits: a subagent's Fable step goes to
        // Opus max (the governor lowers it to xhigh in economy). Never the main loop.
        if (modelFamily(model) === 'fable') {
          model = 'opus'
          effort = 'max'
          rerouted = true
          recordGoverned('subagent fable -> opus max (no credits)')
        }
      } else if (modelFamily(model) === 'fable' && !fableWarned) {
        // The main loop's model is never changed (prompt cache); tell the person once.
        fableWarned = true
        try {
          $.ui.toast('company: main model is Fable, which spends usage credits. /model opus stays inside Pro.')
        } catch {}
      }
      const g = governEffort(model, effort, st.economy)
      if (g.changed) {
        effort = g.effort as typeof e.effort
        recordGoverned(g.reason)
      }
      if (rerouted) out = { ...e, model, effort }
      else if (effort !== e.effort) out = { ...e, effort }
      // Log a fix once per kind, not on every step.
      const why = rerouted ? 'subagent Fable → Opus (no usage credits)' : g.changed ? g.reason : undefined
      const run = e.agentId ? st.runs.find((r) => r.id === e.agentId) : undefined
      if (run) {
        run.steps += 1
        if (run.steps % 3 === 1) showStatus($, st)
      }
      if (why && why !== st.lastGov) {
        st.lastGov = why
        note(st, 'governor', why)
        showStatus($, st)
      }
    } catch {
      out = e
    }
    return yield* next(out)
  })

  on('prompt.compose', async ($, e, next) => {
    await ready($, st)
    const result = await next(e)
    try {
      return {
        sections: [
          ...result.sections,
          { id: 'company:charter', text: CHARTER, scope: 'session' as const },
        ],
      }
    } catch {
      // Not a guard: never block the prompt over the charter.
      return result
    }
  })

  on('ui.render', { component: 'Pane', requestId: 'company' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    return PanelView(ui, await readPanel($))
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await ready($, st)
    const result = await next(e)
    try {
      const id = st.runByTool.get(e.tool_use_id)
      const run = id ? st.runs.find((r) => r.id === id) : undefined
      if (run && run.status === 'running') {
        run.status = result.isError || result.deny !== undefined ? 'failed' : 'done'
        note(st, 'crew', `${run.type} ${run.status}: ${run.task}`)
        showStatus($, st)
      }
    } catch {
      // Bookkeeping only.
    }
    return result
  })

  // Module hooks nest beneath the hooks above, in MODULE_META order: each port adds its
  // `register<Name>(on, use('<id>'))` call here.
  MODULE_CALLS.length = 0
  const use = (id: ModuleId): Ctx => (MODULE_CALLS.push(id), ctx[id])
}
