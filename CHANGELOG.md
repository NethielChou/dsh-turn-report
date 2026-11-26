# Changelog

All notable changes to this project are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-26

First public release.

### Added

- **Turn-end report card** under every completed reply, in the
  `conversation.chat.turnTail` slot:
  - metrics table: tool calls, failures (omitted when zero), files changed, end state;
  - execution summary: model route, **model call count**, input/output tokens, cache hit rate;
  - files touched, as workspace-relative paths;
  - what this turn newly finished;
  - optional ASCII project tree (`todoView: tree` / `both`).
- **Plan HUD** inside the card: a progress bar plus three fixed slots
  (done / in progress / left). Each populated slot folds independently; empty slots
  stay visible as dashed, non-clickable rows so the bar reads as a HUD rather than
  a list that occasionally loses entries.
- Per-turn plan snapshots, so historical cards show the state at their own turn
  instead of the conversation's latest state.
- Configuration: `maxRows`, `showWithoutTasks`, `showTree`, `showFiles`,
  `showFinished`, `showLlm`, `showStatusBar`, `todoView`.
- 83 assertions in `test/fold.test.mjs`, running the real `apply()` against a fake
  projection registry.

### Notes

- Nothing is written to disk; state lives in the session projection and persists
  with the session log.
- The card deliberately does not repeat the full task list: DSH already renders the
  live list in the built-in panel above the composer.

[Unreleased]: https://github.com/NethielChou/dsh-turn-report/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NethielChou/dsh-turn-report/releases/tag/v0.1.0