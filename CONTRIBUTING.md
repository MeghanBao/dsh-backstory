# Contributing to dsh-backstory

Thanks for your interest! This is a small, focused [dsh](https://github.com/deepseek-ai/deepseek-harness)
plugin, so the bar is simple: keep the core logic pure and tested, and keep the
dsh runtime touchpoints thin and defensive.

## Project layout

| File | Responsibility |
|------|----------------|
| `src/blame.ts` | Pure porcelain-`git blame` parsing. No I/O, no dsh imports. |
| `src/git.ts` | git blame invocation (I/O), isolated so it's testable without dsh. |
| `src/provenance.ts` | Pure session-log reasoning: file → turn + triggering prompt. |
| `src/index.ts` | The dsh wiring: registers the `backstory` tool, adapters only. |

Rule of thumb: **new logic goes in a pure module with a test; `index.ts` only
glues pure functions to the dsh runtime.** Anything that reaches into
`exec.agent.session` must degrade gracefully (return the empty/`NO_ORIGIN` shape)
so the tool never throws on an unexpected payload.

## Development

```sh
npm install --no-save typescript @types/node   # peer deps aren't bundled
npm run typecheck                               # tsc --noEmit — must be clean
npm test                                        # node --test — must be green
```

Both run in CI (Node 20 and 22) on every push and PR.

## Pull requests

1. Open an issue first for anything beyond a small fix, so we can agree on scope.
2. Add or update tests for behaviour changes. Bug fixes should come with a test
   that fails before the fix.
3. Keep commits focused and messages descriptive (Conventional Commits style:
   `feat:`, `fix:`, `docs:`, `refactor:`, `ci:`).
4. Update `CHANGELOG.md` under `## [Unreleased]`.
5. Make sure `npm run typecheck` and `npm test` both pass locally.

## Scope

Backstory answers *what a line does* and *why it's here* from real history. Keep
additions grounded in verifiable sources (git history, the session log) rather
than free-form LLM guessing — that grounding is the whole point of the plugin.
