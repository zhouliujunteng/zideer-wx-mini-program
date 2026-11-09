// 学习安排的展示规则（课程服务 lib/course/study-plan.ts 的前端这一半）。
// 老师「学习安排」页、学生详情「学习课程」的筛选、学生「学习 › 学习任务」共用这一份。
// 日期一律是课程服务给的北京时间日历日 YYYY-MM-DD，相对「今天」也以课程服务返回的 today 为准。

// 每天学习时长只有这 6 档（2026-09-27 用户规则）：15 分钟打底，其余依次递增。
const MINUTE_OPTIONS = [
  { minutes: 15, label: '15 分钟', note: '打底' },
  { minutes: 30, label: '30 分钟', note: '' },
  { minutes: 45, label: '45 分钟', note: '' },
  { minutes: 60, label: '1 小时', note: '' },
  { minutes: 90, label: '1.5 小时', note: '' },
  { minutes: 120, label: '2 小时', note: '' }
]
const LEVEL_LABELS = { 1: '基础', 2: '提高', 3: '拓展' }
// 每周学习日（2026-10-09 用户规则）：1 = 周一 … 7 = 周日，和课程服务一致；默认 7 天都学。
const WEEKDAY_OPTIONS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' }
]
const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function dayTime(day) {
  return DAY_PATTERN.test(String(day || '')) ? Date.parse(`${day}T00:00:00Z`) : NaN
}

function addDays(day, count) {
  const time = dayTime(day)
  if (!Number.isFinite(time)) return ''
  return new Date(time + count * 86400000).toISOString().slice(0, 10)
}

function dayDiff(from, to) {
  const start = dayTime(from)
  const end = dayTime(to)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86400000) : NaN
}

function monthDay(day) {
  const time = dayTime(day)
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

function weekday(day) {
  const time = dayTime(day)
  return Number.isFinite(time) ? WEEKDAYS[new Date(time).getUTCDay()] : ''
}

// 今天 / 明天 / 后天，其余是「10月8日」。
function dayLabel(day, today) {
  const offset = dayDiff(today, day)
  if (offset === 0) return '今天'
  if (offset === 1) return '明天'
  if (offset === 2) return '后天'
  return monthDay(day)
}

// 日期卡标题：「今天 · 9月27日 周日」「10月8日 周四」。
function fullDayLabel(day, today) {
  const relative = dayLabel(day, today)
  const plain = `${monthDay(day)} ${weekday(day)}`
  return relative === monthDay(day) ? plain : `${relative} · ${plain}`
}

// 周一 = 1 … 周日 = 7
function weekdayNumber(day) {
  const time = dayTime(day)
  return Number.isFinite(time) ? (new Date(time).getUTCDay() || 7) : 0
}

function normalizeWeekdays(list) {
  const values = (Array.isArray(list) ? list : []).map(Number).filter((value) => value >= 1 && value <= 7)
  const unique = ALL_WEEKDAYS.filter((value) => values.includes(value))
  return unique.length ? unique : ALL_WEEKDAYS.slice()
}

// 「每天」「周一到周五」「周末」「周一、周三、周五」
function weekdaysText(list) {
  const days = normalizeWeekdays(list)
  if (days.length === 7) return '每天'
  if (days.join() === '1,2,3,4,5') return '周一到周五'
  if (days.join() === '6,7') return '周末'
  const contiguous = days.length >= 3 && days[days.length - 1] - days[0] === days.length - 1
  const name = (value) => `周${WEEKDAY_OPTIONS[value - 1].label}`
  return contiguous ? `${name(days[0])}到${name(days[days.length - 1])}` : days.map(name).join('、')
}

function isStudyDay(day, weekdays, restDays) {
  return normalizeWeekdays(weekdays).includes(weekdayNumber(day)) && !(restDays || []).includes(day)
}

function durationText(minutes) {
  const value = Math.round(Number(minutes) || 0)
  if (value < 60) return `${value} 分钟`
  if (value % 60 === 0) return `${value / 60} 小时`
  if (value % 30 === 0) return `${value / 60} 小时`
  return `${Math.floor(value / 60)} 小时 ${value % 60} 分钟`
}

function minuteOptionLabel(minutes) {
  const option = MINUTE_OPTIONS.find((item) => item.minutes === Number(minutes))
  return option ? option.label : durationText(minutes)
}

// 间隔复习（2026-10-08）：学完的课按遗忘规律到期复习，课程服务按复习卡现算，老师不能挪、不能删。
function decorateReviewTask(task, today) {
  const done = task.state === 'done'
  const [stateText, stateTone] = done ? ['已复习', 'passed'] : (task.overdue ? ['待补复习', 'warn'] : ['待复习', 'muted'])
  return {
    ...task,
    title: `复习：${task.title}`,
    meta: ['不看课程的回忆小测', task.minutes ? `约 ${task.minutes} 分钟` : '', task.subject || ''].filter(Boolean).join(' · '),
    stateText,
    stateTone,
    isReview: true,
    pickerDay: task.day < today ? today : task.day
  }
}

// 老师看的任务：状态胶囊 + 一行说明（第几页 · 约几分钟 · 难度 · 学科）。
function decorateTask(task, today) {
  if (task.kind === 'review') return decorateReviewTask(task, today)
  const states = {
    done: ['已完成', 'passed'],
    in_progress: [`学习中 ${task.completed}/${task.total}`, 'action'],
    not_started: ['未开始', 'muted'],
    unavailable: ['课程不可用', 'warn']
  }
  const [stateText, stateTone] = task.overdue && task.state !== 'done' ? ['补学', 'warn'] : (states[task.state] || states.not_started)
  const meta = [
    task.pageLabel,
    task.minutes ? `约 ${task.minutes} 分钟` : '',
    LEVEL_LABELS[task.level] || '',
    task.subject || '',
    task.overdue ? `原定${dayLabel(task.day, today)}` : ''
  ].filter(Boolean).join(' · ')
  return {
    ...task,
    meta: task.state === 'unavailable' ? '学生已看不到这门课，可以移除这条任务' : meta,
    stateText,
    stateTone,
    // 改日期：过期的补学任务默认挪到今天
    pickerDay: task.day < today ? today : task.day
  }
}

function decorateDay(day, today, dailyMinutes) {
  const minutes = Number(day.minutes) || 0
  return {
    day: day.day,
    title: fullDayLabel(day.day, today),
    isToday: day.day === today,
    minutesText: dailyMinutes ? `${minutes} / ${dailyMinutes} 分钟` : `${minutes} 分钟`,
    // 超出每天时长一成以上才提示（排课本身允许略超，避免把课拆得太碎）
    overBudget: Boolean(dailyMinutes) && minutes > dailyMinutes * 1.1,
    tasks: (day.tasks || []).map((task) => decorateTask(task, today))
  }
}

function planSummary(plan, today) {
  if (!plan) return '还没有安排每天的学习任务'
  const weekdays = normalizeWeekdays(plan.studyWeekdays)
  const parts = [weekdays.length === 7 ? `每天 ${minuteOptionLabel(plan.dailyMinutes)}` : `${weekdaysText(weekdays)}学习，每次 ${minuteOptionLabel(plan.dailyMinutes)}`]
  if (plan.lastDay) parts.push(plan.lastDay === today ? '今天之后还没有任务' : `排到${dayLabel(plan.lastDay, today)}`)
  else parts.push('今天起还没有任务')
  return parts.join(' · ')
}

// 学生详情「学习课程」：按学习情况筛选（与学习端「本课已学完」同一口径：全部页面的学习记录都齐了才算学完）。
const COURSE_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'not_started', label: '未学' },
  { id: 'in_progress', label: '学习中' },
  { id: 'completed', label: '已学完' }
]

function courseLearningState(course) {
  if (!course || !course.canLearn) return course && course.status === 'generating' ? 'generating' : 'unavailable'
  const learning = course.acceptance && course.acceptance.learning
  if (!learning) return 'unknown'
  if (learning.allRecorded) return 'completed'
  const touched = Number(learning.completed) > 0 ||
    (learning.scenes || []).some((scene) => scene && (scene.state === 'completed' || scene.state === 'in_progress'))
  return touched ? 'in_progress' : 'not_started'
}

function filterCourses(courses, filter) {
  return filter === 'all' ? courses.slice() : courses.filter((course) => course.learningState === filter)
}

function courseFilterTabs(courses, active) {
  return COURSE_FILTERS.map((item) => ({
    ...item,
    count: item.id === 'all' ? courses.length : courses.filter((course) => course.learningState === item.id).length,
    active: item.id === active
  }))
}

module.exports = {
  MINUTE_OPTIONS,
  WEEKDAY_OPTIONS,
  ALL_WEEKDAYS,
  weekdayNumber,
  normalizeWeekdays,
  weekdaysText,
  isStudyDay,
  monthDay,
  weekday,
  LEVEL_LABELS,
  COURSE_FILTERS,
  addDays,
  dayDiff,
  dayLabel,
  fullDayLabel,
  durationText,
  minuteOptionLabel,
  decorateTask,
  decorateDay,
  planSummary,
  courseLearningState,
  filterCourses,
  courseFilterTabs
}
