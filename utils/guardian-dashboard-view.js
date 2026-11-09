// 学生看板（家长）的界面模型：把动作流「读取当前家长学生看板」的真实数据整理成设计稿 M50 的四个标签页。
// 设计稿里没有后端数据的部分不做假数据：按学科的学习时长环图（学习时长只按天记总数）不显示；其余都来自后端，
// 见 docs/家长学生看板与身份规则记录.md。「作业动态」2026-10-13 起有了：课后作业来自课程服务（utils/homework-view.js）。
const SUBJECT_NAMES = {
  math: '数学', chi: '语文', eng: '英语', phy: '物理', chem: '化学',
  bio: '生物', geo: '地理', his: '历史', pol: '政治', sci: '科学'
}
const SUBJECT_COLORS = ['#4FC6B0', '#4E8CF6', '#F3C54B', '#F2765D', '#A58BEE', '#6CC2E8']
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const DAY_MS = 86400000
const BEIJING_OFFSET_MS = 8 * 3600000
const { guardianHomeworkSection } = require('./homework-view')

const REPORT_STATUS = {
  generating: { detail: '报告生成中', label: '生成中' },
  ai_verified_passed: { detail: 'AI 已评价 · 等待老师核验', label: '待核验' },
  ai_evaluated_pending_teacher: { detail: 'AI 已评价 · 等待老师核验', label: '待核验' },
  ai_retake_required: { detail: 'AI 判定需要巩固', label: '需巩固' },
  teacher_verified_passed: { detail: '老师核验通过', label: '已完成' },
  teacher_rejected: { detail: '老师判定需要补学', label: '需补学' },
  failed: { detail: '报告生成失败', label: '' }
}

// 北京时间的日期 'YYYY-MM-DD'
function dateKey(value) {
  const time = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

function clockText(value) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(11, 16)
}

function keyToUtc(key) {
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function shiftDays(key, days) {
  return new Date(keyToUtc(key) + days * DAY_MS).toISOString().slice(0, 10)
}

function monthDay(key) {
  const date = new Date(keyToUtc(key))
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
}

function dayLabel(key, today) {
  const text = `${monthDay(key)} 周${WEEKDAYS[new Date(keyToUtc(key)).getUTCDay()]}`
  return key === today ? `今天 · ${text}` : text
}

function subjectName(code, label) {
  return String(label || '').trim() || SUBJECT_NAMES[String(code || '').toLowerCase()] || ''
}

function gradeLabel(profile) {
  const grade = Number(profile.current_grade)
  if (grade >= 1 && grade <= 6) return `小学${'一二三四五六'[grade - 1]}年级`
  if (grade >= 7 && grade <= 9) return `初中${'一二三'[grade - 7]}年级`
  if (grade >= 10 && grade <= 12) return `高中${'一二三'[grade - 10]}年级`
  return '年级待完善'
}

function minutesOf(seconds) {
  return Math.round(Math.max(0, Number(seconds) || 0) / 60)
}

// 设计稿的时长写法：38 分钟 / 2 小时 10 分钟
function durationStat(label, tone, icon, minutes) {
  if (minutes < 60) return { label, tone, icon, value: String(minutes), unit: '分钟' }
  const rest = minutes % 60
  return { label, tone, icon, value: String(Math.floor(minutes / 60)), valueUnit: '小时', suffixValue: rest ? String(rest) : '', unit: rest ? '分钟' : '' }
}

function audioDuration(assets) {
  const seconds = Math.round((assets || []).reduce((total, asset) => total + (Number(asset.duration_ms) || 0), 0) / 1000)
  if (!seconds) return ''
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// 把一个孩子的后端数据整理成与日期无关的部分，诊断页按所选日期再从 activities 里筛
function buildChild(relation, now = Date.now()) {
  const profile = relation.student_profile || relation.profile || {}
  const today = dateKey(now)
  const rollups = (profile.learning_time_rollups || []).filter((row) => row && row.period_start)
  const minutesByDay = {}
  for (const row of rollups) minutesByDay[row.period_start] = (minutesByDay[row.period_start] || 0) + minutesOf(row.effective_seconds)
  const weekday = new Date(keyToUtc(today)).getUTCDay()
  const weekStart = shiftDays(today, -((weekday + 6) % 7))
  const weekMinutes = Object.keys(minutesByDay).filter((key) => key >= weekStart && key <= today).reduce((total, key) => total + minutesByDay[key], 0)

  const invites = profile.received_agent_invites || []
  const mistakes = profile.assessment_mistakes || []
  const reports = profile.topic_learning_reports || []

  // 学科学习：最近 60 天在各学科上的最新一次活动（陪跑课、摸底测评）；今天有活动的标「学习中」
  const subjectActivity = {}
  const noteSubject = (name, key, text) => {
    if (!name || !key) return
    const current = subjectActivity[name]
    if (!current || key > current.key) subjectActivity[name] = { key, text }
  }
  for (const invite of invites) {
    if (invite.status === 'closed') noteSubject(subjectName('', invite.subject_label), dateKey(invite.scheduled_online_at), `${invite.subject_label || ''}陪跑课`)
  }
  for (const attempt of mistakes) {
    noteSubject(subjectName(attempt.subject_code, ''), dateKey(attempt.submitted_at), '摸底测评')
  }
  const subjects = Object.keys(subjectActivity)
    .sort((a, b) => subjectActivity[b].key.localeCompare(subjectActivity[a].key))
    .map((name, index) => {
      const activity = subjectActivity[name]
      return {
        title: name,
        color: SUBJECT_COLORS[index % SUBJECT_COLORS.length],
        topic: `最近：${activity.text} · ${monthDay(activity.key)}`,
        statusLabel: activity.key === today ? '学习中' : '近期学习'
      }
    })

  // 当前计划：最新一份计划的任务完成情况与下一项
  const planRow = (profile.learning_plans || [])[0] || null
  let plan = null
  if (planRow) {
    const items = planRow.plan_items || []
    const done = items.filter((item) => item.status === 'completed').length
    const next = items.find((item) => item.status === 'available' || item.status === 'remediation_required')
    const nextName = next && next.knowledge_topic && next.knowledge_topic.display_name
    plan = {
      title: planRow.name || '学习计划',
      detail: items.length ? `已完成 ${done}/${items.length} 项${nextName ? ` · 下一项：${nextName}` : ''}` : (planRow.status === 'paused' ? '计划已暂停' : '计划任务准备中')
    }
  }

  // 近期日程：还没开始（或正在进行）的老师陪跑预约，取最近一场
  const upcoming = invites
    .filter((invite) => invite.status === 'scheduled' && Date.parse(invite.scheduled_online_at) + (Number(invite.meeting_minutes) || 60) * 60000 > now)
    .sort((a, b) => Date.parse(a.scheduled_online_at) - Date.parse(b.scheduled_online_at))[0]
  const schedule = upcoming ? {
    course: `${upcoming.subject_label || ''}陪跑课`,
    detail: `${dayLabel(dateKey(upcoming.scheduled_online_at), '')} ${clockText(upcoming.scheduled_online_at)}${upcoming.meeting_minutes ? ` · 预计 ${upcoming.meeting_minutes} 分钟` : ''}${upcoming.teacher_profile && upcoming.teacher_profile.display_name ? ` · ${upcoming.teacher_profile.display_name}老师` : ''}`
  } : null

  const name = profile.nickname || profile.real_name || '学生'
  return {
    id: profile.id,
    name,
    grade: gradeLabel(profile),
    avatarSrc: profile.avatar && profile.avatar.url || profile.avatar_url || '',
    today,
    minDate: shiftDays(today, -59),
    learning: {
      statCards: [
        durationStat('今日学习时长', 'blue', '↗', minutesByDay[today] || 0),
        durationStat('本周学习时长', 'amber', '★', weekMinutes)
      ],
      subjects
    },
    plan,
    schedule,
    creditsText: profile.credit_account ? String(Math.round(Number(profile.credit_account.available_credits) || 0)) : '',
    activity: { minutesByDay, invites, mistakes, reports }
  }
}

// 学习诊断：所选日期的作业动态、错题、学习记录、验收记录。
// homework 是这个孩子的课后作业读取状态 { loaded, failed, items }（课程服务另读）；不传时不显示「作业动态」。
function diagnosisFor(child, selectedDate, homework) {
  const date = selectedDate || child.today
  const { minutesByDay, invites, mistakes, reports } = child.activity
  const sameDay = (value) => dateKey(value) === date

  const dayMistakes = mistakes.filter((attempt) => sameDay(attempt.submitted_at))
  const mistakeRows = []
  for (const attempt of dayMistakes) {
    const subject = subjectName(attempt.subject_code, '')
    for (const item of attempt.wrong || []) {
      mistakeRows.push({ id: `${attempt.id}-${mistakeRows.length}`, number: String(mistakeRows.length + 1).padStart(2, '0'), title: item.prompt || '题目', detail: [subject, item.topic_name].filter(Boolean).join(' · ') })
    }
  }
  const wrongTotal = dayMistakes.reduce((total, attempt) => total + (Number(attempt.wrong_count) || 0), 0)

  const recordRows = []
  if (minutesByDay[date]) recordRows.push({ id: 'minutes', title: '有效学习', detail: `当日累计 ${minutesByDay[date]} 分钟` })
  for (const invite of invites.filter((row) => row.status === 'closed' && sameDay(row.scheduled_online_at))) {
    recordRows.push({ id: `invite-${invite.id}`, title: `${invite.subject_label || ''}陪跑课`, detail: [clockText(invite.scheduled_online_at), invite.meeting_minutes ? `${invite.meeting_minutes} 分钟` : ''].filter(Boolean).join(' · '), statusLabel: '已完成' })
  }
  for (const attempt of dayMistakes) {
    recordRows.push({ id: `assessment-${attempt.id}`, title: `完成${attempt.scope_name || '摸底测评'}`, detail: [clockText(attempt.submitted_at), `${attempt.question_count} 道题`].filter(Boolean).join(' · '), statusLabel: '已完成' })
  }

  const dayReports = reports.filter((report) => sameDay(report.generated_at))
  const acceptanceRows = dayReports.map((report) => {
    const view = REPORT_STATUS[report.status] || { detail: '验收处理中', label: '' }
    const topic = report.feynman_acceptance && report.feynman_acceptance.knowledge_topic && report.feynman_acceptance.knowledge_topic.display_name
    return { id: `report-${report.id}`, title: topic || '知识点验收', detail: view.detail, statusLabel: view.label }
  })
  const audio = audioDuration(dayReports.flatMap((report) => report.feynman_acceptance && report.feynman_acceptance.audio_assets || []))
  const pending = acceptanceRows.filter((row) => row.statusLabel === '待核验').length

  return {
    selectedDate: date,
    selectedDateLabel: dayLabel(date, child.today),
    minDate: child.minDate,
    maxDate: child.today,
    audioDuration: audio,
    sections: [
      ...(homework === undefined ? [] : [guardianHomeworkSection(homework, date)]),
      { id: 'mistakes', title: '错题动态', tone: 'orange', rows: mistakeRows, summary: wrongTotal ? `当日新增 ${wrongTotal} 道错题` : '当日没有新增错题' },
      { id: 'records', title: '学习记录', tone: 'green', rows: recordRows, summary: minutesByDay[date] ? `当日学习 ${minutesByDay[date]} 分钟` : `当日共 ${recordRows.length} 条学习记录`, more: 'learningFeed' },
      { id: 'acceptance', title: '验收记录', tone: 'purple', rows: acceptanceRows, summary: pending ? `当日 ${pending} 条待老师核验` : acceptanceRows.length ? `当日 ${acceptanceRows.length} 条验收记录` : '当日暂无新的验收记录', more: 'topicReports' }
    ]
  }
}

module.exports = { buildChild, diagnosisFor, dateKey, subjectName }
