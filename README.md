# dsh-backstory

[![CI](https://github.com/MeghanBao/dsh-backstory/actions/workflows/ci.yml/badge.svg)](https://github.com/MeghanBao/dsh-backstory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![dsh plugin](https://img.shields.io/badge/dsh-plugin-6f42c1.svg)](https://github.com/deepseek-ai/deepseek-harness)

**English** · [中文](README.zh.md)

> Ask any line of code its **backstory** — *what it does*, and *why it's here*.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin.
`git blame` tells you *who* wrote a line and *when*. `dsh-backstory` adds the part
that actually matters when you're staring at unfamiliar code: **what it does and
why it exists** — grounded in the commit that last touched it *and* in the agent's
own history: **which turn wrote each line, and the prompt that triggered it.**

```
backstory  src/blame.ts:27
──────────────────────────────────────────────────────────────
L27 · a5d49e9  2026-08-20 — "feat: dsh-backstory v0.1 …"
    const header = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(raw)

→ WHAT: matches a `git blame --line-porcelain` header line (sha + line numbers)
→ WHY : commit "dsh-backstory v0.1" — starts a new blame record for each line
```

## Why it's different

- `git blame` → *who / when / which commit*.
- **`dsh-backstory`** → *what the line does* + *why it's here*, in one place.
- Not a generic "explain this code" (any LLM does that). The **why** comes from
  real repository history, so the answer is grounded, not guessed.
- When the **agent itself** wrote a line, it adds a dsh-native `origin` that
  `git blame` can never give you — *which turn wrote it, and your prompt* —
  per line (`🧬t14`) and for the file:

  ```
  L1 · a5d49e9 … 🧬t14
      export const greeting_de = "Willkommen"
  🧬 origin · turn 14 — you asked: "支持德语双语" [ledger-hash]
  ```

## Provenance: three layers

Each queried line is attributed by whichever source is most precise, in order:

1. **Ledger content-hash** (`[ledger-hash]`) — every write/edit is recorded to a
   repo-committed `.dsh/backstory.jsonl` with the touched lines' content hashes.
   A line is matched by its **text**, so it survives moving up/down the file
   (line-number drift). This persists across sessions, machines, and people.
2. **Commit trailer** (`[commit]`) — once work is committed with `DSH-Turn` /
   `DSH-Prompt` trailers, `git blame → sha → trailer` recovers the provenance and
   **git's own line tracking handles drift for free**.
3. **Live session log** (`[session]`) — for the current session before anything
   is written to the ledger, reconstructed from `exec.agent.session.events`.

All three degrade gracefully: no ledger, no trailers, no git — you still get the
source lines back.

## Install

```sh
dsh plugin add dsh-backstory      # once published to npm
```

When installed, the dsh host applies the bundle patch declared in
`package.json` (`dsh.bundle.patch` → [`cordis.patch.yml`](cordis.patch.yml)),
which inserts the plugin into the running composition. No extra wiring needed.

Or run from source for local development:

```sh
git clone https://github.com/MeghanBao/dsh-backstory.git
cd dsh-backstory
npm run typecheck   # tsc --noEmit
npm test            # blame parser, provenance engine, git-blame e2e
```

The standalone [`cordis.yml`](cordis.yml) loads just this plugin for local
iteration.

## Usage

The plugin registers a model-facing **`backstory`** tool, so just ask the agent
in natural language:

- *"what's the backstory of `src/auth.ts` line 88?"*
- *"explain `utils/date.ts` lines 10–40 and why each part is there"*

The tool returns each line with the commit that last touched it (author, date,
message) and — when known — the agent turn/prompt that wrote it (`🧬t<turn>`).
The agent narrates *what* the code does and uses the commit message + origin for
*why*. Outside a git repo it degrades gracefully to source-only.

### Tool: `backstory`

| Param | Type | Notes |
|-------|------|-------|
| `path` | string (required) | absolute or workspace-relative |
| `line` | number | first line (1-based); omit for the whole file |
| `endLine` | number | last line; defaults to `line` |

Whole-file reads are bounded to 400 lines.

### The ledger & commit trailers

The plugin records every `write`/`edit` to `.dsh/backstory.jsonl` automatically
(via a `tools/post-execute` observer) — **commit that file** to make provenance
travel with the repo. To also anchor provenance in git history (drift handled by
git), append the trailer block from `formatProvenanceTrailers()` to your commit
message, e.g. via a `prepare-commit-msg` hook:

```
DSH-Turn: 14
DSH-Prompt: 支持德语双语
DSH-Session: 0f3a…
```

## Roadmap

- **v0.1** — git-history backstory: line → commit → what/why. ✅
- **v0.2** — dsh-native half: reconstruct which agent turn wrote a file and the
  prompt that triggered it, from the live session log (file-level). ✅
- **v0.3a** — **persistent line-level ledger**: record every write/edit to
  `.dsh/backstory.jsonl` (turn, prompt, touched lines, content hashes); survives
  across sessions/machines/people. ✅
- **v0.3b** — **drift-proof attribution**: match a line by its content hash, so
  provenance survives the line moving in the file. ✅
- **v0.4** — **git-native provenance**: `DSH-*` commit trailers, recovered via
  `git blame → sha → trailer`, with drift handled by git itself. ✅
- **next** — a `prepare-commit-msg` hook installer, a `/backstory` slash command
  + Web card, and cached per-line explanations (re-explain only changed lines).

## Status

Built against the `dsh` developer preview — APIs may shift. The blame parser,
provenance engine, ledger, hash attribution, git-blame and commit-trailer paths
are covered by **27 tests** (pure logic + e2e against real temp repos). Every
runtime touchpoint (`exec.agent.session.events`, the `tools/post-execute`
recorder) is defensive and degrades gracefully, so the tool never breaks.

## License

[MIT](LICENSE) © Meghan Bao
