import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTrigger, normalizeEvents, type RawEvent } from '../src/provenance.ts'

const CWD = '/work/repo'

// A synthetic session log: two turns, each a human prompt then a write/edit.
const LOG: RawEvent[] = [
  { seq: 0, type: 'turn/start', data: { turn: 1 } },
  { seq: 1, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '支持德语双语' }] } },
  { seq: 2, type: 'assistant/message', data: {} },
  { seq: 3, type: 'tool/call', data: { name: 'write', arguments: { file_path: 'src/i18n.ts', content: '...' } } },
  { seq: 4, type: 'tool/result', data: {} },
  { seq: 5, type: 'turn/start', data: { turn: 2 } },
  { seq: 6, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'token 用 15 分钟过期' }] } },
  { seq: 7, type: 'tool/call', data: { name: 'edit', arguments: { file_path: 'src/auth.ts', old_string: 'a', new_string: 'b' } } },
  { seq: 8, type: 'tool/result', data: {} },
]

test('normalizeEvents extracts writes and human prompts with turns', () => {
  const { writes, prompts } = normalizeEvents(LOG, CWD)
  assert.equal(writes.length, 2)
  assert.equal(writes[0].path, `${CWD}/src/i18n.ts`)
  assert.equal(writes[0].tool, 'write')
  assert.equal(writes[1].turn, 2)
  assert.equal(prompts.length, 2)
  assert.equal(prompts[0].text, '支持德语双语')
})

test('findTrigger maps a file to the turn + prompt that wrote it', () => {
  const { writes, prompts } = normalizeEvents(LOG, CWD)
  const t = findTrigger(`${CWD}/src/auth.ts`, 88, writes, prompts)
  assert.ok(t)
  assert.equal(t.turn, 2)
  assert.equal(t.tool, 'edit')
  assert.equal(t.prompt, 'token 用 15 分钟过期')
})

test('the most recent write wins for a re-touched file', () => {
  const log = [
    ...LOG,
    { seq: 9, type: 'turn/start', data: { turn: 3 } },
    { seq: 10, type: 'user/message', data: { source: { kind: 'user' }, content: '改回 30 分钟' } },
    { seq: 11, type: 'tool/call', data: { name: 'edit', arguments: { file_path: 'src/auth.ts' } } },
  ]
  const { writes, prompts } = normalizeEvents(log, CWD)
  const t = findTrigger(`${CWD}/src/auth.ts`, 0, writes, prompts)
  assert.equal(t?.turn, 3)
  assert.equal(t?.prompt, '改回 30 分钟')
})

test('synthetic (non-user) injections are not treated as prompts', () => {
  const log: RawEvent[] = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { source: { kind: 'plugin' }, content: 'auto note' } },
    { seq: 2, type: 'tool/call', data: { name: 'write', arguments: { file_path: 'a.ts' } } },
  ]
  const { prompts } = normalizeEvents(log, CWD)
  assert.equal(prompts.length, 0)
})

test('basename fallback matches when paths differ by directory', () => {
  const { writes, prompts } = normalizeEvents(LOG, CWD)
  const t = findTrigger('/other/place/auth.ts', 0, writes, prompts)
  assert.equal(t?.tool, 'edit')
})

test('returns null when the file was never written by the agent', () => {
  const { writes, prompts } = normalizeEvents(LOG, CWD)
  assert.equal(findTrigger(`${CWD}/never.ts`, 0, writes, prompts), null)
})

test('unknown / empty logs degrade gracefully', () => {
  assert.deepEqual(normalizeEvents([], CWD), { writes: [], prompts: [] })
  assert.equal(findTrigger('x', 0, [], []), null)
})
