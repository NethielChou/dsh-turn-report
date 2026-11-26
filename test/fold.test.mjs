/**
 * Standalone check for the turn-report fold and the tree renderer.
 *
 * Runs the real `apply()` against a fake `sessionProjections` registry, feeds a
 * synthetic event stream, and asserts the wire payload. No DSH host needed.
 */
import { apply } from '../index.js'

/** Minimal fake registry that captures the unit definition. */
function fakeContext() {
  const captured = {}
  return {
    ctx: {
      sessionProjections: {
        async register(definition) {
          captured.definition = definition
          return { stateOf: () => captured.state, async dispose() {} }
        },
      },
    },
    captured,
  }
}

/** Run one event stream through a fresh registration and return the folded state + wire. */
async function fold(events, config, header) {
  const { ctx, captured } = fakeContext()
  await apply(ctx, config ?? { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true })
  const def = captured.definition
  let state = def.init(header)
  for (const [type, data] of events) state = def.apply(state, { type, data })
  return { state, wire: def.wire.view(state) }
}

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log('  PASS ' + name)
  } else {
    failures += 1
    console.log('  FAIL ' + name + '\n       expected: ' + e + '\n       actual:   ' + a)
  }
}

const todos = [
  { content: '## 阶段一：搭骨架', status: 'completed' },
  { content: '- 写 manifest', status: 'completed' },
  { content: '  - 加 icon', status: 'completed' },
  { content: '## 阶段二：验证', status: 'in_progress' },
  { content: '- 跑测试', status: 'pending' },
]

const stream = [
  ['turn/start', { turn: 1 }],
  ['todo/write', { todos }],
  ['tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"a/b.js"}' }],
  ['tool/result', { turn: 1, step: 1, message: { isError: false } }],
  ['tool/call', { turn: 1, step: 2, callId: 'c2', name: 'write', arguments: '{"file_path":"a/b.js"}' }],
  ['tool/call', { turn: 1, step: 2, callId: 'c3', name: 'read', arguments: '{"file_path":"a/c.js"}' }],
  ['tool/result', { turn: 1, step: 2, message: { isError: true } }],
  ['tool/call', { turn: 1, step: 3, callId: 'c4', name: 'edit', arguments: '{"file_path":"d/e.js"}' }],
  ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
]

const { state, wire } = await fold(stream)

console.log('fold assertions')
check('one turn recorded', Object.keys(wire.turns).length, 1)
const entry = wire.turns['1']
check('turn number', entry.n, 1)
check('end kind', entry.end, 'completed')
check('tool calls counted', entry.tools, 4)
check('failures counted', entry.failed, 1)
check('files deduped', entry.files, ['a/b.js', 'd/e.js'])
check('todo total', entry.todo.total, 5)
check('todo done', entry.todo.done, 3)
check('todo doing', entry.todo.doing, 1)
check('todo left', entry.todo.left, 1)
check('todoUpdated flag', entry.todo.updated, true)
check('labels strip markers', entry.todo.rows.map(r => r.c), [
  '## 阶段一：搭骨架', '写 manifest', '加 icon', '## 阶段二：验证', '跑测试',
])
check('depths derived from indent', entry.todo.rows.map(r => r.d), [0, 0, 1, 0, 0])
check('live turn closed', state.cur, null)

console.log('caps')
const many = Array.from({ length: 30 }, (_, i) => ({ content: 'item ' + i, status: 'pending' }))
const capped = await fold([
  ['turn/start', { turn: 2 }],
  ['todo/write', { todos: many }],
  ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
], { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true })
check('rows capped at maxRows', capped.wire.turns['2'].todo.rows.length, 6)
check('overflow counted', capped.wire.turns['2'].todo.more, 24)

console.log('turn window')
const windowEvents = []
for (let n = 1; n <= 20; n += 1) {
  windowEvents.push(['turn/start', { turn: n }], ['turn/end', { turn: n, reason: { kind: 'completed' } }])
}
const windowed = await fold(windowEvents)
check('keeps last 15 turns', Object.keys(windowed.wire.turns).length, 15)
check('oldest dropped', windowed.wire.turns['5'], undefined)
check('newest kept', windowed.wire.turns['20'] !== undefined, true)

console.log('turn-scoped todo list')
{
  // A turn that never writes a todo list must not inherit the previous one.
  const stale = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ])
  check('turn 1 keeps its list', stale.wire.turns['1'].todo.done, 3)
  check('turn 2 has no list', stale.wire.turns['2'].todo, null)
}

console.log('file labels are workspace-relative')
{
  const withCwd = await fold([
    ['turn/start', { turn: 1 }],
    ['tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"D:\\\\ws\\\\proj\\\\a\\\\b.js"}' }],
    ['tool/call', { turn: 1, step: 1, callId: 'c2', name: 'edit', arguments: '{"file_path":"D:\\\\other\\\\c.js"}' }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true }, { cwd: 'D:\\ws\\proj' })
  check('inside the workspace is relative', withCwd.wire.turns['1'].files[0], 'a/b.js')
  check('outside stays absolute', withCwd.wire.turns['1'].files[1], 'D:\\other\\c.js')
  const noCwd = await fold([
    ['turn/start', { turn: 1 }],
    ['tool/call', { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"file_path":"D:\\\\ws\\\\a.js"}' }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true }, {})
  check('no cwd leaves paths untouched', noCwd.wire.turns['1'].files[0], 'D:\\ws\\a.js')
}

console.log('finished-this-turn delta')
{
  const cfg = { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true, showFinished: true, todoView: 'auto' }
  // Turn 1 builds a plan and finishes two of it; nothing was finished before.
  const t1 = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  check('turn 1 finished = all completed items', t1.wire.turns['1'].todo.finished.map(f => f.c), ['## 阶段一：搭骨架', '写 manifest', '加 icon'])

  // Turn 2 keeps the same list but ticks one more item off.
  const turn2 = [
    ['turn/start', { turn: 2 }],
    ['todo/write', { todos: [
      { content: '## 阶段一：搭骨架', status: 'completed' },
      { content: '- 写 manifest', status: 'completed' },
      { content: '  - 加 icon', status: 'completed' },
      { content: '## 阶段二：验证', status: 'completed' },
      { content: '- 跑测试', status: 'pending' },
    ] }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ]
  const t2all = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ...turn2,
  ], cfg)
  check('turn 2 finished only the newly ticked item', t2all.wire.turns['2'].todo.finished.map(f => f.c), ['## 阶段二：验证'])
  check('already-finished items are not re-reported', t2all.wire.turns['2'].todo.finished.some(f => f.c === '写 manifest'), false)

  // A rewording of an already-finished item must NOT be reported as new work.
  const reworded = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [{ content: '- 写测试', status: 'completed' }] }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    // Same task, punctuation and marker stripped, plus one genuinely new item.
    ['todo/write', { todos: [
      { content: '写测试', status: 'completed' },
      { content: '  部署上线', status: 'completed' },
    ] }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ], cfg)
  check('reworded item is not new work', reworded.wire.turns['2'].todo.finished.map(f => f.c), ['部署上线'])

  // A plan that finishes nothing produces no finished list at all.
  const nothing = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'in_progress' }] }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  check('no finished items → empty list', nothing.wire.turns['1'].todo.finished, [])
  check('tree rows still carry the whole plan', nothing.wire.turns['1'].todo.rows.length, 2)

  // The finished list is capped by HARD_MAX_ROWS (20), not by the display budget:
// it is the card's headline, so a 4-row table setting must not truncate it to 4.
  const manyDone = Array.from({ length: 9 }, (_, i) => ({ content: 'done ' + i, status: 'completed' }))
  const capped3 = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: manyDone }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], { ...cfg, maxRows: 4 })
  check('finished ignores the small maxRows budget', capped3.wire.turns['1'].todo.finished.length, 9)
  check('so nothing is reported as truncated', capped3.wire.turns['1'].todo.finishedMore, 0)

  // At the hard ceiling it does truncate, and says how many are left.
  const beyond = Array.from({ length: 25 }, (_, i) => ({ content: 'x ' + i, status: 'completed' }))
  const over = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: beyond }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], { ...cfg, maxRows: 4 })
  check('hard ceiling still caps', over.wire.turns['1'].todo.finished.length, 20)
  check('overflow counted past the ceiling', over.wire.turns['1'].todo.finishedMore, 5)
}

console.log('config aliases and todoView')
{
  const applyCfg = async (raw) => {
    const { ctx, captured } = fakeContext()
    await apply(ctx, raw)
    return captured.definition
  }
  const def = await applyCfg({ showPending: false })
  const state = def.init({ cwd: 'D:\\ws' })
  check('legacy showPending honoured as showFinished', def.wire.view(state).opts.showFinished, false)
  const def2 = await applyCfg({ todoView: 'pending' })
  check('legacy todoView pending maps to auto', def2.wire.view(def2.init({})).opts.todoView, 'auto')
  const def3 = await applyCfg({})
  check('default todoView is auto', def3.wire.view(def3.init({})).opts.todoView, 'auto')
}

console.log('llm accounting (model / calls / tokens)')
{
  const cfg = { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true, showFinished: true, showLlm: true, todoView: 'auto' }
  const msg = (route, usage) => ['assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [], source: { provider: route[0], model: route[1] } },
    usage,
  }]
  const accounted = await fold([
    ['turn/start', { turn: 1 }],
    msg(['ustc', 'deepseek-flash'], { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 0 }),
    msg(['ustc', 'deepseek-flash'], { inputTokens: 50, outputTokens: 10, totalTokens: 60, cacheReadTokens: 900 }),
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  const llm = accounted.wire.turns['1'].llm
  check('counts each model response', llm.calls, 2)
  check('dedupes the same route', llm.models, ['ustc/deepseek-flash'])
  check('sums uncached input', llm.usage.input, 150)
  check('sums output', llm.usage.output, 30)
  check('sums cache read', llm.usage.cacheRead, 900)
  check('sums provider totals', llm.usage.total, 180)

  // Two different models in one turn are both reported.
  const mixed = await fold([
    ['turn/start', { turn: 1 }],
    msg(['ustc', 'deepseek-flash'], { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    msg(['qoder-cn', 'DeepSeek-Flash'], { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  check('keeps every distinct route', mixed.wire.turns['1'].llm.models, ['ustc/deepseek-flash', 'qoder-cn/DeepSeek-Flash'])

  // A turn with no model response reports no llm block at all.
  const silent = await fold([
    ['turn/start', { turn: 1 }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  check('no responses → no llm block', silent.wire.turns['1'].llm, null)

  // A message with no usage still counts as a call, contributing zero tokens.
  const bare = await fold([
    ['turn/start', { turn: 1 }],
    ['assistant/message', { turn: 1, step: 1, message: { source: { provider: 'p', model: 'm' } } }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], cfg)
  check('usage-less response still counts', bare.wire.turns['1'].llm.calls, 1)
  check('usage-less response adds zero tokens', bare.wire.turns['1'].llm.usage.total, 0)

  // showLlm:false suppresses it on the wire.
  const hidden = await fold([
    ['turn/start', { turn: 1 }],
    msg(['p', 'm'], { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
  ], { ...cfg, showLlm: false })
  check('showLlm false reaches the wire', hidden.wire.opts.showLlm, false)
}

console.log('status bar live view (status sections + next up)')
{
  const cfg = { maxRows: 6, showWithoutTasks: true, showTree: true, showFiles: true, showFinished: true, showLlm: true, showStatusBar: true, todoView: 'auto' }
  // A realistic FLAT list: real todo_write payloads carry no indentation at all.
  const flat = [
    { content: '阶段一：调研', status: 'completed' },
    { content: '阶段二：实现', status: 'in_progress' },
    { content: '阶段三：发布', status: 'pending' },
    { content: '写测试', status: 'pending' },
  ]
  const mid = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: flat }],
  ], cfg)
  const live = mid.wire.live
  check('live has totals', [live.total, live.done, live.doing, live.left], [4, 1, 1, 2])
  check('live next-up lists unfinished in order', live.nextUp.map(r => r.c), ['阶段二：实现', '阶段三：发布', '写测试'])
  check('groups by status, not indentation', live.groups.map(g => g.k), ['done', 'doing', 'left'])
  check('each section counts its own rows', live.groups.map(g => g.total), [1, 1, 2])
  check('finished section folds by default', live.groups[0].startOpen, false)
  check('pending section starts open', live.groups[2].startOpen, true)
  check('multi-item section can fold', live.groups[2].collapsible, true)
  check('single-item section cannot fold', live.groups[1].collapsible, false)

  // The exact failure this replaced: a fully flat all-done list used to produce one
  // non-collapsible section per item, so no arrows ever rendered.
  const allDone = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [
      { content: 'Host：新增视图', status: 'completed' },
      { content: 'Client：状态栏组件', status: 'completed' },
      { content: '配置开关，测试全过', status: 'completed' },
    ] }],
  ], cfg)
  check('flat all-done list fills the done slot', allDone.wire.live.groups[0].total, 3)
  check('that slot holds every item', allDone.wire.live.groups[0].children.length, 3)
  check('so the fold arrow exists', allDone.wire.live.groups[0].collapsible, true)
  // All three slots stay present at 0 — a HUD that hides empty slots reads as
  // lost data, which is exactly how the user reported it.
  check('all three slots always present', allDone.wire.live.groups.map(g => g.k), ['done', 'doing', 'left'])
  check('empty slots are flagged, not dropped', allDone.wire.live.groups.map(g => g.empty), [false, true, true])

  // Indented lists keep their structure inside the status section.
  const indented = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [
      { content: '阶段一', status: 'completed' },
      { content: '  子项 A', status: 'completed' },
      { content: '  子项 B', status: 'pending' },
    ] }],
  ], cfg)
  check('indent still recorded per row', indented.wire.live.groups.flatMap(g => g.children.map(c => c.d)), [0, 1, 1])
  check('slots keep a fixed order', indented.wire.live.groups.map(g => g.k), ['done', 'doing', 'left'])
  check('the empty doing slot sits between', indented.wire.live.groups.map(g => g.empty), [false, true, false])

  // Across a turn boundary with no new list, the bar keeps showing the plan.
  const carried = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: flat }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
  ], cfg)
  check('plan survives the turn boundary', carried.wire.live.total, 4)

  // Each card must show ITS OWN plan, not the conversation's latest one.
  const twoTurns = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }] }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    ['todo/write', { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'pending' },
    ] }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ], cfg)
  check('turn 1 froze its own plan', twoTurns.wire.turns['1'].plan.total, 2)
  check('turn 1 plan is still unfinished', twoTurns.wire.turns['1'].plan.done, 0)
  check('turn 2 froze its own plan', twoTurns.wire.turns['2'].plan.total, 3)
  check('turn 2 plan shows its own progress', twoTurns.wire.turns['2'].plan.done, 2)
  check('live view still tracks the latest', twoTurns.wire.live.total, 3)

  // REGRESSION: a turn that writes no list must NOT show another turn's plan.
  // The card used to fall back to the conversation's live plan for such turns, so
  // every plan-less card in a long session rendered the same current plan and the
  // reader saw the "已完成" block frozen across a dozen turns.
  const quiet = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: [{ content: 'p1', status: 'pending' }] }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 3 }],
    ['turn/end', { turn: 3, reason: { kind: 'completed' } }],
  ], cfg)
  check('turn 1 has its own plan', quiet.wire.turns['1'].plan.total, 1)
  check('turn 2 shows no inherited plan', quiet.wire.turns['2'].plan, null)
  check('turn 3 shows no inherited plan', quiet.wire.turns['3'].plan, null)
  check('live still tracks the session plan', quiet.wire.live.total, 1)

  // A turn with no list of its own still gets no plan (unchanged behaviour).
  const noList = await fold([
    ['turn/start', { turn: 1 }],
    ['todo/write', { todos: flat }],
    ['turn/end', { turn: 1, reason: { kind: 'completed' } }],
    ['turn/start', { turn: 2 }],
    ['turn/end', { turn: 2, reason: { kind: 'completed' } }],
  ], cfg)
  check('turn without a list has no own plan', noList.wire.turns['2'].plan, null)
  check('live plan still available for context', noList.wire.live.total, 4)

  // REGRESSION: the last real plan must survive many plan-less turns. Before the
  // fix `turn/start` set prevTodos = state.todos (null on a plan-less turn), so two
  // turns after the list was written it was gone forever and long sessions lost the
  // todo section entirely. Session-34847 wrote its list at turn 21 and showed
  // nothing from turn 30 onward because of this.
  const longGap = []
  longGap.push(['turn/start', { turn: 1 }])
  longGap.push(['todo/write', { todos: flat }])
  longGap.push(['turn/end', { turn: 1, reason: { kind: 'completed' } }])
  for (let turn = 2; turn <= 12; turn += 1) {
    longGap.push(['turn/start', { turn }])
    longGap.push(['turn/end', { turn, reason: { kind: 'completed' } }])
  }
  const gap = await fold(longGap, cfg)
  check('plan survives 11 plan-less turns', gap.wire.live.total, 4)
  check('and its groups are still intact', gap.wire.live.groups.length, 3)

  // No plan at all → no live view, so nothing renders.
  const empty = await fold([['turn/start', { turn: 1 }], ['turn/end', { turn: 1, reason: { kind: 'completed' } }]], cfg)
  check('no plan → no live view', empty.wire.live, null)

  // Config can hide the whole HUD.
  const hidden = await fold([['turn/start', { turn: 1 }], ['todo/write', { todos: flat }]], { ...cfg, showStatusBar: false })
  check('showStatusBar false reaches the wire', hidden.wire.opts.showStatusBar, false)
}

console.log('no-op events keep the state reference')
{
  const { ctx, captured } = fakeContext()
  await apply(ctx, {})
  const def = captured.definition
  const initial = def.init()
  const afterStart = def.apply(initial, { type: 'turn/start', data: { turn: 1 } })
  const afterUserMessage = def.apply(afterStart, { type: 'user/message', data: {} })
  check('unrelated event returns same reference', afterUserMessage === afterStart, true)
  check('wire cached per state', def.wire.view(afterStart) === def.wire.view(afterStart), true)
}

console.log('client tree renderer')
{
  const ModuleLoader = { load: spec => { globalThis.__loaded = spec } }
  globalThis.window = { __ModuleLoader__: ModuleLoader }
  const requireShim = () => ({ createElement: () => null })
  await import('../client.js')
  const loaded = globalThis.__loaded
  const mod = loaded.factory(requireShim)
  const lines = mod.treeLines([
    { s: 'done', c: '阶段一', d: 0 },
    { s: 'done', c: '子项 A', d: 1 },
    { s: 'doing', c: '阶段二', d: 0 },
    { s: 'left', c: '子项 B', d: 1 },
    { s: 'left', c: '孙项 C', d: 2 },
  ])
  const flat = lines.map(l => l.rail.join('') + l.branch + ' ' + l.icon + ' ' + l.c)
  check('root with siblings uses ├─', lines[0].branch, '├─')
  check('only child is last under a non-last root', flat[1], '│ └─ ✅ 子项 A')
  check('last root uses └─', lines[2].branch, '└─')
  check('rail has one cell per level', lines[4].rail.length, 2)
  check('line count', lines.length, 5)
  console.log('  rendered:')
  for (const line of flat) console.log('    ' + line)
}

console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)