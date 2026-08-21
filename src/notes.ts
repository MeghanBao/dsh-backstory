// Per-line explanation cache (v0.7). Explanations are produced by the model, not
// the tool, so they are saved back keyed by the line's *content* hash. On a later
// query an unchanged line carries its cached explanation; a changed line misses
// the cache and gets re-explained — cheap, and never stale. Pure logic here; the
// same hashLine as the ledger keeps one hashing source of truth.

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashLine } from './ledger.ts'

export const NOTES_REL = join('.dsh', 'backstory-notes.jsonl')

export interface NoteRecord {
  v: 1
  ts: string
  hash: string // hashLine(line content) at save time
  text: string // the explanation
}

/** Build a note keyed by the current content of the line it explains. Pure. */
export function buildNote(content: string, text: string, ts?: string): NoteRecord {
  return { v: 1, ts: ts ?? new Date().toISOString(), hash: hashLine(content), text }
}

/** Parse JSONL notes, skipping malformed lines. Pure. */
export function parseNotes(text: string): NoteRecord[] {
  const out: NoteRecord[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    try {
      const r = JSON.parse(line)
      if (r && r.v === 1 && typeof r.hash === 'string' && typeof r.text === 'string') out.push(r)
    } catch {
      /* tolerate a partial trailing line */
    }
  }
  return out
}

/** Index notes by line-content hash; later entries win. Pure. */
export function indexNotes(records: NoteRecord[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of records) m.set(r.hash, r.text)
  return m
}

// --- I/O (thin, defensive) --------------------------------------------------

export async function appendNote(root: string, rec: NoteRecord): Promise<void> {
  const path = join(root, NOTES_REL)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(rec)}\n`, 'utf8')
}

export async function readNotes(root: string): Promise<NoteRecord[]> {
  try {
    return parseNotes(await readFile(join(root, NOTES_REL), 'utf8'))
  } catch {
    return []
  }
}
