const { requestK12Assessment } = require('./identity')

// 三档掌握状态（摸底诊断规则：掌握/待巩固/未掌握，另加待测）
const stateLabels = { mastered: '掌握', reinforce: '待巩固', not_mastered: '未掌握', pending: '待测' }
const subjects = { chi: '语文', math: '数学', eng: '英语', sci: '科学', phy: '物理', chem: '化学', bio: '生物', pol: '政治', his: '历史', geo: '地理' }

function masteryLabel(topic) {
  return stateLabels[(topic && topic.state)] || stateLabels.pending
}

// 分档色（用于前端样式）：扎实 green / 基本掌握 blue / 薄弱 orange / 需系统重建 red
function bandTone(band) {
  if (band === '扎实') return 'solid'
  if (band === '基本掌握') return 'steady'
  if (band === '薄弱') return 'weak'
  if (band === '需系统重建') return 'rebuild'
  return 'pending'
}

function reportView(report) {
  if (!report) return null
  const topics = (report.topics || []).map(t => ({
    ...t,
    stateLabel: masteryLabel(t),
    rateLabel: t.n ? `${t.c}/${t.n}` : '待测',
    tone: (t.state === 'mastered' ? 'solid' : t.state === 'reinforce' ? 'steady' : t.state === 'not_mastered' ? 'weak' : 'pending')
  }))
  const measured = topics.filter(t => t.n > 0)
  return {
    ...report,
    topics,
    scoreLabel: report.totalScore == null ? '—' : `${report.totalScore} 分`,
    bandLabel: report.scoreBand || '待测',
    bandTone: bandTone(report.scoreBand),
    measuredCount: measured.length,
    totalCount: topics.length,
    masteredCount: report.masteredCount || 0,
    reinforceCount: report.reinforceCount || 0,
    notMasteredCount: report.notMasteredCount || 0,
    pendingCount: report.pendingCount || 0
  }
}

async function call(operation, payload = {}) { return requestK12Assessment({ ...payload, operation }) }

module.exports = { call, reportView, masteryLabel, bandTone, stateLabels, subjects }
