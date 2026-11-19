// The four plugins every mod runs under. Their short rules are built into the
// charter and the subagent block, so they hold even when a plugin is off.
export const DIRECTIVE_PLUGINS = ['ponytail', 'i-have-adhd', 'headroom', 'caveman'] as const

// One status note from settings' enabledPlugins ({ "name@marketplace": true }).
export function directivesNote(enabled: unknown): string {
  const on = new Set<string>()
  if (enabled && typeof enabled === 'object') {
    for (const [id, v] of Object.entries(enabled as Record<string, unknown>)) if (v === true) on.add(id.split('@')[0] ?? id)
  }
  const missing = DIRECTIVE_PLUGINS.filter((n) => !on.has(n))
  const head = `directives ${DIRECTIVE_PLUGINS.length - missing.length}/${DIRECTIVE_PLUGINS.length}`
  return missing.length ? `${head}, missing ${missing.join(', ')}` : head
}
