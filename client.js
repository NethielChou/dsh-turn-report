/**
 * dsh-turn-report — browser half.
 *
 * Renders one card beneath every completed turn: emoji progress chips, a
 * compact metrics table, the files this turn touched, and an ASCII project
 * tree derived from the turn's todo snapshot.
 *
 * The value comes from the `turnReport` session projection — the host folds it
 * from the session log, so this module only formats a finished object.
 */

window.__ModuleLoader__.load({
  // This id must equal the name the host registers the bundle under, which is the
  // profile's dependency key — `dsh-turn-report`, not the scoped npm name. Using
  // the npm name here made the host report `could not load "dsh-turn-report":
  // loaded without registering "dsh-turn-report"` and then a duplicate-factory
  // error, so the whole client half silently failed to mount.
  id: 'dsh-turn-report',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'turnReport'

    const copy = {
      zh: {
        title: '本轮项目汇报',
        turn: '第 {n} 轮',
        metric: '项',
        value: '值',
        tools: '工具调用',
        failed: '失败',
        files: '改动文件',
        ended: '结束状态',
        tree: '任务树',
        treeSummary: '{done}/{total} 完成',
        finished: '本轮完成',
        finishedCount: '{n} 项',
        llmCalls: '调用 {n} 次',
        llmTokens: 'in {input} / out {output}',
        llmCache: '缓存命中 {n}%',
        llmDetailInput: '未缓存输入：{n}',
        llmDetailCacheRead: '缓存读：{n}',
        llmDetailCacheWrite: '缓存写：{n}',
        llmDetailOutput: '输出：{n}',
        llmDetailTotal: '合计：{n}',
        sbPlan: '当前计划',
        sbStale: '本轮未更新',
        sbStaleHint: '本轮没有写任务清单，上面是仍在生效的最近一份计划',
        sbAllDone: '全部完成',
        sbNext: '下一项',
        sbExpand: '展开状态栏',
        sbCollapse: '收起状态栏',
        more: '还有 {n} 条未展开',
        empty: '本轮没有任务清单',
        filesLabel: '产出文件',
      },
      en: {
        title: 'Turn report',
        turn: 'Turn {n}',
        metric: 'Metric',
        value: 'Value',
        tools: 'Tool calls',
        failed: 'Failures',
        files: 'Files changed',
        ended: 'End state',
        tree: 'Project tree',
        treeSummary: '{done}/{total} done',
        finished: 'Finished this turn',
        finishedCount: '{n} items',
        llmCalls: '{n} calls',
        llmTokens: '{input} in / {output} out',
        llmCache: '{n}% cached',
        llmDetailInput: 'Uncached input: {n}',
        llmDetailCacheRead: 'Cache read: {n}',
        llmDetailCacheWrite: 'Cache write: {n}',
        llmDetailOutput: 'Output: {n}',
        llmDetailTotal: 'Total: {n}',
        sbPlan: 'Current plan',
        sbStale: 'not updated this turn',
        sbStaleHint: 'This turn wrote no task list; the newest plan still in force is shown.',
        sbAllDone: 'All done',
        sbNext: 'Next',
        sbExpand: 'Expand status bar',
        sbCollapse: 'Collapse status bar',
        more: '{n} more not shown',
        empty: 'No task list this turn',
        filesLabel: 'Files',
      },
    }

    /** Status glyph and colour token per todo state. */
    const STATUS = {
      done: { icon: '✅', color: 'var(--dsw-alias-state-success-primary)' },
      doing: { icon: '⏳', color: 'var(--dsw-alias-state-warn-primary)' },
      left: { icon: '⬜', color: 'var(--dsw-alias-label-tertiary)' },
    }

    const style = {
      card: {
        marginTop: 8,
        padding: '12px 14px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: 1.55,
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 10,
      },
      title: { fontWeight: 600, fontSize: 13 },
      turnBadge: {
        fontSize: 11,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l3)',
        color: 'var(--dsw-alias-label-secondary)',
      },
      chips: { marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 12, fontVariantNumeric: 'tabular-nums' },
      table: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 12,
        marginBottom: 10,
      },
      th: {
        textAlign: 'left',
        padding: '4px 8px',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-secondary)',
        borderBottom: '1px solid var(--dsw-alias-border-l2)',
      },
      td: {
        padding: '4px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        fontVariantNumeric: 'tabular-nums',
      },
      sectionTitle: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        margin: '0 0 6px',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      pre: {
        margin: 0,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-module-platform)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.65,
        // Long tree lines scroll inside the card instead of widening it.
        overflowX: 'auto',
        maxWidth: '100%',
        boxSizing: 'border-box',
      },
      treeRow: {
        display: 'flex',
        alignItems: 'baseline',
        whiteSpace: 'nowrap',
      },
      rail: {
        // One fixed-width cell per level keeps every vertical aligned even when
        // the box-drawing glyph comes from a fallback face.
        display: 'inline-block',
        width: '1.1em',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      branch: {
        display: 'inline-block',
        width: '1.6em',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      treeText: {
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      pendingBox: {
        margin: '0 0 10px',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
      },
      llmLine: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 6,
        margin: '0 0 8px',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
      llmModel: {
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11.5,
      },
      // ── plan HUD (inside the turn-end card) ───────────────────────────────
      hud: {
        margin: '0 0 10px',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        fontVariantNumeric: 'tabular-nums',
      },
      hudBar: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        lineHeight: 1.6,
      },
      hudProgress: {
        flex: '1 1 200px',
        minWidth: 140,
        height: 8,
        borderRadius: 4,
        background: 'var(--dsw-alias-border-l2)',
        overflow: 'hidden',
        display: 'block',
        boxSizing: 'border-box',
      },
      hudProgressFill: {
        display: 'block',
        height: '100%',
        borderRadius: 4,
        transition: 'width .25s ease',
      },
      hudCount: {
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        fontVariantNumeric: 'tabular-nums',
      },
      hudChip: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      hudChipZero: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, opacity: 0.45 },
      hudAllDone: { color: 'var(--dsw-alias-state-success-primary, #2f9e5e)', fontSize: 12 },
      hudNextRow: {
        marginTop: 4,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      sbSection: { marginTop: 6 },
      sbSectionTitle: {
        fontSize: 11,
        color: 'var(--dsw-alias-label-tertiary)',
        letterSpacing: '.02em',
        marginBottom: 2,
      },
      sbGroupTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        width: '100%',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 6,
        marginTop: 3,
      },
      sbGroupTitleOpen: {
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        width: '100%',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-module-platform)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 6,
        marginTop: 3,
      },
      sbChevron: {
        display: 'inline-block',
        width: '1em',
        textAlign: 'center',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 9,
        lineHeight: 1,
      },
      sbGroupLabel: { fontWeight: 600 },
      // An empty HUD slot: present, but visibly inert.
      sbGroupEmpty: {
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        width: '100%',
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'transparent',
        padding: '4px 8px',
        borderRadius: 6,
        marginTop: 3,
        boxSizing: 'border-box',
        opacity: 0.55,
        cursor: 'default',
      },
      sbGroupLabelEmpty: { fontWeight: 400, color: 'var(--dsw-alias-label-tertiary)' },
      sbStale: {
        marginLeft: 6,
        padding: '0 5px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        fontSize: 10,
        fontWeight: 400,
        color: 'var(--dsw-alias-label-tertiary)',
        letterSpacing: '0.02em',
      },
      sbGroupCount: {
        marginLeft: 'auto',
        fontSize: 11,
        color: 'var(--dsw-alias-label-tertiary)',
        fontVariantNumeric: 'tabular-nums',
        background: 'var(--dsw-alias-bg-module-platform)',
        borderRadius: 6,
        padding: '0 5px',
      },
      sbRow: {
        padding: '1px 0 1px 14px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      pendingRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        fontSize: 12.5,
        lineHeight: 1.7,
      },
      pendingIcon: { flex: '0 0 auto' },
      pendingText: { flex: '1 1 auto', minWidth: 0 },
      files: {
        margin: '0 0 10px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary)',
        maxWidth: '100%',
      },
      file: {
        padding: '1px 7px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        // A chip never grows past the card; the full path stays in its tooltip.
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 11,
      },
      more: { marginTop: 4, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
    }

    /**
     * Fill `{name}` placeholders in a locale string.
     * @param {string} text - the template.
     * @param {object} params - replacement values.
     * @returns {string} the filled text.
     */
    function fmt(text, params) {
      return String(text).replace(/\{(\w+)\}/g, (_, key) => (params[key] === undefined ? '' : String(params[key])))
    }

    /**
     * Compact token count: 999 → `999`, 1234 → `1.2k`, 468123 → `468k`.
     * @param {number} value - the count.
     * @returns {string} the display form.
     */
    function shortTokens(value) {
      const n = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
      if (n < 1000) return String(n)
      if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      if (n < 1000000) return Math.round(n / 1000) + 'k'
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
    }

    /**
     * Cache hit share of the prompt, as a whole percent.
     * @param {object} usage - the turn's token buckets.
     * @returns {number | null} the percent, or null when the prompt was empty.
     */
    function cacheHitPercent(usage) {
      const prompt = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
      if (prompt <= 0) return null
      return Math.round(((usage.cacheRead ?? 0) / prompt) * 100)
    }

    /**
     * One-line token summary: `input / output` plus cache hit when known.
     * @param {object} usage - the turn's token buckets.
     * @param {function} label - locale lookup.
     * @returns {string} the summary.
     */
    function tokenSummary(usage, label) {
      const shown = fmt(label('llmTokens'), {
        input: shortTokens(usage.input),
        output: shortTokens(usage.output),
      })
      const hit = cacheHitPercent(usage)
      return hit === null ? shown : shown + ' · ' + fmt(label('llmCache'), { n: hit })
    }

    /**
     * Full breakdown for the hover title, where exact numbers belong.
     * @param {object} usage - the turn's token buckets.
     * @param {function} label - locale lookup.
     * @returns {string} the tooltip text.
     */
    function tokenDetail(usage, label) {
      // Sum the buckets we display rather than echoing the provider's total: if a
      // provider reports an inconsistent total, a tooltip whose parts do not add
      // up reads as a bug.
      const sum = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0)
      return [
        fmt(label('llmDetailInput'), { n: usage.input ?? 0 }),
        fmt(label('llmDetailCacheRead'), { n: usage.cacheRead ?? 0 }),
        fmt(label('llmDetailCacheWrite'), { n: usage.cacheWrite ?? 0 }),
        fmt(label('llmDetailOutput'), { n: usage.output ?? 0 }),
        fmt(label('llmDetailTotal'), { n: sum }),
      ].join('\n')
    }

    /**
     * Turn the flat todo rows into tree rows carrying a rail prefix and an indent.
     *
     * The rails are drawn as per-level segments with CSS indent rather than as a
     * padded string: box-drawing glyphs (`│ ├─ └─`) only join when every glyph
     * comes from one monospace face, and a fallback face breaks the alignment.
     * Splitting the prefix into one span per level makes each segment's width
     * explicit, so the verticals line up under any font.
     * @param {object[]} rows - rows of `{ s, c, d }`.
     * @returns {object[]} rows of `{ s, c, d, rail }` where rail is one string per level.
     */
    function treeLines(rows) {
      const lines = []
      const lastAt = []
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const depth = Math.max(0, Math.min(Number(row.d) || 0, lastAt.length))
        lastAt.length = depth
        let isLast = true
        for (let next = index + 1; next < rows.length; next += 1) {
          const nextDepth = Number(rows[next].d) || 0
          if (nextDepth > depth) continue
          isLast = nextDepth < depth
          break
        }
        const rail = []
        for (let level = 0; level < depth; level += 1) rail.push(lastAt[level] === true ? '  ' : '│ ')
        const branch = depth === 0 && rows.length === 1 ? '' : isLast ? '└─' : '├─'
        const status = STATUS[row.s] ?? STATUS.left
        lines.push({ s: row.s, c: row.c, d: depth, rail, branch, icon: status.icon })
        lastAt[depth] = isLast
      }
      return lines
    }

    /**
     * Render the completed-turn card.
     * @param {object} props - slot props.
     * @returns {object | null} the card, or null when this turn has no report.
     */
    function TurnReport(props) {
      const { turn, useProjection, t } = props
      // Keep the hook call unconditional: returning before it on a missing view
      // would change the hook count on the next render (React #310).
      let view
      try {
        view = useProjection('turnReport')
      } catch {
        view = undefined
      }
      // Explicit fold overrides per section. Absent keys fall back to the default
      // (finished sections folded, active ones open).
      const [overrides, setOverrides] = React.useState(() => new Map())
      const toggleSection = (index, open) => {
        setOverrides((current) => {
          const next = new Map(current)
          next.set(index, open)
          return next
        })
      }
      if (view === undefined || view === null || view.turns === undefined) return null
      if (turn === undefined || turn.end === undefined) return null
      const entry = view.turns[String(turn.turn)]
      if (entry === undefined || entry === null) return null

      const opts = view.opts ?? {}
      const todo = entry.todo
      if (todo === null && opts.showWithoutTasks !== true) return null

      // Decide the todo area up front: the header's plan-wide chips belong to the
      // whole-plan view only. In the default view the card reports what this turn
      // finished, and the live plan counts live in the built-in input-dock panel.
      const finished = Array.isArray(todo?.finished) ? todo.finished : []
      const todoView = opts.todoView ?? 'auto'
      const showsWholePlan = opts.showTree !== false
        && todo !== null && todo.rows.length > 0
        && (todoView === 'both' || todoView === 'tree')
      const showFinished = opts.showFinished !== false && finished.length > 0
        && (todoView === 'both' || todoView === 'auto')

      const label = typeof t === 'function' ? t : key => (copy.zh[key] ?? key)
      const head = []
      head.push(h('span', { key: 't', style: style.title }, '📊 ' + label('title')))
      head.push(h('span', { key: 'n', style: style.turnBadge }, fmt(label('turn'), { n: entry.n })))

      if (showsWholePlan) {
        const chips = []
        if (todo.done > 0) chips.push(h('span', { key: 'd' }, '✅ ' + todo.done))
        if (todo.doing > 0) chips.push(h('span', { key: 'g' }, '⏳ ' + todo.doing))
        if (todo.left > 0) chips.push(h('span', { key: 'l' }, '⬜ ' + todo.left))
        if (chips.length > 0) head.push(h('span', { key: 'c', style: style.chips }, chips))
      }

      // One line of execution facts: which model answered, how many times it was
      // asked, and what it cost. The built-in usage panel shows a turn total but
      // never the call count, and this line stays readable without opening anything.
      const llm = entry.llm
      let llmLine = null
      if (opts.showLlm !== false && llm !== null && llm !== undefined && (llm.calls ?? 0) > 0) {
        const parts = []
        const routes = Array.isArray(llm.models) && llm.models.length > 0 ? llm.models : []
        if (routes.length > 0) {
          parts.push(h('span', {
            key: 'm',
            style: style.llmModel,
            title: routes.join(', '),
          }, routes.map(route => String(route).split('/').pop()).join(' + ')))
        }
        parts.push(h('span', { key: 'c' }, fmt(label('llmCalls'), { n: llm.calls })))
        const usage = llm.usage ?? {}
        if ((usage.total ?? 0) > 0) {
          parts.push(h('span', { key: 't', title: tokenDetail(usage, label) }, tokenSummary(usage, label)))
        }
        llmLine = h('div', { key: 'llm', style: style.llmLine }, '⚙️ ', parts)
      }

      const rows = [
        [label('tools'), String(entry.tools ?? 0)],
      ]
      // A failure count of zero is good news and needs no row; showing "失败 0" on
      // every clean turn just makes the table longer without saying anything.
      if ((entry.failed ?? 0) > 0) rows.push([label('failed'), String(entry.failed)])
      if (opts.showFiles !== false) rows.push([label('files'), String((entry.files ?? []).length)])
      rows.push([label('ended'), String(entry.end ?? 'completed')])

      const table = h('table', { style: style.table, key: 'table' }, [
        h('thead', { key: 'h' }, h('tr', null, [
          h('th', { key: 'a', style: style.th }, label('metric')),
          h('th', { key: 'b', style: style.th }, label('value')),
        ])),
        h('tbody', { key: 'b' }, rows.map((row, index) => h('tr', { key: String(index) },
          h('td', { style: style.td }, row[0]),
          h('td', { style: style.td }, row[1])))),
      ])

      const blocks = []
      if (llmLine !== null) blocks.push(llmLine)
      blocks.push(table)

      if (opts.showFiles !== false && Array.isArray(entry.files) && entry.files.length > 0) {
        blocks.push(h('div', { key: 'files', style: style.files },
          h('span', { key: 'l' }, '📄 ' + label('filesLabel')),
          entry.files.map((file, index) => h('code', { key: String(index), style: style.file, title: file }, file))))
      }

      // The card reports what this turn FINISHED, never the current list.
      // The built-in input-dock panel already renders the live list and its
      // counts, so repeating it here would be pure duplication; "newly finished"
      // is the one todo fact that panel does not have.
      if (showFinished) {
        blocks.push(h('div', { key: 'finished', style: style.pendingBox },
          h('div', { key: 'h', style: style.sectionTitle },
            h('span', null, '📝 ' + label('finished')),
            h('span', { style: style.turnBadge }, fmt(label('finishedCount'), {
              n: finished.length + (todo.finishedMore ?? 0),
            }))),
          finished.map((row, index) => h('div', { key: String(index), style: style.pendingRow, 'data-finished': '1' },
            h('span', { key: 'i', style: style.pendingIcon }, '✅'),
            h('span', { key: 'c', style: style.pendingText }, row.c))),
          (todo.finishedMore ?? 0) > 0
            ? h('div', { key: 'm', style: style.more }, '… ' + fmt(label('more'), { n: todo.finishedMore }))
            : null))
      }

      // The plan HUD: progress strip and the plan by section, each section foldable.
      // `entry.plan` is this turn's own list when it wrote one; otherwise the newest
      // list still in force, flagged `stale` so the HUD can say "this turn did not
      // update the plan" instead of silently repeating identical blocks.
      const plan = entry.plan ?? null
      if (opts.showStatusBar !== false && plan !== null && plan.total > 0) {
        blocks.push(planHud(plan, label, overrides, toggleSection))
      }

      if (showsWholePlan) {
        const lines = treeLines(todo.rows)
        const tree = [
          h('div', { key: 'h', style: style.sectionTitle },
            h('span', null, '📦 ' + label('tree')),
            h('span', { style: style.turnBadge }, fmt(label('treeSummary'), { done: todo.done, total: todo.total }))),
          h('div', { key: 'p', style: style.pre }, lines.map((line, index) => h('div', {
            key: String(index),
            style: style.treeRow,
            'data-depth': String(line.d),
          },
          line.rail.map((segment, level) => h('span', { key: 'r' + level, style: style.rail }, segment)),
          h('span', { style: style.branch }, line.branch),
          h('span', { style: style.treeText }, line.icon + ' ' + line.c)))),
        ]
        if (todo.more > 0) tree.push(h('div', { key: 'm', style: style.more }, '… ' + fmt(label('more'), { n: todo.more })))
        blocks.push(h('div', { key: 'tree' }, tree))
      }

      if (todo === null && blocks.length === 1) {
        blocks.push(h('div', { key: 'empty', style: style.more }, label('empty')))
      }

      return h('section', {
        style: style.card,
        'data-turn-report': String(entry.n),
        'aria-label': label('title') + ' ' + fmt(label('turn'), { n: entry.n }),
      }, head, blocks)
    }

    /**
     * Game-style status bar under the composer: a plan progress strip that stays
     * put across turns, with one collapsible section per first-level task group.
     *
     * It shows a focused slice (what just finished, what is next), not the whole
     * list — the built-in panel above the composer already owns the full list.
     /**
     * Game-HUD plan strip rendered INSIDE the turn-end card.
     *
     * It sits with the card rather than pinned near the composer: the plan belongs
     * to the turn that just ended, and the conversation column is where a reader
     * looks for "what did that turn do". A plain function, not a component, so it
     * adds no hooks of its own — the card owns the fold state.
     * @param {object} plan - this turn's frozen plan snapshot.
     * @param {function} label - locale lookup.
     * @param {Map<number, boolean>} overrides - reader-opened/closed sections.
     * @param {function} toggle - record one section's explicit fold state.
     * @returns {object} the block.
     */
    function planHud(plan, label, overrides, toggle) {
      const pct = plan.total > 0 ? Math.round((plan.done / plan.total) * 100) : 0
      const allDone = plan.left === 0 && plan.doing === 0
      const bar = h('div', { key: 'bar', style: style.hudBar },
        h('span', {
          key: 'p',
          // A 0% rail is just an empty grey strip, which reads as "broken" rather
          // than "nothing done yet"; a dashed outline says 0% on purpose.
          style: pct === 0
            ? { ...style.hudProgress, border: '1px dashed var(--dsw-alias-border-l3, #c9ccd1)' }
            : style.hudProgress,
        },
          h('span', {
            style: {
              ...style.hudProgressFill,
              width: pct + '%',
              background: allDone
                ? 'var(--dsw-alias-state-success-primary, #2f9e5e)'
                : 'var(--dsw-alias-state-business-primary, #3f6fd8)',
            },
          })),
        h('span', { key: 'n', style: style.hudCount }, plan.done + '/' + plan.total),
        // The three counters are a fixed HUD readout: a game bar does not hide the
        // "0" slots, and a missing group read as "the plugin lost my todo". They are
        // always present; a zero is dimmed rather than dropped.
        h('span', { key: 'd', style: plan.done > 0 ? style.hudChip : style.hudChipZero }, '✅ ' + plan.done),
        h('span', { key: 'g', style: plan.doing > 0 ? style.hudChip : style.hudChipZero }, '⏳ ' + plan.doing),
        h('span', { key: 'l', style: plan.left > 0 ? style.hudChip : style.hudChipZero }, '⬜ ' + plan.left),
        allDone ? h('span', { key: 'a', style: style.hudAllDone }, '✨ ' + label('sbAllDone')) : null)

      const parts = [bar]
      // No separate "next up" line: the in-progress section below already lists
      // that exact item, and repeating it three lines above said it twice. The next
      // item is only worth its own row when no in-progress section will show it —
      // i.e. when everything left is still just pending.
      const hasRunningSection = plan.groups.some(group => group.k === 'doing' && group.total > 0)
      if (!allDone && !hasRunningSection && plan.nextUp.length > 0) {
        parts.push(h('div', {
          key: 'next',
          style: style.hudNextRow,
          title: plan.nextUp.map(row => row.c).join('\n'),
        }, '⏭ ' + label('sbNext') + '：' + plan.nextUp[0].c))
      }

      const sections = plan.groups.map((group, index) => {

        // Finished work starts folded — it is already listed as "本轮完成" above.
        // Exception: when it is the ONLY non-empty section, folding it leaves the
        // card looking empty, so open it. Pending and in-progress always open.
        const populated = plan.groups.filter(candidate => candidate.empty !== true)
        const onlyGroup = populated.length === 1 && populated[0] === group
        const defaultOpen = group.startOpen !== false || onlyGroup
        const isOpen = group.empty === true
          ? false
          : overrides.has(index) ? overrides.get(index) : defaultOpen

        // An empty slot stays visible but goes flat: no chevron, no button, no
        // click target. It reports "0 here", not "you can open this".
        if (group.empty === true) {
          return h('div', {
            key: 'g' + index,
            style: style.sbGroupEmpty,
            'data-group': group.k,
            'data-empty': '1',
          },
          h('span', { key: 'i' }, (STATUS[group.s] ?? STATUS.left).icon),
          h('span', { key: 't', style: style.sbGroupLabelEmpty }, group.t),
          h('span', { key: 'n', style: style.sbGroupCount }, '0'))
        }

        return h('div', { key: 'g' + index, 'data-group': group.k },
          h('button', {
            type: 'button',
            style: isOpen ? style.sbGroupTitleOpen : style.sbGroupTitle,
            'aria-expanded': isOpen ? 'true' : 'false',
            'data-toggle': group.k,
            onClick: () => { toggle(index, !isOpen) },
          },
          h('span', { key: 'c', style: style.sbChevron }, isOpen ? '▼' : '▶'),
          h('span', { key: 'i' }, (STATUS[group.s] ?? STATUS.left).icon),
          h('span', { key: 't', style: style.sbGroupLabel }, group.t),
          h('span', { key: 'n', style: style.sbGroupCount }, group.total)),
          isOpen
            ? group.children.map((row, childIndex) => h('div', {
              key: String(childIndex),
              style: { ...style.sbRow, paddingLeft: 24 + (row.d ?? 0) * 12 },
              'data-child': group.k,
            },
            (STATUS[row.s] ?? STATUS.left).icon + ' ' + row.c))
            : null)
      })

      parts.push(h('div', { key: 'groups', style: style.sbSection },
        h('div', { key: 'h', style: style.sbSectionTitle },
          '📋 ' + label('sbPlan'),
          plan.stale === true
            ? h('span', { key: 's', style: style.sbStale, title: label('sbStaleHint') }, label('sbStale'))
            : null),
        sections))
      if (plan.more > 0) parts.push(h('div', { key: 'more', style: style.more }, '… ' + fmt(label('more'), { n: plan.more })))

      return h('div', {
        key: 'plan',
        style: plan.stale === true ? { ...style.hud, opacity: 0.82 } : style.hud,
        'data-stale': plan.stale === true ? '1' : undefined,
      }, parts)
    }

    /**
     * Register the card and its dictionaries.
     * @param {object} ctx - client context.
     * @returns {void}
     */
    function apply(ctx) {
      if (ctx.locale !== undefined) {
        ctx.effect(() => ctx.locale.register(NS, { zh: copy.zh, en: copy.en }), 'turn-report: dictionaries')
      }
      ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        id: 'dsh-turn-report',
        order: -10,
        locale: NS,
      }, TurnReport))
    }

    return { inject: ['slots', 'locale'], apply, TurnReport, planHud, treeLines }
  },
})

