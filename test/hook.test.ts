import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectTrailer } from '../src/hook.ts'
import { installHook } from '../src/install-hook.ts'
import { buildRecord, hashLine, type LedgerRecord } from '../src/ledger.ts'

const HOOK_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hook.ts')

function rec(file: string, turn: number, prompt: string, ts: string): LedgerRecord {
  const r = buildRecord({
    session: 's',
    turn,
    prompt,
    tool: 'write',
    file,
    touch: { from: 1, to: 1, hashes: [hashLine('x')] },
  })
  return { ...r, ts }
}

test('selectTrailer picks the newest record touching a staged file', () => {
  const records = [
    rec('src/a.ts', 1, 'old', '2026-08-20T00:00:00.000Z'),
    rec('src/a.ts', 5, 'new', '2026-08-21T00:00:00.000Z'),
    rec('src/b.ts', 9, 'other', '2026-08-22T00:00:00.000Z'),
  ]
  const out = selectTrailer(records, ['src/a.ts'], 'feat: x')
  assert.match(out ?? '', /DSH-Turn: 5/)
  assert.match(out ?? '', /DSH-Prompt: new/)
})

test('selectTrailer is idempotent when a trailer already exists', () => {
  const records = [rec('src/a.ts', 5, 'new', '2026-08-21T00:00:00.000Z')]
  assert.equal(selectTrailer(records, ['src/a.ts'], 'feat: x\n\nDSH-Turn: 5'), null)
})

test('selectTrailer returns null when no staged file matches', () => {
  const records = [rec('src/a.ts', 5, 'new', '2026-08-21T00:00:00.000Z')]
  assert.equal(selectTrailer(records, ['src/z.ts'], 'feat: x'), null)
})

test('installed hook appends the trailer to a real commit (e2e)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backstory-hook-'))
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
    git('init', '-q')
    git('config', 'user.email', 't@e.com')
    git('config', 'user.name', 'T')

    const res = await installHook(dir, HOOK_ENTRY)
    assert.equal(res.installed, true)

    // A ledger record for the file we're about to commit.
    mkdirSync(join(dir, '.dsh'), { recursive: true })
    writeFileSync(
      join(dir, '.dsh', 'backstory.jsonl'),
      `${JSON.stringify(rec('greet.ts', 14, '支持德语双语', '2026-08-21T00:00:00.000Z'))}\n`,
    )
    writeFileSync(join(dir, 'greet.ts'), 'export const g = 1\n')
    git('add', 'greet.ts', '.dsh/backstory.jsonl')
    git('commit', '-qm', 'feat: greeting')

    const body = git('log', '-1', '--format=%B').toString()
    assert.match(body, /DSH-Turn: 14/)
    assert.match(body, /DSH-Prompt: 支持德语双语/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
