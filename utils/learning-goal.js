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

/**
 * 「把目标写具体」引导（2026-11-11 用户规则：闯关第一关设置目标，要引导学生写具体再设置）。
 * 按三件事逐条打勾：哪一科 / 哪块内容、想达到什么程度、什么时候（选了完成时间也算）。
 * 只是提示，不拦保存；保存时少于两条会先问一句「再写具体一点？」。
 */
const SPECIFIC_CHECKS = [
  { id: 'what', label: '哪一科、哪块内容', hint: '比如「数学的函数」「英语阅读」' },
  { id: 'level', label: '想达到什么程度', hint: '比如「考到 90 分」「这类题不再错」' },
  { id: 'when', label: '什么时候完成', hint: '比如「期末前」，或在下面选完成时间' }
]
const WHAT_RE = /语文|数学|英语|物理|化学|生物|历史|地理|政治|道法|道德|科学|奥数|函数|方程|几何|计算|应用题|分数|小数|阅读|作文|写作|古诗|文言|单词|语法|听力|口语|实验|电路|力学|知识点|单元|章节|错题|题型/
const LEVEL_RE = /\d|[一二三四五六七八九十百]+\s*分|及格|优秀|满分|名次|前\s*[一二三四五六七八九十]+\s*名|全对|不再错|不丢分|不扣分|正确率|会做|能做|做对|背会|背熟|掌握|弄懂|讲清楚|提高|提升/
const WHEN_RE = /期末|期中|月考|中考|高考|小升初|开学|寒假|暑假|学期|月底|年底|周|星期|天内|个月|\d+\s*月|\d+\s*号|之前|以前|前完成/

function goalSpecificity(goal, deadline) {
  const text = String(goal || '').trim()
  const ok = {
    what: WHAT_RE.test(text),
    level: LEVEL_RE.test(text),
    when: !!deadline || WHEN_RE.test(text)
  }
  const checks = SPECIFIC_CHECKS.map((item) => ({ ...item, ok: !!text && ok[item.id] }))
  const passed = checks.filter((item) => item.ok).length
  return {
    checks,
    passed,
    // 写了但只占不到两条，或太短（「学好数学」）
    vague: !!text && (passed < 2 || Array.from(text).length < 8),
    tip: !text ? '照下面三条写，老师更好帮你规划' : passed === 3 ? '写得很具体，老师能照这个帮你规划' : `还差：${checks.filter((item) => !item.ok).map((item) => item.label).join('、')}`
  }
}

module.exports = {
  FALLBACK_GOAL_CATALOG,
  goalSpecificity,
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
