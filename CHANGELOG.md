# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `dsh.bundle` manifest field + `cordis.patch.yml` so the plugin can be listed
  and installed via the dsh host composition.
- GitHub Actions CI running `typecheck` + tests on Node 20 and 22.
- `src/git.ts`: git blame I/O extracted from the tool wiring, with end-to-end
  tests against real temporary repositories (commit attribution, line ranges,
  and the outside-a-repo fallback). Test count 10 → 13.

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
