// prepare-commit-msg entry (v0.4 write side). Git invokes this with the commit
// message file path as argv[2]. It promotes ledger records into DSH-* commit
// trailers: read the staged files, find the newest ledger record touching them,
// and append its turn/prompt to the message. Best-effort — never blocks a commit.
//
// `selectTrailer` is pure and unit-tested; `main` is the thin git/fs adapter.

import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename } from 'node:path'
import { readLedger, type LedgerRecord } from './ledger.ts'
import { formatProvenanceTrailers, parseProvenanceTrailers } from './trailers.ts'

const run = promisify(execFile)

/**
 * Choose the trailer block to append, or null. The most recently recorded write
 * touching any staged file wins. Returns null when nothing matches, or when the
 * message already carries a DSH trailer (idempotent — safe on `--amend`).
 */
export function selectTrailer(
  records: LedgerRecord[],
  stagedFiles: string[],
  existingMsg: string,
): string | null {
  if (parseProvenanceTrailers(existingMsg)) return null
  const staged = new Set(stagedFiles.map((f) => basename(f)))
  const mine = records.filter((r) => staged.has(basename(r.file)))
  if (!mine.length) return null
  let best = mine[0]
  for (const r of mine) if (r.ts >= best.ts) best = r // ISO ts sorts lexically; tie → last
  return formatProvenanceTrailers({ turn: best.turn, prompt: best.prompt, session: best.session })
}

async function main(): Promise<void> {
  try {
    const msgPath = process.argv[2]
    if (!msgPath) return
    const cwd = process.cwd()
    const existing = await readFile(msgPath, 'utf8')
    const { stdout } = await run('git', ['diff', '--cached', '--name-only'], { cwd })
    const staged = stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    const trailer = selectTrailer(await readLedger(cwd), staged, existing)
    if (!trailer) return
    const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
    await writeFile(msgPath, `${existing}${sep}${trailer}\n`, 'utf8')
  } catch {
    /* never block a commit */
  }
}

// Run only when git executes this file directly, not when a test imports it.
if (process.argv[1]?.endsWith('hook.ts')) await main()
