# dsh-backstory

> Ask any line of code its **backstory** — *what it does*, and *why it's here*.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin.
`git blame` tells you *who* wrote a line and *when*. `dsh-backstory` adds the part
that actually matters when you're staring at unfamiliar code: **what it does and
why it exists** — grounded in the commit that last touched it (and, soon, the
agent's own session log).

```
backstory  src/blame.ts:27          # a real line from this repo
──────────────────────────────────────────────────────────────
L27 · a5d49e9  MeghanBao 2026-08-20 — "feat: dsh-backstory v0.1 …"
    const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw)

→ WHAT: matches a `git blame --line-porcelain` header line (sha + line numbers)
→ WHY : commit "dsh-backstory v0.1" — starts a new blame record for each line
```

## Why it's different

- `git blame` → *who / when / which commit*.
- **`dsh-backstory`** → *what the line does* + *why it's here*, in one place.
- Not a generic "explain this code" (any LLM does that). The **why** comes from
  real repository history, so the answer is grounded, not guessed.

## Install

```sh
dsh plugin add dsh-backstory      # once published to npm
```

Or run from source for local development:

```sh
git clone https://github.com/MeghanBao/dsh-backstory.git
cd dsh-backstory
npm test          # unit tests for the blame parser
```

## Usage

The plugin registers a model-facing **`backstory`** tool, so just ask the agent
in natural language:

- *"what's the backstory of `src/auth.ts` line 88?"*
- *"explain `utils/date.ts` lines 10–40 and why each part is there"*

The tool returns each line with the commit that last touched it (author, date,
message); the agent narrates *what* the code does and uses the commit messages
for *why*. Outside a git repo it degrades gracefully to source-only.

### Tool: `backstory`

| Param | Type | Notes |
|-------|------|-------|
| `path` | string (required) | absolute or workspace-relative |
| `line` | number | first line (1-based); omit for the whole file |
| `endLine` | number | last line; defaults to `line` |

Whole-file reads are bounded to 400 lines.

## Roadmap

- **v0.1** (this release) — git-history backstory: line → commit → what/why. ✅
- **v0.2** — the dsh-native half: reconstruct *which agent turn* wrote a line
  from the append-only session log (write/edit `tool/result` hunks) → surface
  the **user prompt that triggered it**. See `sessionProvenance()` in
  `src/index.ts`.
- **v0.3** — a `/backstory path:line` slash command + a Web card.
- **v0.4** — **incremental explanations**: cache per-line explanations keyed by
  content hash and only re-explain lines that changed (cheap, never stale).

## Status

Built against the `dsh` developer preview — APIs may shift. The pure blame parser
is unit-tested; the session-log provenance seam is stubbed pending API
verification against `packages/session-query`.

## License

[MIT](LICENSE) © Meghan Bao
