const { timingNotice } = require('./question-timing')
// 学科测评报告页（assessment/report，设计稿 ui-ref M17，2026-09-30）的视图模型。
//
// 数据全部来自摸底诊断提交后的报告（测评动作流 read 回包的 attempt.report，经 services/assessment 的 reportView），
// 设计稿里没有真实数据来源的模块不画：
// - 同龄段对比：没有同范围的可比样本，整块不显示；
// - 提升路径：不估学习周数 / 单元数，只按本次判定把未掌握、待巩固的知识点排成先后阶段。
// 雷达图按教材单元算掌握度（动作流读报告时给知识点带上 unit）；已判定的单元不足 3 个时改按知识点画（见 radarModel）。

const TIER_ORDER = { A: 0, B: 1, C: 2 }
const RADAR_MIN = 3
const RADAR_MAX = 6
const RADAR_COLORS = ['#F27377', '#E96570', '#F4958E', '#DD6470', '#F2A08C', '#E88579']
const WEAK_LIMIT = 6
const PENDING_LIMIT = 12
const FOCUS_LIMIT = 3

const SUMMARY = [
  { id: 'mastered', key: 'masteredCount', label: '已掌握', color: '#279D8B' },
  { id: 'reinforce', key: 'reinforceCount', label: '待巩固', color: '#D9982E' },
  { id: 'not_mastered', key: 'notMasteredCount', label: '未掌握', color: '#DB6C65' },
  { id: 'pending', key: 'pendingCount', label: '待测', color: '#758BBC' }
]

const WEAK_REASON = {
  not_mastered: '这部分的题目都没有答对，建议从概念和例题重新学起。',
  reinforce: '有答对也有答错，理解还不稳定，建议针对做错的题型专项练习。'
}

function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return ''
  const number = Math.round(Number(value) * 10) / 10
  return String(number)
}

function byPriority(a, b) {
  const tier = (TIER_ORDER[a.tier] == null ? 3 : TIER_ORDER[a.tier]) - (TIER_ORDER[b.tier] == null ? 3 : TIER_ORDER[b.tier])
  return tier || (a.order - b.order)
}

// 单元名「第一章 有理数」「第二单元 课文（小蝌蚪找妈妈、…）」在雷达图上只放得下几个字：去掉章节序号和括号里的篇目。
// 去完为空或和别的单元重名时，改用章节序号（「第二单元」）。
const UNIT_PREFIX = /^((?:第[一二三四五六七八九十百零〇\d]+(?:章|单元|节|部分|课|模块|专题))|(?:(?:Unit|Module|Chapter)\s*\d+))[\s:：、.．-]*/i
function unitParts(name) {
  const text = String(name || '').trim()
  const match = UNIT_PREFIX.exec(text)
  const prefix = match ? match[1] : ''
  const rest = (match ? text.slice(match[0].length) : text).replace(/[（(].*$/, '').trim()
  return { prefix, short: rest || prefix || text }
}

// 按教材单元汇总已判定的知识点：单元掌握度 = Σ(权重 × 答对率) / Σ权重，与综合掌握度同一口径。
// 单元超过 RADAR_MAX 个时保留已判定权重最大的几个，按教材顺序排；不足 RADAR_MIN 个不画雷达图。
function radarDimensions(topics) {
  const units = new Map()
  topics.forEach((topic) => {
    if (!topic.unit || topic.state === 'pending' || !(topic.n > 0)) return
    const key = topic.unitId != null ? String(topic.unitId) : topic.unit
    if (!units.has(key)) units.set(key, { id: key, name: topic.unit, order: Number(topic.unitOrder) || 0, weight: 0, earned: 0 })
    const unit = units.get(key)
    const weight = Number(topic.weight) > 0 ? Number(topic.weight) : 1
    unit.weight += weight
    unit.earned += weight * Math.min(1, Math.max(0, Number(topic.c) || 0) / topic.n)
  })
  let list = [...units.values()]
  if (list.length < RADAR_MIN) return []
  if (list.length > RADAR_MAX) list = list.sort((a, b) => b.weight - a.weight || a.order - b.order).slice(0, RADAR_MAX)
  list.sort((a, b) => a.order - b.order)
  const parts = list.map((unit) => unitParts(unit.name))
  const seen = {}
  parts.forEach((part) => { seen[part.short] = (seen[part.short] || 0) + 1 })
  return list.map((unit, index) => {
    const part = parts[index]
    return {
      id: unit.id,
      name: unit.name,
      label: seen[part.short] > 1 && part.prefix ? part.prefix : part.short,
      value: Math.round(unit.earned / unit.weight * 100),
      color: RADAR_COLORS[index % RADAR_COLORS.length]
    }
  })
}

// 雷达图顶点旁的单元名：一行放不下折成两行，两行还放不下末尾加省略号。measure(text) 返回像素宽度（页面画布与分享长图各自传入）。
function radarLabelLines(label, maxWidth, measure, maxLines = 2) {
  const chars = Array.from(String(label || ''))
  const lines = []
  let line = ''
  chars.forEach((char) => {
    if (line && measure(line + char) > maxWidth) {
      lines.push(line)
      line = char
    } else line += char
  })
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1] + lines.slice(maxLines).join('')
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last}…`
  return kept
}

// 按知识点画雷达图：每个维度就是一个已判定知识点的答对率。
// 线上 118 个摸底诊断范围都是多轮卷，只做完第 1 轮时 88 个范围的已判定知识点只落在 1～2 个单元里（2026-10-03 按题库组卷结构统计），
// 按单元画不出来；第 1 轮做完后每个范围至少有 6 个已判定知识点。超过 6 个时核心 → 重要 → 基础、权重大的优先，按教材顺序排。
function topicDimensions(topics) {
  const judged = topics.filter((topic) => topic.state !== 'pending' && topic.n > 0)
  if (judged.length < RADAR_MIN) return []
  const rank = (topic) => (TIER_ORDER[topic.tier] == null ? 3 : TIER_ORDER[topic.tier])
  const textbookOrder = (a, b) => (Number(a.unitOrder) || 0) - (Number(b.unitOrder) || 0) || Number(a.topicId) - Number(b.topicId)
  return judged
    .sort((a, b) => rank(a) - rank(b) || (Number(b.weight) || 0) - (Number(a.weight) || 0) || textbookOrder(a, b))
    .slice(0, RADAR_MAX)
    .sort(textbookOrder)
    .map((topic, index) => ({
      id: `topic-${topic.topicId}`,
      name: topic.name || '未命名知识点',
      label: topic.name || '未命名知识点',
      value: Math.round(Math.min(1, Math.max(0, Number(topic.c) || 0) / topic.n) * 100),
      color: RADAR_COLORS[index % RADAR_COLORS.length]
    }))
}

// 雷达图的维度：教材单元够 3 个就按单元，否则按知识点；都不够不画。
function radarModel(topics) {
  const units = radarDimensions(topics)
  if (units.length) return { basis: 'unit', dimensions: units }
  const points = topicDimensions(topics)
  return { basis: points.length ? 'topic' : '', dimensions: points }
}

function insightPills(dimensions) {
  if (dimensions.length < 2) return []
  const strongest = dimensions.reduce((best, item) => item.value > best.value ? item : best)
  const weakest = dimensions.reduce((low, item) => item.value < low.value ? item : low)
  if (strongest.value === weakest.value) return []
  return [
    { id: 'strength', tone: 'strength', text: `优势 · ${strongest.label} ${strongest.value}%` },
    { id: 'priority', tone: 'priority', text: `优先提升 · ${weakest.label} ${weakest.value}%` }
  ]
}

function adviceText(notMastered, reinforce, report) {
  if (notMastered.length && reinforce.length) return `先补${notMastered[0].name}，再巩固${reinforce[0].name}。`
  if (notMastered.length > 1) return `先补${notMastered[0].name}，再补${notMastered[1].name}。`
  if (notMastered.length) return `先把${notMastered[0].name}补上。`
  if (reinforce.length > 1) return `重点巩固${reinforce[0].name}和${reinforce[1].name}。`
  if (reinforce.length) return `重点巩固${reinforce[0].name}。`
  if (report.nextRound) return report.masteredCount ? '已判定的知识点都掌握了，做完后续轮次再看全貌。' : '做完后续轮次后给出知识点判定。'
  return report.masteredCount ? '这次的知识点都掌握了，保持练习。' : '暂时没有可判定的知识点。'
}

function focusLine(topics) {
  const names = topics.slice(0, FOCUS_LIMIT).map((topic) => topic.name)
  return names.join(' → ') + (topics.length > FOCUS_LIMIT ? ` 等 ${topics.length} 个` : '')
}

function pathStages(notMastered, reinforce, report) {
  const stages = []
  if (notMastered.length) {
    stages.push({ id: 'foundation', phase: '先补基础', focus: focusLine(notMastered), duration: `${notMastered.length} 个知识点`, detail: '从概念和例题重新学起，先补上后面内容要用到的基础。' })
  }
  if (reinforce.length) {
    stages.push({ id: 'reinforce', phase: '再做巩固', focus: focusLine(reinforce), duration: `${reinforce.length} 个知识点`, detail: '针对做错的题型专项练习，把不稳定的理解练扎实。' })
  }
  if (!stages.length) return []
  if (report.nextRound) {
    stages.push({ id: 'review', phase: '继续测评', focus: `第 ${report.nextRound} 轮测评`, duration: `${report.pendingCount || 0} 个待测`, detail: '做完后续轮次，还没判定的知识点才会给出结论。' })
  } else {
    stages.push({ id: 'review', phase: '复测确认', focus: '同类题复测 · 查漏补缺', duration: '学完后', detail: '学完后再测一次，用新的作答结果更新掌握判断。' })
  }
  return stages.map((stage, index) => ({ ...stage, number: String(index + 1).padStart(2, '0') }))
}

function contextLabel(scope) {
  const name = String((scope && scope.name) || '').replace(/\s*·\s*摸底诊断\s*$/, '').trim()
  return name || '学科摸底诊断'
}

function periodLabel(report) {
  const count = Number(report.roundCount) || 1
  if (count <= 1) return '摸底诊断'
  if (report.isFinal !== false) return `已完成全部 ${count} 轮`
  return `第 ${report.round} 轮 / 共 ${count} 轮`
}

// report：services/assessment 的 reportView 结果；student：{ name, avatarUrl }（读不到时为空）。
function buildReportModel(report, student) {
  if (!report) return null
  const topics = (report.topics || []).map((topic, order) => ({ ...topic, order }))
  const notMastered = topics.filter((topic) => topic.state === 'not_mastered').sort(byPriority)
  const reinforce = topics.filter((topic) => topic.state === 'reinforce').sort(byPriority)
  const weakTopics = notMastered.concat(reinforce)
  const pending = topics.filter((topic) => topic.state === 'pending')
  const radar = radarModel(topics)
  const dimensions = radar.dimensions
  const scoreText = formatScore(report.totalScore)
  const stages = pathStages(notMastered, reinforce, report)
  const notice = String(report.notice || '').trim()
  return {
    attemptId: report.attemptId,
    scopeId: report.scope && report.scope.id,
    nextRound: report.nextRound || null,
    student: { name: (student && student.name) || '', avatarUrl: (student && student.avatarUrl) || '' },
    cover: {
      score: scoreText ? Number(scoreText) : null,
      scoreText: scoreText || '—',
      totalScore: 100,
      insightPills: scoreText ? insightPills(dimensions) : []
    },
    radar: dimensions,
    radarLabel: radar.basis === 'topic' ? '各知识点掌握度雷达图' : '各单元掌握度雷达图',
    context: contextLabel(report.scope),
    period: periodLabel(report),
    advice: adviceText(notMastered, reinforce, report),
    summary: SUMMARY.map((item) => ({ id: item.id, label: item.label, color: item.color, value: String(Number(report[item.key]) || 0) })),
    weakPoints: weakTopics.slice(0, WEAK_LIMIT).map((topic) => ({
      id: String(topic.topicId),
      topicId: topic.topicId,
      title: topic.name || '未命名知识点',
      category: [topic.tierLabel, topic.stateLabel].filter(Boolean).join(' · '),
      reason: WEAK_REASON[topic.state]
    })),
    weakMore: Math.max(0, weakTopics.length - WEAK_LIMIT),
    pendingPoints: pending.slice(0, PENDING_LIMIT).map((topic) => topic.name || '未命名知识点'),
    pendingCount: pending.length,
    pathEstimate: weakTopics.length ? `${weakTopics.length} 个知识点 · 分 ${stages.length} 步` : '',
    pathStages: stages,
    review: report.review || [],
    questionTimings: report.questionTimings || report.review || [],
    timingNotice,
    methodNote: `数据说明：${notice ? notice + ' ' : ''}综合掌握度按知识点加权（核心 ×4、重要 ×2、基础 ×1），一个知识点的题答对超过一半算掌握；待测的知识点不计入。`
  }
}

module.exports = { buildReportModel, radarDimensions, radarLabelLines, topicDimensions, unitParts }
