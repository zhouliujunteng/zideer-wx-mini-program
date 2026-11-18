// 家长学生看板「学习情况 → 定制课程」（2026-11-14 用户要求）：孩子的定制课程学到哪一节、每节课三关的进度。
// 数据来自课程服务 /api/learn/guardian-courses（按孩子学习页的闯关路径算，家长和孩子看到的一致）。
// 读取状态 state = { loaded, failed, goals }；读到前画骨架，读不到给重试，读到了才可能显示「还没有定制课程」。
const FOLD_COUNT = 5

const STEP_TONE = { done: 'done', open: 'open', locked: 'locked' }

function lessonView(lesson) {
  const statusText = lesson.done ? '已学完' : lesson.paywall ? '开会员解锁' : lesson.locked ? '未解锁' : lesson.current ? '正在学' : '待学习'
  return {
    id: lesson.stageId,
    title: lesson.title || '定制课程',
    stage: lesson.stage || '',
    statusText,
    statusTone: lesson.done ? 'done' : lesson.current ? 'current' : 'muted',
    steps: (lesson.steps || []).map((step) => ({
      key: step.key,
      label: step.label,
      detail: step.detail,
      tone: STEP_TONE[step.state] || 'locked'
    }))
  }
}

// 列表默认只放从「正在学」的前一节起的几节，其余收起（课多的孩子不至于一屏全是课）
function foldedItems(items, expanded) {
  if (expanded || items.length <= FOLD_COUNT) return { items, hidden: 0 }
  const currentIndex = items.findIndex((item) => item.statusText === '正在学')
  const firstOpen = items.findIndex((item) => item.statusText !== '已学完')
  const anchor = currentIndex >= 0 ? currentIndex : firstOpen >= 0 ? firstOpen : items.length - FOLD_COUNT
  const start = Math.max(0, Math.min(anchor - 1, items.length - FOLD_COUNT))
  return { items: items.slice(start, start + FOLD_COUNT), hidden: items.length - FOLD_COUNT }
}

function goalView(goal, index, expandedKeys, multiple) {
  const key = `g${index}`
  const all = (goal.items || []).map(lessonView)
  const folded = foldedItems(all, !!(expandedKeys && expandedKeys[key]))
  const progress = `已学完 ${goal.done || 0}/${goal.lessons || 0} 节`
  const current = goal.current ? `正在学：${goal.current.title}${goal.current.step ? ` · ${goal.current.step}` : ''}` : (goal.lessons && goal.done >= goal.lessons ? '全部学完了' : '')
  return {
    key,
    title: multiple ? `${goal.active ? '当前目标' : '学习目标'}：${goal.title || '定制课程'}` : (goal.title || '定制课程'),
    progress,
    current,
    percent: goal.lessons ? Math.round((Math.min(goal.done || 0, goal.lessons) / goal.lessons) * 100) : 0,
    items: folded.items,
    hidden: folded.hidden
  }
}

function guardianCourseSection(state, expandedKeys) {
  if (!state || !state.loaded) return { skeleton: !(state && state.failed), failed: !!(state && state.failed), goals: [] }
  const goals = (state.goals || []).filter((goal) => goal && goal.lessons > 0)
  return { skeleton: false, failed: false, goals: goals.map((goal, index) => goalView(goal, index, expandedKeys, goals.length > 1)) }
}

module.exports = { guardianCourseSection, FOLD_COUNT }
