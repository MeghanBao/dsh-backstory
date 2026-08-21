import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactPrompt } from '../src/redact.ts'
import { mergeConfig, isDisabledByEnv, DEFAULT_CONFIG } from '../src/config.ts'

test('redacts common token shapes', () => {
  assert.match(redactPrompt('use key sk-abcdefghijklmnopqrstuvwx'), /\[REDACTED\]/)
  assert.match(redactPrompt('token ghp_0123456789ABCDEFGHIJKLMNOPQRSTUV'), /\[REDACTED\]/)
  assert.match(redactPrompt('AKIAIOSFODNN7EXAMPLE'), /\[REDACTED\]/)
})

test('redacts key=value secrets but keeps the key name', () => {
  assert.equal(redactPrompt('set password = hunter2'), 'set password = [REDACTED]')
  assert.equal(redactPrompt('api_key: "abc123"'), 'api_key: [REDACTED]')
})

test('leaves ordinary prompts untouched', () => {
  const p = 'add a German greeting to the i18n file'
  assert.equal(redactPrompt(p), p)
})

test('applies user-supplied extra patterns and ignores invalid ones', () => {
  assert.equal(redactPrompt('internal ACME-1234 ref', ['ACME-\\d+']), 'internal [REDACTED] ref')
  assert.equal(redactPrompt('safe text', ['(unclosed']), 'safe text') // bad regex ignored
})

test('mergeConfig coerces untrusted input to defaults', () => {
  assert.deepEqual(mergeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(mergeConfig({ record: false, redactPatterns: ['x'] }), {
    record: false,
    redactPatterns: ['x'],
  })
  assert.deepEqual(mergeConfig({ record: 'nope', redactPatterns: [1, 2] }), DEFAULT_CONFIG)
})

test('isDisabledByEnv reads the opt-out flag', () => {
  assert.equal(isDisabledByEnv({ DSH_BACKSTORY_DISABLE: '1' }), true)
  assert.equal(isDisabledByEnv({ DSH_BACKSTORY_DISABLE: 'true' }), true)
  assert.equal(isDisabledByEnv({}), false)
})
