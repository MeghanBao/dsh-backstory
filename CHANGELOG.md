# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **v0.7 — incremental explanations.** Per-line explanations are cached by
  content hash in `.dsh/backstory-notes.jsonl` (`src/notes.ts`): a new
  `backstory_remember` tool stores them, and `backstory` attaches an
  `explanation` to any line whose text is unchanged (drift-proof) plus an
  `unexplained` count. Only changed lines need re-explaining. Pure logic
  unit-tested; verified e2e (remember → drift → cache hit) against real dsh-tools.
- **v0.6 — `/backstory` user command.** Registered as a dsh skill via
  `ctx.skills.register` (`@deepseek-ai/dsh-skill`, optional peer): a user-invocable
  markdown command that drives the `backstory` tool with a `file:line` argument
  (`src/skill.ts`). Registration is optional — hosts without the skills service
  still expose the tool. Verified against the real `SkillService`.
- **v0.5 — privacy.** Prompts are scrubbed of common secrets (OpenAI/GitHub/AWS/
  Slack/Google keys, JWTs, `Bearer` tokens, `key=value` credentials) before they
  reach the ledger or commit trailers (`src/redact.ts`). Opt out per repo with
  `.dsh/backstory.config.json` (`"record": false`, plus custom `redactPatterns`)
  or globally with `DSH_BACKSTORY_DISABLE=1` (`src/config.ts`).
- **v0.3a — persistent line-level ledger.** A `tools/post-execute` observer
  records every write/edit to a repo-committed `.dsh/backstory.jsonl`
  (`turn, prompt, tool, file, line span, per-line content hashes`); the
  `backstory` tool attributes each line to the turn/prompt that wrote it, shown
  as a per-line `🧬t<turn>` owner. Survives across sessions/machines/people.
- **v0.3b — drift-proof attribution.** A line is matched to its ledger record by
  content hash first, so provenance survives the line moving in the file.
- **v0.4 — git-native provenance.** `DSH-Turn`/`DSH-Prompt`/`DSH-Session` commit
  trailers, recovered via `git blame → sha → trailer` (`readCommitBodies` +
  `parseProvenanceTrailers`); git tracks line drift. Per-line precedence:
  ledger content-hash > commit trailer > ledger range > live session.
- **`prepare-commit-msg` hook installer** (`npm run install-hook`): folds the
  newest ledger record for each staged file into commit trailers automatically.
  Best-effort, idempotent, self-disabling; backs up any existing hook. Covered
  by a unit test + an end-to-end test that installs the hook and commits.
- `README.zh.md` (Chinese README).
- `dsh.bundle` manifest field + `cordis.patch.yml` so the plugin can be listed
  and installed via the dsh host composition.
- GitHub Actions CI running `typecheck` + tests on Node 20 and 22.
- `src/git.ts`: git blame I/O extracted from the tool wiring, with end-to-end
  tests against real temporary repositories. Test count 10 → **31**.

### Fixed
- `render()` is now null-safe; `npm run typecheck` passes (was 12 errors).

## [0.2.0] — 2026-08-20

### Added
- dsh-native provenance: reconstruct which agent turn wrote a file and the user
  prompt that triggered it, from the append-only session log, surfaced as an
  `origin` line. File-level today; line-level (hunk ranges) is a follow-up.
- Provenance engine (`src/provenance.ts`) with unit tests.

## [0.1.0] — 2026-08-20

### Added
- Line-level code backstory from git history: each line mapped to the commit
  that last touched it (author, date, message), with a source-only fallback
  outside a git repo.
- Porcelain `git blame` parser (`src/blame.ts`) with unit tests.

[Unreleased]: https://github.com/MeghanBao/dsh-backstory/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MeghanBao/dsh-backstory/releases/tag/v0.2.0
[0.1.0]: https://github.com/MeghanBao/dsh-backstory/releases/tag/v0.1.0
