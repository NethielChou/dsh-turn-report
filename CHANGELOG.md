# Changelog

All notable changes to this project are documented here.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-11-27

### Fixed

- Clearing a task list no longer looks like an un-updated one: an explicit empty
  write drops the plan and the card says it was cleared.
- Moving a finished item to another stage no longer reports it as new work; stage
  labels are excluded from the identity key.
- Two identically named items going from one completed to two completed now
  reports the completion instead of silently missing it (matched by count).
- A pending section is no longer hidden when its row text happens to match a
  finished row from a different section.

### Added

- Quoted decisions: when a person's message reads as a decision, the card shows
  their own words. Injected context, questions and hypotheticals are filtered out,
  and a retraction clears the turn's quotes.
- `plan.sourceTurn`: a carried-forward plan says which turn it came from.
- An empty card explains itself: a session that never used a task list says so.

### Changed

- Counts carry units: `tasks 5/6` and `2/2 done` instead of bare fractions.
- The demo screenshot now shows the current card.

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

[Unreleased]: https://github.com/NethielChou/dsh-turn-report/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/NethielChou/dsh-turn-report/releases/tag/v0.1.1
[0.1.0]: https://github.com/NethielChou/dsh-turn-report/releases/tag/v0.1.0