import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributeLine } from '../src/attribution.ts'
import { buildRecord, hashLine, type LedgerRecord } from '../src/ledger.ts'

function rec(over: Partial<LedgerRecord> & { lines: string[]; from: number }): LedgerRecord {
  return buildRecord({
    session: over.session ?? 's',
    turn: over.turn ?? 1,
    prompt: over.prompt ?? 'p',
    tool: over.tool ?? 'write',
    file: over.file ?? 'src/a.ts',
    touch: { from: over.from, to: over.from + over.lines.length - 1, hashes: over.lines.map(hashLine) },
  })
}

test('range match: the most recent write containing the line wins', () => {
  const records = [
    rec({ turn: 1, prompt: 'first', from: 1, lines: ['a', 'b', 'c'] }),
    rec({ turn: 2, prompt: 'second', from: 2, lines: ['b2'] }),
  ]
  assert.equal(attributeLine(records, 'src/a.ts', 2).prompt, 'second')
  assert.equal(attributeLine(records, 'src/a.ts', 1).prompt, 'first')
})

test('hash match survives line drift (v0.3b)', () => {
  const records = [rec({ turn: 7, prompt: 'wrote foo', from: 10, lines: ['const foo = 1'] })]
  // The line has since moved from 10 to 3, but its text is unchanged.
  const o = attributeLine(records, 'src/a.ts', 3, 'const foo = 1')
  assert.equal(o.found, true)
  assert.equal(o.turn, 7)
  assert.equal(o.source, 'ledger-hash')
})

test('hash beats range when both could match', () => {
  const records = [
    rec({ turn: 1, prompt: 'range-owner', from: 1, lines: ['x', 'y', 'z'] }),
    rec({ turn: 9, prompt: 'hash-owner', from: 99, lines: ['y'] }),
  ]
  const o = attributeLine(records, 'src/a.ts', 2, 'y')
  assert.equal(o.prompt, 'hash-owner')
  assert.equal(o.source, 'ledger-hash')
})

test('basename fallback matches relative vs absolute paths', () => {
  const records = [rec({ file: 'src/a.ts', from: 1, lines: ['a'] })]
  assert.equal(attributeLine(records, '/abs/proj/src/a.ts', 1).found, true)
})

test('no match returns the empty origin', () => {
  const records = [rec({ file: 'src/a.ts', from: 1, lines: ['a'] })]
  const o = attributeLine(records, 'src/other.ts', 1, 'a')
  assert.equal(o.found, false)
  assert.equal(o.source, 'none')
})
