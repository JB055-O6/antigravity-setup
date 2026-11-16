import type { Register } from 'claude-code'
import { CHARTER } from './charter'

export const register: Register = (on, options) => {
  on('session.start', ($, e, next) => {
    $.ui.status('company: charter loaded')
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
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
}
