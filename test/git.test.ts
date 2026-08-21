import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { blameFile } from '../src/git.ts'

// End-to-end coverage of the git path against a real repository, so the actual
// `git blame` invocation + porcelain parsing are exercised, not just the parser.

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'backstory-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test Author')
  git('commit', '--allow-empty', '-qm', 'root')
  return dir
}

test('blameFile returns the commit that last touched each line', async () => {
  const dir = initRepo()
  try {
    const file = join(dir, 'hello.ts')
    writeFileSync(file, 'export const a = 1\nexport const b = 2\n')
    execFileSync('git', ['add', 'hello.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'add hello constants'], { cwd: dir })

    const res = await blameFile(file)
    assert.equal(res.repo, true)
    assert.equal(res.lines.length, 2)
    assert.equal(res.lines[0].content, 'export const a = 1')
    assert.equal(res.lines[0].author, 'Test Author')
    assert.equal(res.lines[0].summary, 'add hello constants')
    assert.match(res.lines[0].commit, /^[0-9a-f]{40}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('blameFile honours a line range', async () => {
  const dir = initRepo()
  try {
    const file = join(dir, 'range.ts')
    writeFileSync(file, 'one\ntwo\nthree\nfour\n')
    execFileSync('git', ['add', 'range.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'four lines'], { cwd: dir })

    const res = await blameFile(file, 2, 3)
    assert.deepEqual(
      res.lines.map((l) => [l.line, l.content]),
      [
        [2, 'two'],
        [3, 'three'],
      ],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('blameFile degrades to repo:false outside a git repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backstory-nogit-'))
  try {
    const file = join(dir, 'loose.ts')
    writeFileSync(file, 'const x = 1\n')
    const res = await blameFile(file)
    assert.equal(res.repo, false)
    assert.deepEqual(res.lines, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
