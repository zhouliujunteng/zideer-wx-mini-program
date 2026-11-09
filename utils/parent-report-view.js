// 家长学习成长报告（老师工作台 → 学生详情 → 家长学习报告）的列表显示：
// 课程服务给的每份报告（状态、时间、出报告的老师、摘要、寄语）→ 页面上的一张卡片。

const STATUS = {
  generating: { label: '生成中', tone: 'busy' },
  ready: { label: '已生成', tone: 'ready' },
  failed: { label: '生成失败', tone: 'failed' }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

// 按北京时间写：今天 14:32 / 昨天 09:10 / 10月3日 14:32 / 2025年12月1日
function timeLabel(iso, now = new Date()) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const bj = new Date(ms + 8 * 3600000)
  const today = new Date(now.getTime() + 8 * 3600000)
  const dayOf = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const diff = Math.round((dayOf(today) - dayOf(bj)) / 86400000)
  const clock = `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`
  if (diff === 0) return `今天 ${clock}`
  if (diff === 1) return `昨天 ${clock}`
  if (bj.getUTCFullYear() !== today.getUTCFullYear()) return `${bj.getUTCFullYear()}年${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日`
  return `${bj.getUTCMonth() + 1}月${bj.getUTCDate()}日 ${clock}`
}

function sizeLabel(bytes) {
  const n = Number(bytes) || 0
  if (!n) return ''
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`
}

// 摘要胶囊：各科最新分数（带提升）、定制课程、新掌握知识点
function summaryChips(summary) {
  if (!summary) return []
  const chips = []
  ;(summary.subjects || []).slice(0, 4).forEach((s) => {
    if (s.score === null || s.score === undefined) return
    const delta = Number(s.delta)
    chips.push({ text: `${s.subject} ${s.score} 分${delta > 0 ? ` ↑${delta}` : ''}`, tone: delta > 0 ? 'up' : '' })
  })
  if (summary.courseCount) chips.push({ text: `定制课程 ${summary.courseCount} 节 · 学完 ${summary.doneCourses || 0} 节`, tone: '' })
  if (summary.newlyMastered) chips.push({ text: `新掌握 ${summary.newlyMastered} 个知识点`, tone: 'up' })
  return chips
}

// 推送家长（服务号「学生综合素质评价结果通知」，2026-10-08）的结果：推给了几位家长、几位还没关注服务号
function pushView(push) {
  if (!push || !push.guardians) return { pushed: false, pushText: '' }
  const sent = Number(push.sent) || 0
  const waiting = Number(push.waiting) || 0
  const parts = []
  if (sent) parts.push(`已推送 ${sent} 位家长`)
  if (waiting) parts.push(`${waiting} 位家长还没关注服务号，关注后 24 小时内补发`)
  if (push.failed) parts.push(`${push.failed} 位没推送成功`)
  return { pushed: sent > 0 && sent + waiting >= push.guardians, pushText: parts.join('；') }
}

function decorateReport(report, now = new Date()) {
  const status = STATUS[report.status] || STATUS.failed
  return {
    id: report.id,
    status: report.status,
    statusLabel: status.label,
    statusTone: status.tone,
    timeText: timeLabel(report.createdAt, now),
    byText: report.teacherName ? `${report.teacherName}出的报告` : '',
    sizeText: report.status === 'ready' ? sizeLabel(report.fileSize) : '',
    fileName: report.fileName || '学习成长报告.pdf',
    chips: report.status === 'ready' ? summaryChips(report.summary) : [],
    // 两段话：发给家长的（也印在报告里的老师寄语）、发给学生的；老师点一下就复制
    parentNote: report.status === 'ready' ? String(report.teacherNote || '') : '',
    studentNote: report.status === 'ready' ? String(report.studentNote || '') : '',
    errorText: report.status === 'failed' ? String(report.errorText || '生成失败，请稍后重试') : '',
    ...pushView(report.status === 'ready' ? report.push : null)
  }
}

function decorateReports(reports, now = new Date()) {
  return (Array.isArray(reports) ? reports : []).map((r) => decorateReport(r, now))
}

module.exports = { STATUS, timeLabel, sizeLabel, summaryChips, pushView, decorateReport, decorateReports }
