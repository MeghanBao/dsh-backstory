import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatProvenanceTrailers, parseProvenanceTrailers } from '../src/trailers.ts'
import { readCommitBodies } from '../src/git.ts'

test('format then parse round-trips provenance', () => {
  const block = formatProvenanceTrailers({ turn: 14, prompt: 'add\n  german\tgreeting', session: 's1' })
  assert.equal(block, 'DSH-Turn: 14\nDSH-Prompt: add german greeting\nDSH-Session: s1')
  const p = parseProvenanceTrailers(`feat: i18n\n\n${block}`)
  assert.deepEqual(p, { turn: 14, prompt: 'add german greeting', session: 's1' })
})

test('parse returns null without trailers', () => {
  assert.equal(parseProvenanceTrailers('just a normal commit\n\nbody line'), null)
})

test('readCommitBodies reads trailers off a real commit (v0.4 e2e)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backstory-tr-'))
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
    git('init', '-q')
    git('config', 'user.email', 't@e.com')
    git('config', 'user.name', 'T')
    writeFileSync(join(dir, 'f.ts'), 'const x = 1\n')
    git('add', 'f.ts')
    const msg = `feat: add x\n\n${formatProvenanceTrailers({ turn: 3, prompt: 'make x', session: 'sess' })}`
    git('commit', '-qm', msg)
    const sha = git('rev-parse', 'HEAD').toString().trim()

    const bodies = await readCommitBodies(dir, [sha, '0'.repeat(40)])
    assert.equal(bodies.has(sha), true)
    assert.deepEqual(parseProvenanceTrailers(bodies.get(sha)!), {
      turn: 3,
      prompt: 'make x',
      session: 'sess',
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
