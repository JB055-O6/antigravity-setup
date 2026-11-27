// The graph module's pure parts: its run lock and the git exclude file. No `$`.

// A lock older than this is stale; a graphify run stops at 10 min.
export const LOCK_MS = 900_000

// free: no lock. held: a live holder took it inside 15 min. stale: older, or its process is gone.
export function lockState(lock: { pid: number; at: number } | null, now: number, pidAlive: boolean): 'free' | 'held' | 'stale' {
  if (lock === null) return 'free'
  // A time far ahead (the clocks of two machines apart) holds no lock for ever.
  return Math.abs(now - lock.at) > LOCK_MS || !pidAlive ? 'stale' : 'held'
}

// The exclude file's text with `line` added at the end, the user's lines as they are; null when
// a line already says it.
export function excludeWithLine(text: string, line: string): string | null {
  if (text.split(/\r?\n/).some((l) => l.trim() === line)) return null
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${line}${eol}`
}
