# Turn report

Adds a report card under every completed reply, plus a plan HUD inside it.
Everything is derived from the session log on the host — **no model calls, no token
cost, no files written**.

![A turn report card in the real DSH window](demo-card.png)

## What every turn gets

| Block | When it appears | Contents |
|---|---|---|
| 📋 Metrics | every turn | tool calls, failures (hidden when zero), files changed, end state |
| ⚙️ Execution | when the turn had model responses | model route, **call count**, input/output tokens, cache hit rate |
| 📄 Files | when the turn wrote files | workspace-relative paths, up to 6 |
| 💬 Decided | when the person stated a decision | their own words, quoted verbatim |
| 📝 Finished | when the turn ticked items off | only what this turn newly completed |
| 🎮 Plan HUD | when the session has a task list | progress bar + foldable sections |

### 💬 Why decisions are quoted, not parsed

`todo_write` records tasks, not intent. A person saying "先建私有仓，明天再发 npm"
leaves no trace in the task list until the next write — and sometimes not even then.
Quoting their words is the only honest way to show that on turn N they decided this.

It quotes rather than extracts because extraction was tried and failed: a regex
pulling "action + object" out of natural Chinese fired twice in 50 real messages and
got one wrong. Quoting cannot mislabel an action, because it never labels one.

Guards, in order: injected context is filtered first (in a real session 92 of 145
`user/message` events were system text, not a person), then questions, hypotheticals
and negations, then short whole-message answers which were among the clearest
decisions here ("做吧", "方案 E"). A retraction clears the turn's quotes.

### 📋 Three different silences

The card distinguishes them, because they mean different things:

| Situation | The card shows |
|---|---|
| This turn wrote a list | that turn's plan, no badge |
| This turn wrote nothing, but the session has a list | the newest plan in force, badged "carried over from turn N" |
| This turn cleared the list | "the task list was cleared this turn" |
| The session has **never** used a list | "no task list has been used in this session" |

Without the last line, a session whose model never called `todo_write` showed a bare
metrics table with no explanation, which reads as a broken plugin.

## The plan HUD

**Two grouping modes, chosen by the list's own content.**

**Stages** — when items carry a 【label】 prefix, the three counts describe *phases*
rather than individual tasks:

```
tasks 2/5   ✅ 2  ⏳ 1  ⬜ 2
⏭ Next: build the skeleton
📋 Current plan
┌ ▶ ✅ 阶段一·调研  2/2 done      ← its own tasks are all complete
┌ ▼ ⏳ 阶段二·实现  1/2 done
│  ⏳ 搭插件骨架
│  ⬜ 实现投影 fold
┌ ▼ ⬜ 阶段三·发布  0/1 done
```

A stage's state comes from its own items: all done → ✅, any running → ⏳, else ⬜.
Accepted prefixes: `【阶段一·调研】`, `〔P1〕`, `[阶段2]`.

**Status** — with no stage markers the list is bucketed by task status instead.

### Why stages must be marked, not inferred

`todo_write` has no stage field, and measured payloads are 100% flat (0 of 5 items
carried indentation). Stage cannot be derived from the data, so the person writing
the list marks it. Any bracketed prefix counts — no vocabulary is imposed.

## How it is kept honest

- Nothing is written to disk; all state lives in the session projection.
- Changing what the view produces **requires** bumping `stateVersion`, or a cached
  checkpoint keeps serving the old shape. This was paid for three times.
- The card reports what the data says, including "no list" — it never invents
  progress. If the model stops updating its list mid-turn, the card shows the stale
  counts, because that is the truth.

## The plan HUD

```
▰▰▰▰▰▰▰▰ 4/4  ✅ 4  ⏳ 0  ⬜ 0   ✨ All done
📋 Current plan
┌ ▼ ✅ Done  4
│  ✅ Fix the duplicated "next up" row
│  ✅ Draw a dashed rail at 0%
│  ✅ Update the README HUD section
│  ✅ Verify: syntax + assertions
┈ ⏳ In progress  0        ← dashed, dimmed, not clickable
┈ ⬜ To do  0
```

All three slots are always present, in a fixed order. A HUD whose slots come and go
reads as lost data; an empty slot that stays put reads as "nothing here right now".

## What it deliberately does not do

- **It does not repeat the full task list.** DSH already renders the live list in
  the built-in panel above the composer. This card reports the two facts that panel
  does not have: *what this turn finished*, and *what the plan looked like at the end
  of this turn*.
- **It does not require a task list every turn.** `todo_write` is the model's own
  judgement; forcing it would turn a "hello" into a pile of checkboxes. A turn with
  no plan simply gets no plan HUD.

## Honest limitations

- The "finished this turn" delta is computed by matching item text, because
  `todo_write` entries carry no stable id. List markers, whitespace and case are
  normalised away, so harmless rewording is handled — but a genuine rewrite reads as
  new work.
- Grouping is by status, not by the indentation in the task text. Measured against
  real sessions, `todo_write` payloads are flat: 0 of 5 items carried any indentation,
  so indentation-based grouping produced no groups at all.
- Only the last 15 turns keep cards; older ones scroll out of the projection window.
- The plan HUD is frozen per turn. If the model writes a list once and never updates
  it, the card will keep faithfully showing that stale list.

## Configuration

In the profile's `cordis.patch.yml`, overriding the same row (the whole `config` is
replaced, not deep-merged):

```yaml
- id: turn-report
  config:
    maxRows: 6              # rows for the tree and the finished list (hard cap 20)
    showWithoutTasks: true  # still show the card when the turn had no task list
    showTree: true          # allow the ASCII project tree
    showFiles: true         # list the files this turn touched
    showFinished: true      # show the "finished this turn" block
    showLlm: true           # show the model / calls / tokens summary line
    showStatusBar: true     # show the plan HUD
    todoView: auto          # auto | tree | both
```

## Install

```powershell
dsh plugin --profile desktop add file:"D:\path\to\dsh-turn-report"
```

Then restart DSH and refresh the page.

## Data sources

| Data | Source |
|---|---|
| Task list | `todo_write` snapshots (`todo/write`, whole-list replace) |
| Tool calls / failures | this turn's `tool/call`, `tool/result.message.isError` |
| Model / tokens | this turn's `assistant/message.usage` and `message.source` |
| Files changed | arguments of `write` / `edit` / `multi_edit` / `insert` / `str_replace_editor` |
| Turn bounds | `turn/start`, `turn/end` |