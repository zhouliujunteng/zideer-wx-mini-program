// 老师工作台 → 学生详情 → 学习情况 →「今日学习」（2026-10-07）：
// 课程服务给的今天的学习事实（时长、打卡、每门课今天学完的页、测验、复述验收、今日任务）与老师今天生成的那段话 → 卡片上显示的内容。

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value) {
  return String(value).padStart(2, '0')
}

// 2026-10-07 → 10月7日 周三
function dayLabel(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!match) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return `${Number(match[2])}月${Number(match[3])}日 ${WEEKDAYS[date.getUTCDay()]}`
}

// 生成时间按北京时间写时分
function clockLabel(iso) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const bj = new Date(ms + 8 * 3600000)
  return `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
}

function minutesLabel(minutes) {
  const n = Math.max(0, Math.round(Number(minutes) || 0))
  if (n < 60) return { value: String(n), unit: '分钟' }
  const hours = Math.floor(n / 60)
  const rest = n % 60
  return rest ? { value: `${hours}小时${rest}`, unit: '分钟' } : { value: String(hours), unit: '小时' }
}

// 最近 7 天：学了几天 · 连续几天 · 共多久（连续不到 2 天不写）
function recentLabel(recent) {
  if (!recent || !recent.studiedDays) return ''
  const time = minutesLabel(recent.minutes)
  return [`最近 7 天学了 ${recent.studiedDays} 天`, recent.streakDays >= 2 ? `连续 ${recent.streakDays} 天` : '', recent.minutes ? `共 ${time.value}${time.unit}` : ''].filter(Boolean).join(' · ')
}

function pageList(pages) {
  const titles = pages.slice(0, 3).map((p) => p.title).filter(Boolean)
  return titles.join('、') + (pages.length > 3 ? ` 等 ${pages.length} 页` : '')
}

function courseView(course) {
  const pages = Array.isArray(course.pages) ? course.pages : []
  const tags = []
  if (course.quiz && course.quiz.total) tags.push({ text: `测验 ${course.quiz.correct}/${course.quiz.total}`, tone: course.quiz.correct === course.quiz.total ? 'good' : '' })
  if (course.finishedToday) tags.push({ text: '整门课学完', tone: 'good' })
  if (course.acceptance === 'passed') tags.push({ text: '复述验收通过', tone: 'good' })
  if (course.acceptance === 'retry') tags.push({ text: '复述验收要再说一次', tone: 'warn' })
  return {
    stageId: course.stageId,
    title: course.title || '定制课程',
    line: pages.length ? `学完 ${pages.length} 页：${pageList(pages)}` : '今天做了复述验收',
    progress: course.finishedToday || !course.totalPages ? '' : `进度 ${course.completedPages}/${course.totalPages}`,
    tags
  }
}

/** 课程服务 /api/teacher/daily-learning 的回包 → 卡片。 */
function decorateDaily(result) {
  const facts = (result && result.facts) || {}
  const courses = (Array.isArray(facts.courses) ? facts.courses : []).map(courseView)
  const pages = (Array.isArray(facts.courses) ? facts.courses : []).reduce((total, c) => total + (Array.isArray(c.pages) ? c.pages.length : 0), 0)
  const time = minutesLabel(facts.minutes)
  const stats = [{ label: '学习时长', value: time.value, unit: time.unit }, { label: '今天学完', value: String(pages), unit: '页' }]
  if (facts.plan && facts.plan.total) stats.push({ label: '今日任务', value: `${facts.plan.done}/${facts.plan.total}`, unit: '项' })
  const note = result && result.note
  return {
    day: String((result && result.day) || facts.day || ''),
    dayText: dayLabel((result && result.day) || facts.day),
    studied: !!facts.studied,
    checkedIn: !!facts.checkedIn,
    stats,
    recentText: recentLabel(facts.recent),
    courses,
    // 只有时长、没有学完新的一页（复习、看到一半）
    onlyTime: !!facts.studied && !courses.length,
    note: note && note.text
      ? {
          text: String(note.text),
          meta: [note.teacherName, note.updatedAt ? `${clockLabel(note.updatedAt)} 生成` : ''].filter(Boolean).join(' · '),
          outdated: !!note.outdated
        }
      : null
  }
}

module.exports = { dayLabel, clockLabel, minutesLabel, recentLabel, decorateDaily }
