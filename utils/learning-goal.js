/**
 * 学生自己定的学习目标（2026-10-07 用户需求）：「学习宇宙 › 我的学习目标」页面与宇宙页卡片用的纯函数。
 *
 * 目标 = 目标方向（单选，可不选）+ 具体目标（自己写，最多 200 字）+ 希望完成时间（可不填）。
 * 诊断会议的 AI 老师定制课程前和学习偏好一起先看它（课程服务 OpenMAIC-sync lib/course/learning-goal.ts）。
 * 方向目录以接口下发的为准；读不到时用下面的内置一份兜底（学生自己编辑的东西，读不到也要能填）。
 */

const FALLBACK_GOAL_CATALOG = {
  goalLimit: 200,
  goalPlaceholder: '比如：期末数学考到 90 分以上，函数这部分不再丢分。',
  maxDays: 3 * 366,
  directions: [
    { id: 'exam', label: '提高考试成绩' },
    { id: 'weak', label: '补上薄弱知识点' },
    { id: 'preview', label: '提前预习新课' },
    { id: 'review', label: '复习巩固学过的' },
    { id: 'interest', label: '培养学习兴趣' },
    { id: 'contest', label: '准备竞赛或升学' }
  ]
}

const DAY = 86400000

/** 北京时间的今天，YYYY-MM-DD（课程服务按北京时间校验完成时间）。 */
function beijingToday(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10)
}

function addDays(day, count) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY).toISOString().slice(0, 10)
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

function cleanGoalCatalog(catalog) {
  const directions = Array.isArray(catalog && catalog.directions)
    ? catalog.directions.filter((item) => item && item.id).map((item) => ({ id: String(item.id), label: String(item.label || '') }))
    : []
  if (!directions.length) return cleanGoalCatalog(FALLBACK_GOAL_CATALOG)
  return {
    goalLimit: Number(catalog.goalLimit) || 200,
    goalPlaceholder: String(catalog.goalPlaceholder || ''),
    maxDays: Number(catalog.maxDays) || 3 * 366,
    directions
  }
}

/** 接口回包（/api/learn/learning-goal，或偏好接口里的 goal）→ 页面用的样子；读取失败传 null。 */
function normalizeGoalView(data) {
  const catalog = cleanGoalCatalog(data && data.catalog)
  const saved = (data && data.goal) || null
  const direction = saved && catalog.directions.some((item) => item.id === saved.direction) ? String(saved.direction) : ''
  return {
    catalog,
    today: isDay(data && data.today) ? data.today : beijingToday(),
    status: data && data.status === 'set' ? 'set' : 'empty',
    direction,
    goal: String((saved && saved.goal) || ''),
    deadline: isDay(saved && saved.deadline) ? saved.deadline : '',
    summary: String((data && data.summary) || '')
  }
}

function directionLabel(catalog, direction) {
  const hit = (catalog.directions || []).find((item) => item.id === direction)
  return hit ? hit.label : ''
}

/** WXML 不能调方法：选中状态写成布尔值。单选，再点取消。 */
function decorateDirections(catalog, direction) {
  return (catalog.directions || []).map((item) => Object.assign({}, item, { selected: item.id === direction }))
}

function toggleDirection(current, tapped) {
  return current === tapped ? '' : tapped
}

/** 「还有 N 天」「就是今天」「已经过了」 */
function deadlineText(deadline, today) {
  if (!isDay(deadline)) return ''
  const left = daysBetween(today, deadline)
  if (left > 0) return `还有 ${left} 天`
  if (left === 0) return '就是今天'
  return '已经过了'
}

/** 「老师会看到」预览：方向、具体目标、完成时间各一行。 */
function goalPreviewLines(catalog, input, today) {
  const lines = []
  const label = directionLabel(catalog, input.direction)
  if (label) lines.push({ id: 'direction', title: '目标方向', text: label })
  const goal = String(input.goal || '').trim()
  if (goal) lines.push({ id: 'goal', title: '具体目标', text: goal })
  if ((label || goal) && isDay(input.deadline)) lines.push({ id: 'deadline', title: '希望完成时间', text: `${input.deadline}（${deadlineText(input.deadline, today)}）` })
  return lines
}

/** 宇宙页卡片上的一行：具体目标优先，没写就用方向。剩几天另用 goalDeadlineTag 放在标题旁（摘要长了会被截掉）。 */
function goalSummaryText(view) {
  if (!view || view.status !== 'set') return ''
  return String(view.goal || '').replace(/\s+/g, ' ').trim() || directionLabel(view.catalog, view.direction)
}

/** 标题旁的小标签：「还有 N 天」「就是今天」「已过期」；没定完成时间为空串。 */
function goalDeadlineTag(view) {
  if (!goalSummaryText(view)) return ''
  const left = deadlineText(view.deadline, view.today)
  return left === '已经过了' ? '已过期' : left
}

/** 完成时间选择器的可选范围：今天到最远那天。 */
function deadlineRange(today, maxDays) {
  return { start: today, end: addDays(today, maxDays) }
}

module.exports = {
  FALLBACK_GOAL_CATALOG,
  beijingToday,
  normalizeGoalView,
  decorateDirections,
  toggleDirection,
  deadlineText,
  goalPreviewLines,
  goalSummaryText,
  goalDeadlineTag,
  deadlineRange
}
