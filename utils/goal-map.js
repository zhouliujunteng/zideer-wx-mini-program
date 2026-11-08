// 按目标测评的「目标导图」（2026-10-10 用户规则）：目标 → 大条件 → 知识点 → 前置知识点，从左往右长开。
// 只做纯计算：节点卡片的位置、尺寸、连线；页面用普通 view 绝对定位画出来（movable-view 拖动、双指缩放），
// 文字是原生渲染，点卡片就是普通 bindtap。网页端（课程服务 components/portal/GoalMindMap.tsx）同一套排版规则。

const STATUS = {
  goal: { text: '学习目标', tone: 'goal' },
  pending: { text: '待测', tone: 'pending' },
  testing: { text: '正在测', tone: 'testing' },
  mastered: { text: '已掌握', tone: 'mastered' },
  shaky: { text: '需巩固', tone: 'shaky' },
  gap: { text: '卡点', tone: 'gap' },
  root_gap: { text: '根源卡点', tone: 'root' },
  untested: { text: '暂未测', tone: 'untested' }
}

// 卡片宽度按层级固定；字号与行高要和 wxss 里 .gm-card-* 一致
const CARD = {
  goal: { width: 150, font: 15, line: 21, maxLines: 3 },
  condition: { width: 138, font: 13, line: 19, maxLines: 3 },
  topic: { width: 128, font: 12.5, line: 18, maxLines: 3 }
}
const PAD_X = 12
const PAD_Y = 10
const META = 18
const COL_GAP = 34
const ROW_GAP = 10
const MARGIN = 16

function charWidth(ch, font) {
  return /[\u0000-ÿ]/.test(ch) ? font * 0.56 : font
}

// 估算折行：按字宽累加；超过 maxLines 的截断加省略号（和 wxss 的 -webkit-line-clamp 一致）
function wrapText(text, width, font, maxLines) {
  const lines = []
  let line = ''
  let used = 0
  for (const ch of Array.from(String(text || ''))) {
    const w = charWidth(ch, font)
    if (used + w > width && line) {
      lines.push(line)
      line = ''
      used = 0
    }
    line += ch
    used += w
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.$/, '…')
    return kept
  }
  return lines.length ? lines : ['']
}

function statusOf(node) {
  if (node.kind === 'goal') return STATUS.goal
  // 大条件下面有的测了、有的还没测：说「测了一部分」，暂停时也不会显示成「正在测」
  if (node.kind === 'condition' && node.status === 'testing') return { text: '测了一部分', tone: 'testing' }
  return STATUS[node.status] || STATUS.pending
}

// 一条 S 形曲线拆成两段：down（往下）用 dr1 + dr2，up（往上）用 ur1 + ur2，见 wxss
function curveSegments(id, x1, y1, x2, y2, hot) {
  const r = (n) => Math.round(n * 10) / 10
  if (Math.abs(y2 - y1) < 1) return [{ id, type: 'h', x: r(x1), y: r(y1), width: r(x2 - x1), height: 0, hot }]
  const mx = (x1 + x2) / 2
  const half = Math.abs(y2 - y1) / 2
  const mid = (y1 + y2) / 2
  if (y2 > y1) {
    return [
      { id: `${id}-a`, type: 'dr1', x: r(x1), y: r(y1), width: r(mx - x1), height: r(half), hot },
      { id: `${id}-b`, type: 'dr2', x: r(mx), y: r(mid), width: r(x2 - mx), height: r(half), hot }
    ]
  }
  return [
    { id: `${id}-a`, type: 'ur1', x: r(x1), y: r(mid), width: r(mx - x1), height: r(half), hot },
    { id: `${id}-b`, type: 'ur2', x: r(mx), y: r(y2), width: r(x2 - mx), height: r(half), hot }
  ]
}

/**
 * nodes：课程服务 mapView 的节点（先序，带 parentId）。
 * 返回 { cards, lines, width, height }，坐标是逻辑 px。
 */
function layoutGoalMap(nodes) {
  const list = Array.isArray(nodes) ? nodes : []
  const byId = {}
  const children = {}
  list.forEach((node) => {
    byId[node.id] = node
    children[node.id] = []
  })
  list.forEach((node) => {
    if (node.parentId && children[node.parentId]) children[node.parentId].push(node.id)
  })
  const root = list.find((node) => !node.parentId)
  if (!root) return { cards: [], lines: [], width: 0, height: 0 }

  const kindOf = (node) => CARD[node.kind] ? node.kind : 'topic'
  const size = {}
  list.forEach((node) => {
    const spec = CARD[kindOf(node)]
    const lines = wrapText(node.label, spec.width - PAD_X * 2, spec.font, spec.maxLines)
    size[node.id] = { width: spec.width, height: PAD_Y * 2 + lines.length * spec.line + META, lines }
  })

  // 每一层一列：列宽取这一层最宽的卡片
  const columnWidth = []
  list.forEach((node) => {
    const level = Math.max(0, Number(node.level) || 0)
    columnWidth[level] = Math.max(columnWidth[level] || 0, size[node.id].width)
  })
  const columnX = []
  let x = MARGIN
  for (let level = 0; level < columnWidth.length; level++) {
    columnX[level] = x
    x += (columnWidth[level] || CARD.topic.width) + COL_GAP
  }

  // 第一遍量子树高度，第二遍摆位置：父卡片竖直居中于子树
  const subtree = {}
  const measure = (id) => {
    const kids = children[id]
    const own = size[id].height
    if (!kids.length) return (subtree[id] = own)
    const total = kids.reduce((sum, kid) => sum + measure(kid), 0) + ROW_GAP * (kids.length - 1)
    return (subtree[id] = Math.max(own, total))
  }
  measure(root.id)

  const pos = {}
  const place = (id, top) => {
    const node = byId[id]
    const level = Math.max(0, Number(node.level) || 0)
    const kids = children[id]
    const span = subtree[id]
    pos[id] = { x: columnX[level], y: top + (span - size[id].height) / 2 }
    if (!kids.length) return
    const total = kids.reduce((sum, kid) => sum + subtree[kid], 0) + ROW_GAP * (kids.length - 1)
    let cursor = top + (span - total) / 2
    kids.forEach((kid) => {
      place(kid, cursor)
      cursor += subtree[kid] + ROW_GAP
    })
  }
  place(root.id, MARGIN)

  const cards = list.map((node) => {
    const status = statusOf(node)
    return {
      id: node.id,
      kind: kindOf(node),
      x: Math.round(pos[node.id].x),
      y: Math.round(pos[node.id].y),
      width: size[node.id].width,
      height: Math.round(size[node.id].height),
      text: size[node.id].lines.join('\n'),
      label: node.label,
      tone: status.tone,
      statusText: node.alias ? `${status.text} · 同上` : status.text,
      gradeLabel: node.gradeLabel || '',
      note: node.note || '',
      alias: Boolean(node.alias),
      current: Boolean(node.current),
      // 挂在这个知识点下面的定制课程（课程服务按老师建课时标的编号等匹配）
      courses: Array.isArray(node.courses) ? node.courses : [],
      courseCount: Array.isArray(node.courses) ? node.courses.length : 0
    }
  })

  // 曲线连线（2026-10-10 用户要求）：父卡片右边中点 → 子卡片左边中点，两段四分之一椭圆拼成 S 形，
  // 每段是一个只画两条边、角上 100% 圆角的 view（wxss .gm-arc-*）。上下差不到 1px 就画直线。
  const lines = []
  list.forEach((node) => {
    const kids = children[node.id]
    if (!kids.length) return
    const p = pos[node.id]
    const x1 = p.x + size[node.id].width
    const y1 = p.y + size[node.id].height / 2
    kids.forEach((kid) => {
      const x2 = pos[kid].x
      const y2 = pos[kid].y + size[kid].height / 2
      const tone = statusOf(byId[kid]).tone
      const hot = tone === 'gap' || tone === 'root'
      lines.push(...curveSegments(`${node.id}-${kid}`, x1, y1, x2, y2, hot))
    })
  })
  const width = Math.max(...cards.map((card) => card.x + card.width)) + MARGIN
  const height = Math.max(...cards.map((card) => card.y + card.height)) + MARGIN
  return { cards, lines, width, height }
}

/** 一开始的缩放：整张图放得下就原样，宽了就缩到放下（不小于 0.55，再小字看不清，靠拖动看）。 */
function initialScale(mapWidth, mapHeight, boxWidth, boxHeight) {
  if (!mapWidth || !boxWidth) return 1
  const fit = Math.min(boxWidth / mapWidth, boxHeight / mapHeight, 1)
  return Math.max(0.55, Math.round(fit * 100) / 100)
}

/** 答题时顶部那一行：已经探明几个大条件、每个条件现在是什么颜色。学生看不到题量。 */
function progressView(map) {
  const nodes = (map && map.nodes) || []
  const conditions = nodes.filter((node) => node.kind === 'condition')
  // 「探明」以课程服务算的为准：发现了卡点、但下面还在往前挖的条件不算探明
  const summary = (map && map.summary) || {}
  const settled = Number.isFinite(summary.conditionsSettled)
    ? summary.conditionsSettled
    : conditions.filter((node) => ['mastered', 'shaky', 'untested'].indexOf(node.status) >= 0).length
  return {
    total: conditions.length,
    settled,
    dots: conditions.map((node) => ({ id: node.id, tone: statusOf(node).tone, label: node.label }))
  }
}

/** 结果卡片：已掌握 / 卡点 / 根源卡点 + 建议学习顺序。 */
// 一个知识点在导图里可能出现几次（「同上」），挂的课合起来去重；学生只看能学的课
function coursesOfTopic(nodes, topicId, includeMaking) {
  const seen = {}
  const out = []
  nodes.forEach((node) => {
    if (Number(node.topicId) !== Number(topicId) || !Array.isArray(node.courses)) return
    node.courses.forEach((course) => {
      if (seen[course.stageId] || (!includeMaking && course.state !== 'ready')) return
      seen[course.stageId] = true
      out.push({ stageId: course.stageId, title: course.title, state: course.state, stateText: course.state === 'making' ? '制作中' : course.state === 'failed' ? '没做成' : '' })
    })
  })
  return out
}

function summaryView(diagnosis, options = {}) {
  const map = diagnosis && diagnosis.map
  const summary = (map && map.summary) || {}
  const path = Array.isArray(summary.path) ? summary.path : []
  const nodes = (map && map.nodes) || []
  const includeMaking = Boolean(options.teacher)
  return {
    mastered: Number(summary.mastered) || 0,
    gaps: Number(summary.gaps) || 0,
    roots: (summary.rootGaps || []).map((item) => ({ id: String(item.topicId), label: item.label, gradeLabel: item.gradeLabel || '' })),
    path: path.map((item, index) => ({
      id: String(item.topicId), step: index + 1, label: item.label, gradeLabel: item.gradeLabel || '', root: Boolean(item.root),
      courses: coursesOfTopic(nodes, item.topicId, includeMaking)
    })),
    conditions: Number(summary.conditions) || 0,
    settled: Number(summary.conditionsSettled) || 0,
    scopeText: scopeText(summary.scope),
    // 暂时测不了的知识点（题库没有题、出题也没过复核）：如实告诉学生，老师会在诊断会议里当面问（2026-10-11）
    untestedText: Array.isArray(summary.untested) && summary.untested.length
      ? `${summary.untested.length} 个知识点暂时没有合适的题（${summary.untested.slice(0, 3).map((item) => item.label).join('、')}${summary.untested.length > 3 ? ' 等' : ''}），老师会在诊断会议里当面问你`
      : ''
  }
}

// 考试类目标（期末、期中、考到多少分）：这轮测评覆盖了本学期几个单元（2026-10-11，课程服务 summary.scope）
function scopeText(scope) {
  if (!scope || !Number(scope.units)) return ''
  const missing = Array.isArray(scope.missing) ? scope.missing : []
  const head = `考试范围：${scope.label || '本学期'}共 ${scope.units} 个单元，`
  return missing.length
    ? `${head}测到 ${scope.covered} 个（还没测：${missing.join('、')}）`
    : `${head}每个单元都测到了`
}

const STATE_TEXT = {
  planning: '正在拆解目标',
  active: '测评进行中',
  paused: '测了一部分',
  finished: '已测完',
  failed: '目标没拆好'
}

function stateText(diagnosis) {
  if (!diagnosis) return ''
  if (diagnosis.status === 'paused' && diagnosis.pauseReason === 'round_cap') return '这一轮测完了'
  return STATE_TEXT[diagnosis.status] || ''
}

/** 宇宙页「老师备课先看」里「目标导图」一行：overview = 课程服务 GET /api/learn/goal-diagnosis 回包。 */
function entrySummary(overview) {
  const goal = overview && overview.goal
  const diagnosis = overview && overview.diagnosis
  if (!goal) return { text: '先定学习目标，再围绕目标测一轮', empty: true, action: '' }
  if (!diagnosis || overview.goalChanged) return { text: '围绕目标测一轮，找出卡在哪里', empty: true, action: '去测评' }
  if (diagnosis.status === 'failed') return { text: '目标没拆好，点开再试一次', empty: true, action: '' }
  if (diagnosis.status !== 'finished') return { text: '测了一部分，点开接着测', empty: false, action: '继续' }
  const roots = (diagnosis.map && diagnosis.map.summary && diagnosis.map.summary.rootGaps) || []
  if (!roots.length) return { text: '已测完，没有发现卡点', empty: false, action: '' }
  return { text: `找到 ${roots.length} 个根源卡点：${roots.map((item) => item.label).join('、')}`, empty: false, action: '' }
}

module.exports = {
  entrySummary,
  STATUS,
  wrapText,
  layoutGoalMap,
  initialScale,
  progressView,
  summaryView,
  stateText
}
