// The `/backstory` user command, registered as a dsh skill (see
// @deepseek-ai/dsh-skill `ctx.skills.register`). A skill is a markdown
// instruction body injected when the user invokes it; this one drives the
// existing `backstory` tool. Pure — the runtime wiring lives in ./index.ts.

export const BACKSTORY_SKILL_BODY = `# backstory

Explain the **backstory** of specific code — what each line does and *why* it exists.

The user may pass a file and optional line range, e.g. \`/backstory src/auth.ts:40-60\`
or \`/backstory utils/date.ts\`.

1. Call the \`backstory\` tool on that path and line range. Prefer a narrow range;
   omit the range only for small files (whole-file reads are bounded to 400 lines).
2. For each returned line, say **what** it does, read from the code itself.
3. Say **why** it exists using the commit message on that line and — when present —
   the agent turn/prompt that wrote it (the \`🧬t<turn>\` marker and the \`origin\`).
4. Flag anything surprising: a line whose recorded prompt does not match what the
   code now does, or provenance that comes only from \`[session]\` (unsaved) vs
   \`[ledger-hash]\` / \`[commit]\` (persisted).

If no path was given, ask which file and lines to explain.
`

export interface BackstorySkill {
  name: string
  description: string
  whenToUse: string
  source: 'runtime'
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  content: string
}

/** The registration payload for the `/backstory` command. */
export function backstorySkill(): BackstorySkill {
  return {
    name: 'backstory',
    description:
      'Explain what specific code does and why it exists, from git history plus the agent turn/prompt that wrote each line.',
    whenToUse: 'When the user asks for the backstory, rationale, or "why" of a file or line range.',
    source: 'runtime',
    // A human slash command; the model already has the `backstory` tool directly.
    invocation: { modelInvocable: false, userInvocable: true },
    content: BACKSTORY_SKILL_BODY,
  }
}
