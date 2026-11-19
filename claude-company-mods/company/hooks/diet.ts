// The context diet's pure logic: no `$`, no I/O. The only state is a module counter.

export const DIET_MARKER = '[company-diet]'

export const DIET_BLOCK =
  "[company-diet] Core directives: ponytail (smallest complete change; reuse before writing; never cut validation, security or needed tests), headroom (measure big files before reading; read only needed ranges; compute with code), caveman (short plain words; code, commands, paths, numbers and errors stay exact). Your final report goes into the main conversation's context and is paid for on every later request: give the answer or result, the proof (file paths with line numbers, the command and its exit status, a short excerpt) and anything unresolved. At most 25 lines. Never paste whole files, full logs or long command output; give a path and the relevant lines instead."

export const READ_BYTES = 256 * 1024
export const READ_LINES = 600
export const GREP_LINES = 200

// The prompt with the block appended once, or null when it already carries the marker.
export function dietPrompt(prompt: unknown): string | null {
  if (typeof prompt !== 'string' || prompt.includes(DIET_MARKER)) return null
  return `${prompt}\n\n${DIET_BLOCK}`
}

const NOT_TEXT = /\.(pdf|ipynb|png|jpe?g|gif|webp|bmp|svg|ico|tiff?|heic|heif|avif)$/i

// True when a Read of this file should be capped: text, and larger than 256 KB.
export function shouldCapRead(path: unknown, size: unknown): boolean {
  if (typeof path !== 'string' || typeof size !== 'number') return false
  if (NOT_TEXT.test(path)) return false
  return size > READ_BYTES
}

export function readNote(size: number): string {
  return `[company-diet] This file is ${Math.round(size / 1024)} KB; only its first ${READ_LINES} lines were read to protect the context. Read further with offset/limit, or delegate full reading or searching of it to the scout subagent.`
}

let reports = 0
let reads = 0
let greps = 0
export function recordDiet(kind: 'report' | 'read' | 'grep'): void {
  if (kind === 'report') reports += 1
  else if (kind === 'read') reads += 1
  else greps += 1
}
export function dietTotal(): number {
  return reports + reads + greps
}
export function dietByKind(): { reports: number; reads: number; greps: number } {
  return { reports, reads, greps }
}
export function resetDiet(): void {
  reports = 0
  reads = 0
  greps = 0
}
