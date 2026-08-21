// Pure attribution: given ledger records + a queried line, decide which agent
// turn/prompt owns that line. Import-free and unit-tested.
//
// v0.3a: line-range containment — the most recent write whose [from,to] spans
// the queried line. Ties break toward the most recently appended record
// (later = newer). Drift-resilient content-hash matching lands in v0.3b.

import { basename } from 'node:path'
import { type LedgerRecord } from './ledger.ts'

export interface LedgerOrigin {
  found: boolean
  turn: number
  tool: string
  prompt: string
  session: string
  source: 'ledger-hash' | 'ledger-range' | 'none'
}

export const NO_LEDGER_ORIGIN: LedgerOrigin = {
  found: false,
  turn: -1,
  tool: '',
  prompt: '',
  session: '',
  source: 'none',
}

/** True when a record refers to `file` (exact POSIX, else basename fallback). */
function sameFile(recFile: string, file: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const a = norm(recFile)
  const b = norm(file)
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || basename(a) === basename(b)
}

/**
 * Attribute a single line. `lineContent` (the line's *current* text) enables the
 * drift-proof hash path; omit it to fall back to positional range matching.
 * `records` are in append order (later entries are newer).
 */
export function attributeLine(
  records: LedgerRecord[],
  file: string,
  line: number,
  _lineContent?: string,
): LedgerOrigin {
  const mine = records.filter((r) => sameFile(r.file, file))
  if (!mine.length) return NO_LEDGER_ORIGIN

  // Positional range containment (most recent write wins).
  let best: LedgerRecord | null = null
  for (const r of mine) if (line >= r.from && line <= r.to) best = r // last wins
  if (best) return toOrigin(best, 'ledger-range')

  return NO_LEDGER_ORIGIN
}

function toOrigin(r: LedgerRecord, source: 'ledger-hash' | 'ledger-range'): LedgerOrigin {
  return { found: true, turn: r.turn, tool: r.tool, prompt: r.prompt, session: r.session, source }
}
