import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePorcelainBlame } from '../src/blame.ts'

// A minimal two-line `git blame --line-porcelain` sample.
const SAMPLE = [
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 1 1',
  'author Meghan Bao',
  'author-mail <menghanbao1@gmail.com>',
  'author-time 1690000000',
  'author-tz +0200',
  'committer Meghan Bao',
  'summary add german greeting',
  'filename src/i18n.ts',
  '\texport const greeting_de = "Willkommen"',
  'f00dbabef00dbabef00dbabef00dbabef00dbabe 2 2',
  'author Meghan Bao',
  'author-time 1690100000',
  'summary tighten jwt expiry',
  'filename src/i18n.ts',
  '\tconst token = signJWT(user)',
].join('\n')

test('parses per-line commit metadata', () => {
  const rows = parsePorcelainBlame(SAMPLE)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].line, 1)
  assert.equal(rows[0].author, 'Meghan Bao')
  assert.equal(rows[0].summary, 'add german greeting')
  assert.equal(rows[0].content, 'export const greeting_de = "Willkommen"')
  assert.equal(rows[0].authorTime, 1690000000)
})

test('handles a second commit group without carrying metadata over', () => {
  const rows = parsePorcelainBlame(SAMPLE)
  assert.equal(rows[1].line, 2)
  assert.equal(rows[1].summary, 'tighten jwt expiry')
  assert.notEqual(rows[0].commit, rows[1].commit)
})

test('ignores empty output', () => {
  assert.deepEqual(parsePorcelainBlame(''), [])
})
