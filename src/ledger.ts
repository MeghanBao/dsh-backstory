// Persistent, line-level provenance ledger. The pure half (hashing, hunk
// location, record building) is unit-tested and import-free; the I/O half
// (append/read a repo-committed JSONL) is a thin, defensive wrapper.
//
// Why a ledger: the v0.2 session-event path only knows the *current* session.
// A record appended at write time — turn, prompt, the exact lines and their
// content hashes — survives across sessions, machines, and people once it is
// committed to the repo at `.dsh/backstory.jsonl`.

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

export const LEDGER_REL = join('.dsh', 'backstory.jsonl')

export interface LedgerRecord {
  v: 1
  ts: string // ISO timestamp
  session: string // session id, or '' when unknown
  turn: number
  prompt: string
  tool: string // 'write' | 'edit' | …
  file: string // repo-relative POSIX path
  from: number // first touched line (1-based) in the post-write file
  to: number // last touched line
  hashes: string[] // per-line content hash for [from, to], drift anchor
}

/** Stable short content hash of a single line (trailing \r tolerated). */
export function hashLine(line: string): string {
  return createHash('sha1').update(line.replace(/\r$/, ''), 'utf8').digest('hex').slice(0, 12)
}

/**
 * Locate `needle` inside `content` and return the 1-based inclusive line span it
 * occupies. Used to turn an edit's replacement text into the line range it wrote
 * in the resulting file. Returns null when the text is not found.
 */
export function locateHunk(content: string, needle: string): { from: number; to: number } | null {
  if (!needle) return null
  const idx = content.indexOf(needle)
  if (idx < 0) return null
  const from = content.slice(0, idx).split('\n').length // 1-based
  const to = from + needle.split('\n').length - 1
  return { from, to }
}

/**
 * Compute the touched line span + per-line hashes for a completed write/edit,
 * from the tool arguments and the file's *new* content (read back after the
 * write applied). `write` owns the whole file; `edit` owns where its replacement
 * landed. Returns null when the touch can't be located (caller skips the record).
 */
export function computeTouch(
  tool: string,
  args: Record<string, unknown> | undefined,
  newContent: string,
): { from: number; to: number; hashes: string[] } | null {
  const lines = newContent.split('\n')
  let span: { from: number; to: number } | null = null

  if (tool === 'edit') {
    const needle =
      (args?.new_string as string) ?? (args?.newString as string) ?? (args?.new_str as string)
    span = typeof needle === 'string' ? locateHunk(newContent, needle) : null
  } else {
    // write / create / anything full-content: attribute the whole file.
    span = { from: 1, to: Math.max(1, lines.length) }
  }
  if (!span) return null

  const from = Math.max(1, span.from)
  const to = Math.min(lines.length, Math.max(from, span.to))
  const hashes = lines.slice(from - 1, to).map(hashLine)
  return { from, to, hashes }
}

/** Assemble a full ledger record. Pure — callers supply the runtime context. */
export function buildRecord(input: {
  session: string
  turn: number
  prompt: string
  tool: string
  file: string
  touch: { from: number; to: number; hashes: string[] }
  ts?: string
}): LedgerRecord {
  return {
    v: 1,
    ts: input.ts ?? new Date().toISOString(),
    session: input.session,
    turn: input.turn,
    prompt: input.prompt,
    tool: input.tool,
    file: input.file,
    from: input.touch.from,
    to: input.touch.to,
    hashes: input.touch.hashes,
  }
}

/** Parse JSONL ledger text into records, skipping malformed lines. Pure. */
export function parseLedger(text: string): LedgerRecord[] {
  const out: LedgerRecord[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const rec = JSON.parse(line)
      if (rec && rec.v === 1 && typeof rec.file === 'string') out.push(rec)
    } catch {
      // tolerate a partially-written trailing line
    }
  }
  return out
}

// --- I/O (thin, defensive) --------------------------------------------------

/** Append one record to `<root>/.dsh/backstory.jsonl`, creating `.dsh` as needed. */
export async function appendRecord(root: string, rec: LedgerRecord): Promise<void> {
  const path = join(root, LEDGER_REL)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(rec)}\n`, 'utf8')
}

/** Read + parse the ledger; returns [] when it doesn't exist. */
export async function readLedger(root: string): Promise<LedgerRecord[]> {
  try {
    return parseLedger(await readFile(join(root, LEDGER_REL), 'utf8'))
  } catch {
    return []
  }
}
