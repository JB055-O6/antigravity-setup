// The four plugins every mod runs under. Their short rules are built into the
// charter and the subagent block, so they hold even when a plugin is off.
export const DIRECTIVE_PLUGINS = ['ponytail', 'i-have-adhd', 'headroom', 'caveman'] as const

// Which of the four are on: enabled in settings ({ "name@marketplace": true }) or
// loaded in the session (account-synced plugins are not in that settings key).
export function directiveState(enabled: unknown, loaded: readonly string[] = []): { name: string; on: boolean }[] {
  const on = new Set<string>(loaded.map((id) => id.split('@')[0] ?? id))
  if (enabled && typeof enabled === 'object') {
    for (const [id, v] of Object.entries(enabled as Record<string, unknown>)) if (v === true) on.add(id.split('@')[0] ?? id)
  }
  return DIRECTIVE_PLUGINS.map((name) => ({ name, on: on.has(name) }))
}

// One status note: "directives 4/4" or "directives 3/4, missing ponytail".
export function directivesNote(enabled: unknown, loaded: readonly string[] = []): string {
  const s = directiveState(enabled, loaded)
  const missing = s.filter((d) => !d.on).map((d) => d.name)
  const head = `directives ${s.length - missing.length}/${s.length}`
  return missing.length ? `${head}, missing ${missing.join(', ')}` : head
}
