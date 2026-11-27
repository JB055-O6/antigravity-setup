import type { Register } from 'claude-code'
import { PANE_ID, PanelView, panelText } from './panel'
import { boot, readPanel, readPlace, showStatus } from './host'
import { createShared, envOff, noteOf, resetHealth, setOff, type Ctx, type ModuleId } from './core'
import { MODULE_META } from './modules'
import { registerBashcap } from './modules/bashcap'
import { registerCharter } from './modules/charter'
import { registerDiet } from './modules/diet'
import { registerGovernor } from './modules/governor'
import { registerMeter } from './modules/meter'
import { registerCrew, registerRouter } from './modules/router'
import { finalFlush, newSession, ready, save } from './persist'

// The module id each register<Name> call below takes, in call order; a test compares it with MODULE_META.
export const MODULE_CALLS: ModuleId[] = []

export const register: Register = (on, options) => {
  // State every hook and module shares; `st.economy` and `st.efforts` are read synchronously by turn.step.
  const st = createShared(MODULE_META.map((m) => m.id))
  const ctx = Object.fromEntries(MODULE_META.map((m) => [m.id, { id: m.id, caps: m.caps, shared: st }])) as Record<ModuleId, Ctx>
  // Every hook but ui.render (a draw) and session.end (a short bound) starts with
  // `await ready($, st)`: persisted state, loaded once by whichever hook runs first after register.
  // Writes are `void save`: a store that hangs never holds up a hook.

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
    // Before the modules beneath: the router steps aside when a device is attached off the machine.
    await readPlace($, st)
    // The modules beneath start first (the router registers the crew), so the start note counts it.
    try {
      return await next(e)
    } finally {
      await boot($, st)
      void save($, st)
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
    }
  })

  on('session.end', async ($, e, next) => {
    // A /clear or a resume starts a new conversation, and no session.start fires for it.
    if (e.reason === 'clear' || e.reason === 'resume') {
      resetHealth(st)
      newSession(st)
    }
    // No wait for restore here: the whole chain has 1.5 s. Writes what memory holds. Never throws.
    await finalFlush($, st)
    return next(e)
  })

  on('command.run', { command: 'company' }, async ($) => {
    await ready($, st)
    // A hot reload drops the crew and fires no session.start: /company registers it again.
    await registerCrew($, ctx.router)
    await boot($, st)
    showStatus($, st)
    void save($, st)
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
    // An app that attaches only draws the session; a device it brings shows in the tool pool.
    await readPlace($, st)
    // A cloud session gets its screen after it starts: open the pane when a desktop app attaches.
    if (e.surface === 'desktop') void $.ui.open({ id: PANE_ID, title: 'Company' }).then((o) => { st.paneShown = o.isPlaced }).catch(() => {})
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'company' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    // A pane that draws is on screen, a reload or not: no chat notices beside it.
    st.paneShown = true
    return PanelView(ui, await readPanel($))
  })

  // Module hooks nest beneath the hooks above, in MODULE_META order: each port adds its
  // `register<Name>(on, use('<id>'))` call here.
  MODULE_CALLS.length = 0
  const use = (id: ModuleId): Ctx => (MODULE_CALLS.push(id), ctx[id])
  registerCharter(on, use('charter'))
  registerMeter(on, use('meter'))
  registerRouter(on, use('router'))
  registerGovernor(on, use('governor'))
  registerDiet(on, use('diet'))
  registerBashcap(on, use('bashcap'))
}
