/**
 * dsh-turn-report — host half.
 *
 * Derives a compact per-turn project report entirely from the session log:
 * every closed turn gets one entry holding what was finished, what is still
 * in progress, what is left, plus tool/file/failure counts.
 *
 * The value reaches the browser through the session-projection wire view, so
 * the client renders a finished value — it never folds session events itself.
 * No model call is made and no token is spent: the report is deterministic.
 *
 * @module dsh-turn-report
 */

export const name = 'turn-report'

/** The projection service this plugin folds on. */
export const inject = ['sessionProjections']

/** Projection key; the client reads the same key through `useProjection`. */
const KEY = 'turnReport'

/**
 * Bump when the fold semantics or the state shape change.
 *
 * v2: file labels became workspace-relative and the tree rows carry an explicit
 * depth. A v1 checkpoint would otherwise be restored as-is and keep serving the
 * old absolute-path strings, so the version has to move with the shape.
 *
 * v3: each turn's todo now carries a `pending` list (unfinished items only).
 *
 * v4: the todo area reports `finished` — the items this turn newly completed —
 * instead of `pending`. Pending duplicated the built-in input-dock panel, which
 * renders the same live list; "newly finished" is the fact only the card knows.
 * `prevTodos` was added to state to compute it.
 *
 * v5: each turn carries `llm` — model route, response count and token buckets.
 *
 * v6: `live` — the current plan, its sections and next-up slice, for the status
 * bar. Derived on read from `todos`/`prevTodos`, not folded into each turn.
 *
 * v7: `prevTodos` now survives plan-less turns instead of being nulled by the
 * next `turn/start`. Before this the last real plan was erased two turns after it
 * was written, so long sessions lost their todo section entirely.
 *
 * v8: plan groups are now a fixed three-slot list (done / doing / left) with an
 * `empty` flag, instead of only the slots that happened to have rows. Without the
 * bump, a cached v7 checkpoint would keep serving the old shape and the HUD would
 * silently render the previous layout.
 *
 * v9: plan groups may now be STAGES (when items carry 【label】 prefixes) rather
 * than status buckets, and every row's `c` has the stage prefix stripped. Same
 * hazard as v8 and it was paid for again: the code changed, the version did not,
 * so a cached v8 checkpoint kept replaying the status-grouped shape and the UI
 * looked untouched across several restarts and green test runs.
 *
 * v10: `cleared` flag added, and the finished delta changed semantics. An explicit
 * empty list now drops the plan (previously it kept carrying the old one), stage
 * labels are excluded from the identity key (previously a relabel counted as new
 * work), and duplicates are matched by count (previously a second completion was
 * invisible). All three change what wire.view produces, so the checkpoint must be
 * rebuilt.
 *
 * v11: each turn may carry `decisions` — human messages quoted verbatim when they
 * read as a decision. New field, so the checkpoint changes again.
 */
const STATE_VERSION = 11

/** How many closed turns stay addressable. Older turns simply render no card. */
const MAX_TURNS = 15

/** Hard caps that keep the wire payload small; the config lowers them further. */
const HARD_MAX_ROWS = 20
const MAX_FILES = 6

/** Status bar budget: rows are scarce, so it shows a focused slice, not the list. */
const MAX_GROUP_ITEMS = HARD_MAX_ROWS
const LIVE_NEXT_UP = 3
/** How many quoted decisions to keep per turn. Two is already a busy turn. */
const MAX_DECISIONS = 2

/** How the todo area chooses between the finished list and the project tree. */
const TODO_VIEWS = ['auto', 'tree', 'both']

/** Argument keys that name a file a tool touches. */
const FILE_ARG_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'target_file']

/** Tool names whose argument carries a file path worth reporting. */
const FILE_TOOLS = new Set([
  'write', 'edit', 'multi_edit', 'insert', 'str_replace_editor', 'apply_patch',
  'create_file', 'edit_file', 'write_file', 'notebook_edit',
])

/**
 * Resolve raw plugin config into the complete settings object with defaults,
 * legacy aliases applied, and every value in range.
 *
 * Both the host's `Config` validation and `apply()` call this, so the settings a
 * row declares mean the same thing whether or not the host ran validation on it —
 * `apply()` must not assume a validated object arrives.
 * @param {unknown} value - the row's raw `config`, possibly absent or partial.
 * @returns {{ settings: object, issues: object[] }} the resolved settings and any problems.
 */
function resolveConfig(value) {
  const raw = value !== null && typeof value === 'object' ? value : {}
  const issues = []
  const settings = { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true, showFinished: true, showLlm: true, showStatusBar: true, statusBarOpen: true, replaceNativeTodo: true, todoView: 'auto' }
  if (raw.maxRows !== undefined) {
    if (typeof raw.maxRows === 'number' && Number.isFinite(raw.maxRows)) {
      settings.maxRows = Math.max(1, Math.min(HARD_MAX_ROWS, Math.trunc(raw.maxRows)))
    } else {
      issues.push({ message: 'maxRows must be a finite number', path: ['maxRows'] })
    }
  }
  for (const flag of ['showWithoutTasks', 'showTree', 'showFiles', 'showFinished', 'showLlm', 'showStatusBar', 'statusBarOpen', 'replaceNativeTodo']) {
    const supplied = raw[flag]
    if (supplied === undefined) continue
    if (typeof supplied === 'boolean') settings[flag] = supplied
    else issues.push({ message: `${flag} must be a boolean`, path: [flag] })
  }
  // `showPending` controlled the retired full-list block; honour it as an alias
  // so an existing profile row keeps its intent instead of silently reverting.
  if (raw.showPending !== undefined && raw.showFinished === undefined && typeof raw.showPending === 'boolean') {
    settings.showFinished = raw.showPending
  }
  if (raw.todoView !== undefined) {
    // `pending` was the retired view name; `auto` is its replacement.
    const view = raw.todoView === 'pending' ? 'auto' : raw.todoView
    if (TODO_VIEWS.includes(view)) settings.todoView = view
    else issues.push({ message: `todoView must be one of ${TODO_VIEWS.join(', ')}`, path: ['todoView'] })
  }
  return { settings, issues }
}

/**
 * Validate the resolved plugin configuration.
 *
 * Hand-rolled because the host only ever calls `Config['~standard'].validate`;
 * this keeps the bundle free of a runtime schema dependency.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-turn-report',
    validate(value) {
      const { settings, issues } = resolveConfig(value)
      return issues.length > 0 ? { issues } : { value: settings }
    },
  },
}

/**
 * Leading indentation of a todo line, in levels. Two spaces or one tab is one
 * level; four or more spaces is two. `todo_write` has no parent field, so the
 * nesting a person typed into the content is the only hierarchy available.
 * @param {string} content - the raw todo line.
 * @returns {number} the derived depth, 0 to 2.
 */
function depthOf(content) {
  const leading = /^[ \t]*/.exec(content)?.[0] ?? ''
  const width = leading.replace(/\t/g, '  ').length
  if (width >= 4) return 2
  if (width >= 2) return 1
  return 0
}

/**
 * Strip the bullet or numbering marker a person may have typed ahead of a todo.
 * @param {string} content - the raw todo line.
 * @returns {string} the display text.
 */
function labelOf(content) {
  return content.replace(/^[ \t]*/, '').replace(/^(?:[-*•·]|\d+[.)])\s+/, '').trim()
}

/**
 * Read a file path out of one tool call's raw argument JSON.
 * @param {string} toolName - the called tool.
 * @param {string} rawArguments - the model-produced JSON string.
 * @returns {string | undefined} the path, when the call names one.
 */
function fileOf(toolName, rawArguments) {
  if (!FILE_TOOLS.has(toolName)) return undefined
  if (typeof rawArguments !== 'string' || rawArguments === '') return undefined
  let parsed
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  for (const key of FILE_ARG_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Zeroed token buckets for one turn.
 * @returns {object} a fresh accumulator.
 */
function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

/**
 * Add one `assistant/message` usage report into the turn accumulator.
 *
 * Provider buckets are optional and individually untrustworthy, so each is read
 * defensively; a missing bucket contributes 0 rather than poisoning the sum.
 * @param {object} acc - the running accumulator.
 * @param {object | undefined} usage - the event's reported usage.
 * @returns {object} the same accumulator reference when nothing was addable.
 */
function addUsage(acc, usage) {
  if (usage === null || typeof usage !== 'object') return acc
  const count = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  const next = {
    input: acc.input + input,
    output: acc.output + output,
    cacheRead: acc.cacheRead + count(usage.cacheReadTokens),
    cacheWrite: acc.cacheWrite + count(usage.cacheWriteTokens),
    total: acc.total + (count(usage.totalTokens) || input + output),
  }
  if (next.input === acc.input && next.output === acc.output
    && next.cacheRead === acc.cacheRead && next.cacheWrite === acc.cacheWrite
    && next.total === acc.total) return acc
  return next
}

/**
 * System-generated user messages that are not a person talking.
 *
 * The session log stores injected context as `user/message` too: reminders, skill
 * catalogues, memory banners, per-step timestamps, approval-policy notices. Measured
 * on this project's own session: 92 of 145 user events were these, so filtering them
 * is most of the work — a decision extractor that reads them would fire on template
 * text rather than on anything a person decided.
 */
const INJECTED_PREFIXES = [
  '<system-reminder>',
  '<hindsight_pages>',
  '<hindsight_page_refresh>',
  'Time sampled while preparing turn',
  'The user changed the approval policy',
  'The following workspace instructions',
  'A skill is a reusable',
  'This is an automatically generated checkpoint',
  '[model changed:',
]

/**
 * Text of a `user/message` event, or null when it is not a person speaking.
 * @param {object} event - the `user/message` event.
 * @returns {string | null} the human text, trimmed; null for injected context.
 */
function humanTextOf(event) {
  const content = event?.data?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('\n')
  }
  const trimmed = text.trim()
  if (trimmed === '') return null
  for (const prefix of INJECTED_PREFIXES) {
    if (trimmed.startsWith(prefix)) return null
  }
  return trimmed
}

/**
 * Phrases that mean the sentence is NOT a decision, checked first.
 *
 * The review that prompted this feature put it plainly: a false "they split the
 * stage" changes what the reader believes happened, while a missed one only shows
 * less. So exclusion runs before inclusion, and the net is deliberately tight.
 */
const NON_DECISION_MARKERS = [
  // Hypotheticals and questions.
  '要不要', '是否要', '如果', '假如', '假设', '可以考虑', '也许', '或许', '是不是要',
  // A question mark at the end turns the sentence into a question, never a decision.
  '吗？', '吗?', '呢？', '呢?', '？', '?',
  // "我感觉是不是…" is an observation, not a decision.
  '我感觉', '是不是', '会不会', '能不能帮', '可不可以',
  // Negations of the action itself.
  '先别', '不要', '别急', '不用', '暂不', '不拆', '不合并', '先不做',
  // Reported speech / quoting.
  '你说要', '你说的', '有人建议', '文档里说', 'README 里',
]

/**
 * Phrases that mark a sentence as a CHOICE rather than a decision the reader needs
 * structured.
 *
 * Measured against this project's own 50 human messages: a regex that tries to pull
 * "action + object" out of natural language fired twice and got one of them wrong
 * ("C 方向要做" → object "方向"). Natural, conversational Chinese does not decompose
 * into verb/object cleanly enough for extraction to beat plain quotation, and the
 * review was explicit that a wrong "they decided X" is worse than showing less.
 *
 * So this list does not extract a structure — it only decides WHETHER a message is
 * worth quoting verbatim on the card.
 */
const DECISION_CUES = [
  '改成', '改为', '换成', '就用', '选', '方案',
  '要做', '就做', '先做', '开始做', '继续做',
  '先建', '先发', '先做', '先写', '先改',
  '拆分', '拆成', '合并', '去掉', '删掉', '移除', '放弃', '停止',
  '你不要', '我要你', '我是说', '应该是', '可以试', '决定',
]

/**
 * Shortest and longest message worth quoting as a decision.
 *
 * Too long is pasted material or a system prompt. Too short normally carries no
 * subject ("继续", "A"), but a few very short messages ARE complete decisions and
 * were the clearest ones in this session: "做吧", "方案 E", "C 方向要做". Those are
 * admitted by `SHORT_DECISION` below instead of by lowering the general floor.
 */
const DECISION_MIN_LENGTH = 8
const DECISION_MAX_LENGTH = 120

/**
 * Whole-message forms that are a decision despite being short.
 *
 * These match the ENTIRE trimmed message, so they cannot fire on a fragment of a
 * longer sentence. Covers the answers this project actually received: a bare option
 * letter, an option plus its wording, and a one-word go-ahead.
 *
 * "继续" is deliberately absent: it means "keep going", not "decided X". Quoting it
 * would put a meaningless row on the card every time the reader says it, and the
 * card is trying to report changes, not activity.
 */
const SHORT_DECISION = [
  /^(?:就)?(?:做吧|开始吧|开干|同意|批准)$/,
  /^(?:选|用)?\s*(?:方案|选项)?\s*[A-Za-z0-9一二三四五六七八九十]{1,3}\s*(?:方向|方案)?(?:要做)?$/,
  /^[A-Za-z0-9一二三四五六七八九十]{1,3}\s*(?:方向|方案)\s*(?:要做|要做吗|吧)?$/,
]

/**
 * A message a person wrote that reads as a decision, quoted rather than parsed.
 *
 * The card shows the person's own words, trimmed, prefixed by who said it. This is
 * honest: it cannot mislabel an action, because it never labels one. What it does
 * add beyond the task list is timing — the reader learns that on turn N the person
 * said this, even if the todo list has not caught up yet.
 * @param {string} text - one human message.
 * @returns {string | null} the quotable text, or null when it is not a decision.
 */
function decisionOf(text) {
  const body = text.trim()
  if (body.length > DECISION_MAX_LENGTH) return null
  // Exclusions first: a question or hypothesis is not a decision, even if it
  // contains a cue word ("要不要改成 X" must not fire).
  for (const marker of NON_DECISION_MARKERS) {
    if (body.includes(marker)) return null
  }
  // Whole-message forms are checked before the length floor, because the shortest
  // messages in this session were among the clearest decisions.
  for (const re of SHORT_DECISION) {
    if (re.test(body)) return body
  }
  if (body.length < DECISION_MIN_LENGTH) return null
  for (const cue of DECISION_CUES) {
    if (body.includes(cue)) return body
  }
  return null
}

/**
 * The `provider/model` route a finished assistant message came from.
 * @param {object | undefined} event - the `assistant/message` event.
 * @returns {string | undefined} the route, when the message names one.
 */
function routeOf(event) {
  const source = event?.data?.message?.source
  if (source === null || typeof source !== 'object') return undefined
  const provider = typeof source.provider === 'string' ? source.provider.trim() : ''
  const model = typeof source.model === 'string' ? source.model.trim() : ''
  return provider !== '' && model !== '' ? `${provider}/${model}` : undefined
}

/**
 * Make a path relative to the session workspace so a card shows
 * `docs/preview.svg` instead of the whole absolute path. Paths outside the
 * workspace stay absolute: hiding the location would be worse than the width.
 * @param {string} file - the absolute path a tool reported.
 * @param {string | undefined} cwd - the session workspace root.
 * @returns {string} the display path.
 */
function displayPath(file, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return file
  const normalized = file.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === root) return '.'
  if (normalized.startsWith(root + '/')) return normalized.slice(root.length + 1)
  return file
}

/**
 * Comparison key for one todo line, used only to decide whether two lists are
 * talking about the same task.
 *
 * `todo_write` entries carry no id, so cross-turn matching has to go through the
 * text. Comparing raw text over-reports: a model that rewords an already-finished
 * item (`- 写测试` → `写测试`) would look like brand-new work. Stripping the list
 * marker, heading marks, all whitespace and case folds those harmless rewrites
 * together. It is still a heuristic — a genuine rewording reads as new work.
 * @param {string} content - the raw todo line.
 * @returns {string} the comparison key.
 */
/**
 * Comparison key for one todo line — the TEXT only, with any 【stage】 prefix
 * removed first.
 *
 * Two failure modes come from keeping the stage label in the key:
 *
 * 1. **False "finished".** Moving a completed item from 【实现】 to 【验证】 keeps
 *    the task but changes the label. With the label in the key the move reads as a
 *    brand-new completion, so the card claims work that did not happen.
 * 2. **Missed "finished".** Matching by text alone collapses duplicates: two items
 *    literally named 文案 both hash to the same key, so finishing the second one is
 *    invisible once the first is in the "already done" set.
 *
 * Labels are stripped here because the stage is presentation, not identity; the
 * duplicate case is handled downstream by counting, not by keying.
 * @param {string} content - the raw todo line.
 * @returns {string} the comparison key.
 */
function matchKey(content) {
  return String(content)
    .replace(/^[\s\u3000]+/, '')
    .replace(/^(?:[-*•·]|\d+[.)]|#+)\s*/, '')
    .replace(/^[【\[〔][^】\]〕]*[】\]〕]\s*/, '')
    .replace(/[\s\u3000]+/g, '')
    .toLowerCase()
}

/**
 * Count how many items with each key are `completed`.
 * @param {object[] | null} todos - a whole list.
 * @returns {Map<string, number>} completed count per key.
 */
function completedCounts(todos) {
  const counts = new Map()
  if (!Array.isArray(todos)) return counts
  for (const item of todos) {
    if (item?.status !== 'completed') continue
    const key = matchKey(item?.content ?? '')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Which items this turn actually finished.
 *
 * Matching is by text key and then by COUNT, not by set membership. Comparing sets
 * loses duplicate items entirely: going from one completed 文案 to two completed
 * 文案 leaves the set unchanged (`{文案}` before and after), so the second
 * completion never reaches the card.
 *
 * The reported delta is therefore an increase in the per-key completed count. When
 * a key became more complete than before, the rows shown are the ones with that key
 * that are completed now, capped at the increase.
 *
 * This is the one todo fact the built-in input-dock panel cannot show — that panel
 * renders the live list, so it never says what changed.
 * @param {object[]} todos - this turn's whole list.
 * @param {object[] | null} prevTodos - the previous turn's list, or null.
 * @param {number} maxRows - how many finished items to keep.
 * @returns {{ finished: object[], finishedMore: number }} the delta.
 */
function finishedDuring(todos, prevTodos, maxRows) {
  const before = completedCounts(prevTodos)
  const finished = []
  let extra = 0
  // Walk this turn's list in order so the card keeps the author's ordering.
  const seen = new Map()
  for (const item of todos) {
    if (item?.status !== 'completed') continue
    const content = String(item?.content ?? '')
    const key = matchKey(content)
    const index = (seen.get(key) ?? 0) + 1
    seen.set(key, index)
    // Only the completions beyond what existed before are new; for a key that is
    // newly repeated, each copy past the previous count counts as new.
    const priorCount = before.get(key) ?? 0
    if (index <= priorCount) continue
    if (finished.length < maxRows) finished.push({ c: rowTextOf(content), d: depthOf(content) })
    else extra += 1
  }
  return { finished, finishedMore: extra }
}

/**
 * The plan HUD's data for one point in time: totals, the groups with their
 * children, and what is next. Shared by the frozen per-turn snapshot and the
 * live view so both render identically.
 * @param {object[]} todos - the whole list at that moment.
 * @param {number} maxRows - section budget from config.
 * @returns {object} the HUD payload.
 */
function planSnapshot(todos, maxRows) {
  let done = 0
  let doing = 0
  let left = 0
  const nextUp = []
  for (const item of todos) {
    const status = statusOf(item)
    if (status === 'done') done += 1
    else if (status === 'doing') doing += 1
    else left += 1
    if (status !== 'done' && nextUp.length < LIVE_NEXT_UP) {
      nextUp.push({ c: rowTextOf(String(item?.content ?? '')), s: status })
    }
  }
  const { groups, more } = groupTodos(todos, MAX_GROUP_ITEMS)
  return { total: todos.length, done, doing, left, nextUp, groups, more }
}

/**
 * The plan HUD's data for the conversation as it stands right now: the open
 * turn's list if it has written one, otherwise the last list the session saw.
 * @param {object} state - the fold state.
 * @param {number} maxRows - section budget from config.
 * @returns {object | null} the HUD payload, or null when no plan is known.
 */
function livePlan(state, maxRows) {
  const todos = Array.isArray(state.todos)
    ? state.todos
    : Array.isArray(state.prevTodos) ? state.prevTodos : null
  if (todos === null || todos.length === 0) return null
  return planSnapshot(todos, maxRows)
}

/**
 * The plan a closed turn should report.
 *
 * Three distinct inputs, which the naive implementation collapsed into two:
 *
 * | this turn | meaning | card |
 * |---|---|---|
 * | wrote a non-empty list | the plan changed | that list, no badge |
 * | wrote an EMPTY list | the author cleared the plan | "plan cleared", no carry-over |
 * | wrote nothing | no plan activity this turn | newest list still in force, marked stale |
 *
 * Treating "wrote empty" as "wrote nothing" made a deliberately cleared plan
 * reappear on the card as if it were still live — flagged `stale`, which reads as
 * "we could not update it" rather than "it was cleared".
 * @param {object[] | null} todos - the list this turn wrote, if any.
 * @param {object[] | null} prevTodos - the newest earlier list, if any.
 * @param {number} maxRows - section budget from config.
 * @param {boolean} wroteEmpty - the turn explicitly wrote an empty list.
 * @returns {object | null} the plan payload, or null when there is nothing to show.
 */
function planFor(todos, prevTodos, maxRows, wroteEmpty) {
  if (wroteEmpty) return null
  if (Array.isArray(todos) && todos.length > 0) {
    return { ...planSnapshot(todos, maxRows), stale: false }
  }
  if (Array.isArray(prevTodos) && prevTodos.length > 0) {
    return { ...planSnapshot(prevTodos, maxRows), stale: true }
  }
  return null
}

/**
 * Freeze the live turn into the compact entry the client renders.
 * @param {object} turn - the live accumulator for the closing turn.
 * @param {string} endKind - the `turn/end` reason kind.
 * @param {object[] | null} todos - the latest whole todo list, or null.
 * @param {object[] | null} prevTodos - the previous turn's whole list, or null.
 * @param {number} maxRows - how many todo rows to keep.
 * @param {string | undefined} cwd - the session workspace root, for shorter file labels.
 * @returns {object} the frozen entry.
 */
function freezeTurn(turn, endKind, todos, prevTodos, maxRows, cwd, wroteEmpty) {
  const entry = {
    n: turn.n,
    end: endKind,
    tools: turn.tools,
    failed: turn.failed,
    files: turn.files.slice(0, MAX_FILES).map(file => displayPath(file, cwd)),
    // Model spend for this turn: how many responses, from which route, costing
    // how many tokens. The built-in usage panel shows totals per turn but never
    // the call count, which is what makes a turn feel expensive.
    llm: (turn.calls ?? 0) > 0
      ? { calls: turn.calls, models: turn.models ?? [], usage: turn.usage ?? emptyUsage() }
      : null,
    // Decisions the person stated in their own words during this turn, quoted
    // verbatim. This is the only place the card can show a decision the task list
    // has no row for yet.
    decisions: Array.isArray(turn.decisions) && turn.decisions.length > 0 ? turn.decisions : null,
    // The plan state this card reports: the turn's own list when it wrote one,
    // otherwise the most recent list that was still in force, marked `stale`.
    //
    // Both extremes failed in practice. Rendering nothing for plan-less turns left
    // most cards with no HUD at all ("改完后怎么什么都没了"). Rendering the *live*
    // plan let a dozen cards repeat today's state with no explanation, which reads
    // as frozen. Carrying the newest known list forward and labelling it is the
    // honest middle: the reader sees the plan that was actually in force, and the
    // badge says the turn itself did not update it.
    plan: planFor(todos, prevTodos, maxRows, wroteEmpty === true),
    // A deliberately cleared plan is a real event worth reporting, not an absent
    // one. Without this flag a cleared turn is indistinguishable from a turn that
    // did nothing, so the reader cannot tell "they dropped the plan" from "we have
    // no news".
    cleared: wroteEmpty === true,
    todo: null,
  }
  if (Array.isArray(todos) && todos.length > 0) {
    const rows = []
    let done = 0
    let doing = 0
    let left = 0
    for (const item of todos) {
      const status = item?.status === 'completed' ? 'done' : item?.status === 'in_progress' ? 'doing' : 'left'
      if (status === 'done') done += 1
      else if (status === 'doing') doing += 1
      else left += 1
      const content = String(item?.content ?? '')
      if (rows.length < maxRows) rows.push({ s: status, c: rowTextOf(content), d: depthOf(content) })
    }
    const delta = finishedDuring(todos, prevTodos, HARD_MAX_ROWS)
    entry.todo = {
      total: todos.length,
      done,
      doing,
      left,
      updated: turn.todosUpdated,
      more: Math.max(0, todos.length - rows.length),
      rows,
      finished: delta.finished,
      finishedMore: delta.finishedMore,
    }
  }
  return entry
}

/**
 * One todo item's display status.
 * @param {object} item - a `todo_write` entry.
 * @returns {'done'|'doing'|'left'} the status.
 */
function statusOf(item) {
  if (item?.status === 'completed') return 'done'
  if (item?.status === 'in_progress') return 'doing'
  return 'left'
}

/**
 * The task text of a todo line, with list markers and any 【stage】 prefix removed.
 *
 * The stage prefix already appears as its own section heading, so repeating it on
 * every row wastes the scarce width a card has.
 * @param {string} content - the raw todo line.
 * @returns {string} the display text.
 */
function rowTextOf(content) {
  const stripped = labelOf(content).replace(/^[【\[〔][^】\]〕]*[】\]〕]\s*/, '').trim()
  return stripped === '' ? labelOf(content) : stripped
}

/**
 * Stage label carried by a todo line, if the author wrote one.
 *
 * `todo_write` has no stage field, so the stage has to travel inside the item text.
 * Accepted forms, matched anywhere at the start of the line (after list markers):
 *   【阶段一】做某事      〔P1〕做某事      [阶段2] 做某事
 * The captured text is returned trimmed, without the brackets.
 * @param {string} content - the raw todo line.
 * @returns {string | null} the stage label, or null when the line has none.
 */
function stageOf(content) {
  const bare = String(content).replace(/^[\s\u3000]+/, '').replace(/^(?:[-*•·]|\d+[.)])\s*/, '')
  const m = bare.match(/^[【\[〔]\s*([^】\]〕]{1,24}?)\s*[】\]〕]\s*(.*)$/)
  if (m === null) return null
  return m[1].trim() === '' ? null : m[1].trim()
}

/**
 * Whether a stage label reads as its own stage grouping key.
 *
 * Anything the author wrapped in brackets counts, so no vocabulary is imposed on
 * the writer: 【阶段一】, 【P1】, 【调研】 all become sections.
 * @param {string} content - the raw todo line.
 * @returns {boolean} true when the line opens a stage.
 */
function hasStage(content) {
  return stageOf(content) !== null
}

/**
 * Group a todo list into the status bar's collapsible sections.
 *
 * Two grouping axes, in priority order:
 *
 * 1. **Stages** — when any line carries a 【label】 prefix, sections are the stages
 *    in the order they first appear, and each section's status is derived from its
 *    own items (all done → done, any in progress → doing, else left). This is what
 *    "已完成 / 进行中 / 待办" means to a reader: which *phases of the work* are in
 *    which state, not which individual tasks are.
 * 2. **Status** — with no stage markers the list is bucketed by task status. Real
 *    `todo_write` payloads are flat (measured: 0 of 5 items carried indentation),
 *    so this is the common path and gives three stable slots.
 *
 * @param {object[]} todos - the whole list.
 * @param {number} maxItems - how many rows to keep per section.
 * @returns {{ groups: object[], more: number }} the sections and the omitted count.
 */
function groupTodos(todos, maxItems) {
  const anyStage = todos.some(item => hasStage(item?.content ?? ''))
  if (anyStage) return groupByStage(todos, maxItems)
  return groupByStatus(todos, maxItems)
}

/**
 * Group by the 【stage】 prefixes the author wrote.
 * @param {object[]} todos - the whole list.
 * @param {number} maxItems - how many rows to keep per section.
 * @returns {{ groups: object[], more: number }} the sections and the omitted count.
 */
function groupByStage(todos, maxItems) {
  const sections = new Map()
  let omitted = 0
  for (const item of todos) {
    const content = String(item?.content ?? '')
    const stage = stageOf(content) ?? '其他'
    const status = statusOf(item)
    let section = sections.get(stage)
    if (section === undefined) {
      section = { label: stage, rows: [], done: 0, doing: 0, left: 0 }
      sections.set(stage, section)
    }
    if (status === 'done') section.done += 1
    else if (status === 'doing') section.doing += 1
    else section.left += 1
    // The stage label itself is not a task row; store the remainder of the line.
    if (section.rows.length < maxItems) {
      section.rows.push({ c: rowTextOf(content), s: status, d: depthOf(content) })
    } else {
      omitted += 1
    }
  }
  const groups = [...sections.values()].map((section, index) => {
    const total = section.done + section.doing + section.left
    // A stage is in whatever state its own items are: fully done beats running.
    const state = total > 0 && section.done === total ? 'done' : section.doing > 0 ? 'doing' : 'left'
    return {
      k: 'stage-' + index,
      t: section.label,
      s: state,
      total,
      done: section.done,
      empty: total === 0,
      children: section.rows,
      collapsible: section.rows.length > 1,
      startOpen: state !== 'done',
      stage: true,
    }
  })
  return { groups, more: omitted }
}

/**
 * Group by task status — the fallback when no stage markers are present.
 * @param {object[]} todos - the whole list.
 * @param {number} maxItems - how many rows to keep per section.
 * @returns {{ groups: object[], more: number }} the sections and the omitted count.
 */
function groupByStatus(todos, maxItems) {
  const buckets = {
    done: { key: 'done', t: '已完成', s: 'done', rows: [], collapsedByDefault: true },
    doing: { key: 'doing', t: '进行中', s: 'doing', rows: [], collapsedByDefault: false },
    left: { key: 'left', t: '待办', s: 'left', rows: [], collapsedByDefault: false },
  }
  const SLOT_ORDER = ['done', 'doing', 'left']
  const order = []
  let omitted = 0
  for (const item of todos) {
    const content = String(item?.content ?? '')
    const status = statusOf(item)
    const bucket = buckets[status]
    if (order.includes(bucket) === false) order.push(bucket)
    if (bucket.rows.length < maxItems) {
      bucket.rows.push({ c: labelOf(content), s: status, d: depthOf(content) })
    } else {
      omitted += 1
    }
  }
  // Every slot is always present and in a fixed order, independent of which
  // statuses happened to occur — otherwise an all-done list would render
  // done → left → doing and the HUD would shift between turns. An empty slot that
  // stays put reads as "nothing here right now"; one that vanishes reads as lost
  // data, which is exactly how the missing 待办/进行中 was reported.
  const ordered = SLOT_ORDER.map(key => buckets[key])
  const groups = ordered.map((bucket) => {
    const total = bucket.rows.length + 0
    const doneRows = bucket.rows.filter(row => row.s === 'done').length
    return {
      k: bucket.key,
      t: bucket.t,
      s: bucket.s,
      total,
      done: doneRows,
      empty: bucket.rows.length === 0,
      children: bucket.rows.map(row => ({ c: row.c, s: row.s, d: row.d })),
      // A section with one item cannot usefully fold; two or more can.
      collapsible: bucket.rows.length > 1,
      startOpen: bucket.collapsedByDefault === false,
    }
  })
  return { groups, more: omitted }
}

/**
 * Register the `turnReport` projection.
 * @param {object} ctx - host context carrying the projection registry.
 * @param {object} config - the resolved plugin configuration.
 * @returns {Promise<void>} when the projection is registered.
 */
export async function apply(ctx, config) {
  // The host validates a row before activation, but activation must not depend on
  // that: resolve here too so aliases and defaults hold either way.
  const resolved = resolveConfig(config).settings
  const maxRows = resolved.maxRows

  /** Empty fold state: no open turn, no todo list seen yet, no closed turn. */
  const initState = () => ({ turns: {}, order: [], cur: null, todos: null, prevTodos: null, cwd: undefined })

  // One unit definition serves every session, so the view cache is keyed by the
  // immutable state object itself rather than by a single slot: `apply` replaces
  // the state on change, which makes the object an exact identity for its value.
  const wireCache = new WeakMap()

  const stateSchema = {
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('turnReport state must be an object')
      }
      return value
    },
  }

  const viewSchema = {
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('turnReport view must be an object')
      }
      return value
    },
  }

  await ctx.sessionProjections.register({
    key: KEY,
    stateSchema,
    init: header => ({ ...initState(), cwd: header?.cwd }),
    apply(state, event) {
      switch (event.type) {
        case 'turn/start': {
          // Mirror the host's own `todos` projection: the list is per-turn, and a
          // turn that never calls `todo_write` has no plan of its own. Keeping the
          // previous turn's list as the current one would report old work as if it
          // were current — but it is kept aside, because "what this turn newly
          // finished" can only be known by comparing against it.
          //
          // `prevTodos` must NOT be overwritten with null when the closing turn had
          // no list of its own: otherwise two plan-less turns in a row erase the
          // last real plan, and a session that wrote its list 20 turns ago loses it
          // entirely. Carry the newest non-null plan forward instead.
          return {
            ...state,
            todos: null,
            prevTodos: state.todos === null ? state.prevTodos : state.todos,
            cur: {
              n: event.data.turn,
              tools: 0,
              failed: 0,
              files: [],
              todosUpdated: false,
              wroteEmpty: false,
              decisions: [],
              calls: 0,
              usage: emptyUsage(),
              models: [],
            },
          }
        }
        case 'user/message': {
          // The only event that can carry a human decision. `todo_write` records
          // tasks, not intent, so a person saying "先建私有仓，明天再发 npm" leaves
          // no trace in the task list until the next write — and often not even then.
          // Quoting them here is what lets the card show a decision the plan has not
          // caught up with yet.
          const cur = state.cur
          if (cur === null) return state
          const text = humanTextOf(event)
          if (text === null) return state
          const decision = decisionOf(text)
          if (decision === null) return state
          if (cur.decisions.includes(decision)) return state
          return { ...state, cur: { ...cur, decisions: [...cur.decisions, decision].slice(-MAX_DECISIONS) } }
        }
        case 'assistant/message': {
          // One finished model response. This is the only event pairing a billed
          // attempt with its exact usage, so it is both the call count and the
          // token source. `assistant/attempt` also fires for retries that produced
          // no message, which would overstate "how many times the model answered".
          const cur = state.cur
          if (cur === null) return state
          const usage = addUsage(cur.usage, event.data?.usage)
          const route = routeOf(event)
          const models = route === undefined || cur.models.includes(route)
            ? cur.models
            : [...cur.models, route]
          return { ...state, cur: { ...cur, calls: cur.calls + 1, usage, models } }
        }
        case 'todo/write': {
          const todos = Array.isArray(event.data?.todos) ? event.data.todos : null
          if (todos === null) return state
          // `todosUpdated` alone cannot distinguish "wrote a list" from "wrote an
          // empty list": both set it. `wroteEmpty` is what lets a cleared plan stop
          // being carried forward instead of reappearing as a stale plan.
          const wroteEmpty = todos.length === 0
          return {
            ...state,
            todos,
            cur: state.cur === null ? null : { ...state.cur, todosUpdated: true, wroteEmpty },
          }
        }
        case 'tool/call': {
          const cur = state.cur
          if (cur === null) return state
          const file = fileOf(event.data?.name, event.data?.arguments)
          const files = file === undefined || cur.files.includes(file)
            ? cur.files
            : [...cur.files, file].slice(-MAX_FILES)
          return { ...state, cur: { ...cur, tools: cur.tools + 1, files } }
        }
        case 'tool/result': {
          const cur = state.cur
          if (cur === null || event.data?.message?.isError !== true) return state
          return { ...state, cur: { ...cur, failed: cur.failed + 1 } }
        }
        case 'turn/end': {
          const n = event.data?.turn
          const endKind = event.data?.reason?.kind ?? 'completed'
          const live = state.cur !== null && state.cur.n === n
            ? state.cur
            : { n, tools: 0, failed: 0, files: [], todosUpdated: false, wroteEmpty: false, decisions: [], calls: 0, usage: emptyUsage(), models: [] }
          const entry = freezeTurn(live, endKind, state.todos, state.prevTodos, maxRows, state.cwd, live.wroteEmpty)
          const turns = { ...state.turns, [String(n)]: entry }
          let order = [...state.order.filter(value => value !== n), n]
          if (order.length > MAX_TURNS) {
            const dropped = order.slice(0, order.length - MAX_TURNS)
            order = order.slice(order.length - MAX_TURNS)
            for (const old of dropped) delete turns[String(old)]
          }
          return { ...state, turns, order, cur: null }
        }
        default:
          return state
      }
    },
    wire: {
      viewSchema,
      summary: false,
      view(state) {
        const cached = wireCache.get(state)
        if (cached !== undefined) return cached
        const wire = {
          v: 1,
          turns: state.turns,
          // Live plan state for the status bar. Separate from `turns` on purpose:
          // `turns` is frozen history, this is the plan as it stands right now.
          live: livePlan(state, maxRows),
          opts: {
            showTree: resolved.showTree !== false,
            showFiles: resolved.showFiles !== false,
            showWithoutTasks: resolved.showWithoutTasks === true,
            showFinished: resolved.showFinished !== false,
            showLlm: resolved.showLlm !== false,
            showStatusBar: resolved.showStatusBar !== false,
            statusBarOpen: resolved.statusBarOpen !== false,
            replaceNativeTodo: resolved.replaceNativeTodo !== false,
            todoView: resolved.todoView ?? 'auto',
          },
        }
        wireCache.set(state, wire)
        return wire
      },
    },
    stateVersion: STATE_VERSION,
  })
}