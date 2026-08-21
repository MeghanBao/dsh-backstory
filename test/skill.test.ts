import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backstorySkill } from '../src/skill.ts'

test('backstorySkill is a valid user-invocable command payload', () => {
  const s = backstorySkill()
  assert.match(s.name, /^[a-z][a-z0-9-]*$/) // kebab-case skill name
  assert.equal(s.source, 'runtime')
  assert.equal(s.invocation.userInvocable, true)
  assert.ok(s.description.length > 0)
})

test('the skill body instructs the agent to use the backstory tool', () => {
  const s = backstorySkill()
  assert.match(s.content, /`backstory` tool/)
  assert.match(s.content, /line range/)
})
