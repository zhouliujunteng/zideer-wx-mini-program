const { timingView } = require('../utils/question-timing')
const { requestK12Assessment } = require('./identity')
const { summarizeSubjectDiagnosis } = require('../utils/live-session-brief')

// 三档掌握状态（摸底诊断规则：掌握/待巩固/未掌握，另加待测）
const stateLabels = { mastered: '掌握', reinforce: '待巩固', not_mastered: '未掌握', pending: '待测' }
const subjects = { chi: '语文', math: '数学', eng: '英语', sci: '科学', phy: '物理', chem: '化学', bio: '生物', pol: '政治', his: '历史', geo: '地理' }
const tierLabels = { A: '核心', B: '重要', C: '基础' }

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

function topicTone(state) {
  return state === 'mastered' ? 'solid' : state === 'reinforce' ? 'steady' : state === 'not_mastered' ? 'weak' : 'pending'
}

function topicRateLabel(t) {
  if (t.state !== 'pending') return `${t.c}/${t.n}`
  if (!t.n) return '暂无题目'
  return t.answered ? `已测 ${t.answered}/${t.n}` : '后续轮次'
}

// 知识点按 三态 → 待测 排序；已判定的排前面，便于先看结论。
const stateOrder = { not_mastered: 0, reinforce: 1, mastered: 2, pending: 3 }

function reviewView(item) {
  return {
    ...timingView(item),
    options: (item.options || []).map(o => ({
      ...o,
      tone: o.value === item.answer ? 'is-answer' : o.value === item.selected ? 'is-wrong' : ''
    })),
    resultLabel: item.correct ? '答对' : item.selected ? '答错' : item.unreached ? '未作答' : '跳过',
    resultTone: item.correct ? 'solid' : 'weak',
    selectedLabel: item.selected || '未作答'
  }
}

function reportView(report) {
  if (!report) return null
  const topics = (report.topics || []).map(t => ({
    ...t,
    stateLabel: masteryLabel(t),
    rateLabel: topicRateLabel(t),
    tierLabel: tierLabels[t.tier] || '',
    tone: topicTone(t.state)
  })).sort((a, b) => (stateOrder[a.state] - stateOrder[b.state]))
  const judged = topics.filter(t => t.state !== 'pending')
  const band = report.band || report.scoreBand
  const roundCount = Number(report.roundCount || 1)
  const summary = report.roundSummary || {}
  return {
    ...report,
    topics,
    judgedTopics: judged,
    pendingTopics: topics.filter(t => t.state === 'pending'),
    review: (report.review || []).map(reviewView),
    questionTimings: (report.questionTimings || report.review || []).map(timingView),
    scoreLabel: report.totalScore == null ? '—' : `${report.totalScore} 分`,
    bandLabel: band || '待测',
    bandTone: bandTone(band),
    measuredCount: judged.length,
    totalCount: topics.length,
    masteredCount: report.masteredCount || 0,
    reinforceCount: report.reinforceCount || 0,
    notMasteredCount: report.notMasteredCount || 0,
    pendingCount: report.pendingCount || 0,
    multiRound: roundCount > 1,
    roundLabel: roundCount > 1 ? `第 ${report.round} 轮 / 共 ${roundCount} 轮` : '',
    progressLabel: roundCount > 1 ? `已完成 ${report.completedRounds}/${roundCount} 轮` : '',
    title: report.isFinal === false ? `第 ${report.round} 轮已完成` : '本次摸底诊断已完成',
    roundResultLabel: `本轮答对 ${summary.correctCount || 0}/${(report.review || []).length} 题 · 得分 ${summary.earnedMarks || 0}/${summary.possibleMarks || 0}`
  }
}

// ── 再测对比（2026-10-06）：同一范围做完的各张卷前后比 ──
// 历次成绩来自 catalog 回包里每个范围的 entry.history（动作流 paperHistory）：只列做完整张卷的，
// 每项 attemptId（那张卷最后一轮的报告编号）、number（第几次）、completedAt、totalScore（综合掌握度）、band（档位）。
const bandRanks = { '需系统重建': 0, '薄弱': 1, '基本掌握': 2, '扎实': 3 }
const verdictRanks = { not_mastered: 0, reinforce: 1, mastered: 2 }
const COMPARE_TOPIC_LIMIT = 8

function scoreNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null
}

function dateLabel(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

// 历次成绩：按第几次从新到旧排（不依赖回包顺序）。
function paperHistoryView(history) {
  return (Array.isArray(history) ? history : [])
    .filter(item => item && item.attemptId != null && Number(item.number) > 0)
    .map(item => {
      const score = scoreNumber(item.totalScore)
      return {
        attemptId: String(item.attemptId),
        number: Number(item.number),
        totalScore: score,
        scoreLabel: score == null ? '待测' : `${score} 分`,
        band: item.band || '',
        bandLabel: item.band || '待测',
        bandTone: bandTone(item.band),
        dateLabel: dateLabel(item.completedAt)
      }
    })
    .sort((a, b) => b.number - a.number)
}

// 两次综合掌握度之差（一位小数，与报告同一口径）；任一次没有分数时不比。
function scoreChange(current, previous) {
  if (current == null || previous == null) return null
  const diff = Math.round((current - previous) * 10) / 10
  if (diff > 0) return { diff, tone: 'up', signed: `+${diff} 分`, arrow: `↑ ${diff} 分` }
  if (diff < 0) return { diff, tone: 'down', signed: `${diff} 分`, arrow: `↓ ${-diff} 分` }
  return { diff: 0, tone: 'flat', signed: '持平', arrow: '持平' }
}

// 列表上的一句话：这一次比它的上一次涨跌多少分。没有上一次、分数缺失时为空。
function historyChange(history, attemptId) {
  const list = paperHistoryView(history)
  const index = list.findIndex(item => item.attemptId === String(attemptId))
  const change = index >= 0 && list[index + 1] ? scoreChange(list[index].totalScore, list[index + 1].totalScore) : null
  if (!change) return { deltaLabel: '', deltaTone: '' }
  return { deltaLabel: change.diff ? `比上次 ${change.signed}` : '与上次持平', deltaTone: change.tone }
}

// 知识点掌握状态的变化：只比两次都给出判定（掌握 / 待巩固 / 未掌握）的知识点，待测的不算。
// 进步在前、退步在后，各自按 核心 → 重要 → 基础、报告原顺序。两次没有共同判定的知识点时为 null。
function topicChanges(report, previousReport) {
  const before = {}
  ;((previousReport && previousReport.topics) || []).forEach(t => { if (t && verdictRanks[t.state] != null) before[String(t.topicId)] = t })
  const tierOrder = { A: 0, B: 1, C: 2 }
  const changes = []
  let compared = 0
  ;((report && report.topics) || []).forEach((t, order) => {
    const prior = t && verdictRanks[t.state] != null ? before[String(t.topicId)] : null
    if (!prior) return
    compared++
    const step = verdictRanks[t.state] - verdictRanks[prior.state]
    if (!step) return
    changes.push({
      topicId: String(t.topicId),
      name: t.name || prior.name || '未命名知识点',
      fromLabel: stateLabels[prior.state],
      toLabel: stateLabels[t.state],
      tone: step > 0 ? 'up' : 'down',
      rank: (step > 0 ? 0 : 10) + (tierOrder[t.tier] == null ? 3 : tierOrder[t.tier]),
      order
    })
  })
  if (!compared) return null
  changes.sort((a, b) => a.rank - b.rank || a.order - b.order)
  const up = changes.filter(item => item.tone === 'up').length
  const down = changes.length - up
  const same = compared - changes.length
  const parts = [up ? `进步 ${up} 个` : '', down ? `退步 ${down} 个` : '', same ? `不变 ${same} 个` : ''].filter(Boolean)
  return {
    items: changes.slice(0, COMPARE_TOPIC_LIMIT).map(item => ({ topicId: item.topicId, name: item.name, fromLabel: item.fromLabel, toLabel: item.toLabel, tone: item.tone })),
    more: Math.max(0, changes.length - COMPARE_TOPIC_LIMIT),
    upCount: up,
    downCount: down,
    sameCount: same,
    summary: changes.length ? parts.join(' · ') : `两次都判定的 ${compared} 个知识点，掌握状态没有变化`
  }
}

// 报告页「和上次比」与「历次成绩」。history：catalog 里本范围的 entry.history；attemptId：正在看的这份报告；
// report / previousReport：本次与上次的累计报告（动作流 read 的 attempt.report），上次读不到时传 null，只比分数与档位。
// 这个范围做完的卷不足 2 张、或正在看的报告不在历次成绩里时为 null（页面不显示对比）。
function retakeCompareView(history, attemptId, report, previousReport) {
  const list = paperHistoryView(history)
  const index = list.findIndex(item => item.attemptId === String(attemptId))
  if (list.length < 2 || index < 0) return null
  const current = list[index]
  const previous = list[index + 1] || null
  const view = {
    history: list.map(item => ({ ...item, isCurrent: item.attemptId === current.attemptId })),
    previousAttemptId: previous ? previous.attemptId : '',
    change: null
  }
  if (!previous) return view
  const now = current.totalScore != null ? current.totalScore : scoreNumber(report && report.totalScore)
  const nowBand = current.band || (report && (report.band || report.scoreBand)) || ''
  const score = scoreChange(now, previous.totalScore)
  const bandStep = bandRanks[nowBand] != null && bandRanks[previous.band] != null ? bandRanks[nowBand] - bandRanks[previous.band] : null
  view.change = {
    previousNumber: previous.number,
    previousDate: previous.dateLabel,
    previousScoreText: previous.totalScore == null ? '—' : String(previous.totalScore),
    currentScoreText: now == null ? '—' : String(now),
    scoreTone: score ? score.tone : '',
    scoreDeltaLabel: score ? score.arrow : '',
    previousBand: previous.bandLabel,
    previousBandTone: previous.bandTone,
    currentBand: nowBand || '待测',
    currentBandTone: bandTone(nowBand),
    bandChanged: (previous.band || '') !== nowBand,
    bandDirection: bandStep == null || !bandStep ? '' : bandStep > 0 ? 'up' : 'down',
    topics: previousReport ? topicChanges(report, previousReport) : null
  }
  return view
}

// 范围入口的按钮文案与说明
// 做完整张卷后可以再测一次（2026-10-03）：retakeLabel 有值时测评页在这一行多放一个「再测一次」；再测过的标上第几次。
// 最新一张卷做完、前面还有做完的卷时，deltaLabel 是「比上次 +X 分」（2026-10-06）。
function entryView(scope) {
  const entry = scope.entry || { mode: 'unavailable' }
  const rounds = Number(scope.roundCount || entry.roundCount || 1)
  const done = Number(entry.completedRounds || 0)
  const nth = Number(entry.paperNumber || 0) > 1 ? `第 ${entry.paperNumber} 次 · ` : ''
  const labels = {
    start: '免费开始测评',
    resume: `继续第 ${entry.round || done + 1} 轮`,
    continue: `开始第 ${entry.round || done + 1} 轮`,
    report: '查看报告',
    unavailable: '题库准备中'
  }
  const plan = rounds > 1 ? `共 ${rounds} 轮，每轮约 ${scope.roundMinutes || 28} 分钟` : `约 ${scope.roundMinutes || 28} 分钟`
  return {
    ...(entry.mode === 'report' ? historyChange(entry.history, entry.attemptId) : { deltaLabel: '', deltaTone: '' }),
    actionLabel: labels[entry.mode] || labels.unavailable,
    retakeLabel: entry.mode === 'report' && entry.canRetake ? '再测一次' : '',
    detail: entry.mode === 'start' || entry.mode === 'unavailable' ? plan : entry.mode === 'report' ? `${nth}已完成全部 ${rounds} 轮` : `${nth}已完成 ${done}/${rounds} 轮 · 可分次完成`
  }
}

async function call(operation, payload = {}) { return requestK12Assessment({ ...payload, operation }) }

// 真人陪跑会议用：把这名学生做过的全部摸底报告，压成本场学科的一张知识点掌握表。
// 会议不能因为测评读不到就开不了场，所以失败在这里就地降级为 status=unavailable，
// 由 AI 当面把学情问清楚，而不是拿一张空表当成「都没问题」。
async function loadSubjectDiagnosis(subjectLabel) {
  try {
    const result = await call('reports')
    return summarizeSubjectDiagnosis(subjectLabel, (result && result.reports) || [])
  } catch (error) {
    return summarizeSubjectDiagnosis(subjectLabel, null)
  }
}

module.exports = { call, loadSubjectDiagnosis, reportView, entryView, paperHistoryView, historyChange, retakeCompareView, masteryLabel, bandTone, stateLabels, subjects }
