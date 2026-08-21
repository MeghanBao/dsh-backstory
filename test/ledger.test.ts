import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashLine, locateHunk, computeTouch, buildRecord, parseLedger } from '../src/ledger.ts'

test('hashLine is stable and \\r-insensitive', () => {
  assert.equal(hashLine('const x = 1'), hashLine('const x = 1'))
  assert.equal(hashLine('const x = 1'), hashLine('const x = 1\r'))
  assert.notEqual(hashLine('const x = 1'), hashLine('const x = 2'))
})

test('locateHunk returns the 1-based inclusive line span of the needle', () => {
  const content = 'a\nb\nc\nd\n'
  assert.deepEqual(locateHunk(content, 'b'), { from: 2, to: 2 })
  assert.deepEqual(locateHunk(content, 'b\nc'), { from: 2, to: 3 })
  assert.equal(locateHunk(content, 'zzz'), null)
})

test('computeTouch attributes the whole file for a write', () => {
  const t = computeTouch('write', { content: 'l1\nl2\nl3' }, 'l1\nl2\nl3')
  assert(t)
  assert.deepEqual({ from: t.from, to: t.to }, { from: 1, to: 3 })
  assert.equal(t.hashes.length, 3)
  assert.equal(t.hashes[0], hashLine('l1'))
})

test('computeTouch attributes only the replacement hunk for an edit', () => {
  const newContent = 'keep1\nNEW-A\nNEW-B\nkeep2\n'
  const t = computeTouch('edit', { new_string: 'NEW-A\nNEW-B' }, newContent)
  assert(t)
  assert.deepEqual({ from: t.from, to: t.to }, { from: 2, to: 3 })
  assert.deepEqual(t.hashes, [hashLine('NEW-A'), hashLine('NEW-B')])
})

test('computeTouch returns null when an edit needle is missing', () => {
  assert.equal(computeTouch('edit', { new_string: 'absent' }, 'a\nb\n'), null)
})

test('buildRecord + parseLedger round-trip a JSONL line', () => {
  const rec = buildRecord({
    session: 's1',
    turn: 14,
    prompt: '支持德语双语',
    tool: 'write',
    file: 'src/i18n.ts',
    touch: { from: 1, to: 2, hashes: ['aaa', 'bbb'] },
    ts: '2026-08-21T00:00:00.000Z',
  })
  const parsed = parseLedger(`${JSON.stringify(rec)}\n\n{bad json}\n`)
  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0], rec)
})
