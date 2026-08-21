import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNote, parseNotes, indexNotes } from '../src/notes.ts'
import { hashLine } from '../src/ledger.ts'

test('buildNote keys the explanation by line content hash', () => {
  const n = buildNote('const x = 1', 'declares the constant x', '2026-08-21T00:00:00.000Z')
  assert.equal(n.hash, hashLine('const x = 1'))
  assert.equal(n.text, 'declares the constant x')
  assert.equal(n.v, 1)
})

test('indexNotes maps hash → text, latest wins', () => {
  const recs = [buildNote('a', 'old', 't1'), buildNote('b', 'bee', 't2'), buildNote('a', 'new', 't3')]
  const idx = indexNotes(recs)
  assert.equal(idx.get(hashLine('a')), 'new')
  assert.equal(idx.get(hashLine('b')), 'bee')
})

test('parseNotes skips malformed lines', () => {
  const good = JSON.stringify(buildNote('x', 'e', 't'))
  assert.equal(parseNotes(`${good}\n{bad json\n\n`).length, 1)
})

test('a note follows its line by content even after the line moves (drift)', () => {
  // Same content hash regardless of line number → cache hit after drift.
  const idx = indexNotes([buildNote('return total', 'returns the running total', 't')])
  assert.equal(idx.get(hashLine('return total')), 'returns the running total')
})
