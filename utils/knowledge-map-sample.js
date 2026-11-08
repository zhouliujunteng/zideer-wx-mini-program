// 示例图谱（2026-09-30 用户要求，小程序审核需要）：未登录、没完善学习资料时，图谱页不再只有一句提示，
// 而是画一张标明「示例」的知识图谱，能切学科、点知识点看说明与先后关系。
// 数据在 data/knowledge-map-sample.js（scripts/build-knowledge-map-sample.mjs 生成）：知识点是真实的初一上学期知识点，
// 掌握状态是编的。只在本地使用，不读后端；示例知识点的 id 都以 sample- 开头，不会拿去请求后端。
//
// 两个函数的返回值分别与 services/identity.js 的 loadKnowledgeMap、loadKnowledgeTopic 同形，页面照常渲染。
// 已登录、有学习资料的学生永远看不到示例：读取失败照常显示错误（见 pages/knowledge-map）。
const SAMPLE = require('../data/knowledge-map-sample')

// 每种掌握状态编多少条证据（测评 / 课程 / 老师核验），统计与知识点详情用同一套，前后对得上
const EVIDENCE = {
  mastered: { assessment: 2, course: 1, teacher: 1 },
  assessed_stable: { assessment: 2, course: 0, teacher: 0 },
  pending_teacher: { assessment: 1, course: 1, teacher: 0 },
  learning: { assessment: 1, course: 0, teacher: 0 },
  weak: { assessment: 1, course: 0, teacher: 0 },
  provisional: { assessment: 1, course: 0, teacher: 0 },
  unknown: { assessment: 0, course: 0, teacher: 0 }
}
const GRADE_LABEL = `初${SAMPLE.grade - 6}`

function evidenceOf(status) {
  return EVIDENCE[status] || EVIDENCE.unknown
}

function evidenceText(status) {
  const evidence = evidenceOf(status)
  const total = evidence.assessment + evidence.course + evidence.teacher
  return total ? `示例：已汇集 ${total} 条学习证据 · 测评 ${evidence.assessment} · 课程 ${evidence.course}` : '示例：还没有测评或课程学习记录'
}

function findSubject(subjectKey) {
  return SAMPLE.subjects.find((subject) => subject.key === subjectKey) || SAMPLE.subjects[0]
}

function isSampleTopicId(id) {
  return /^sample-/.test(String(id || ''))
}

function sampleKnowledgeMap(subjectKey) {
  const subject = findSubject(subjectKey)
  const nodes = subject.topics.map(([id, label, unit, status]) => ({
    id, label, shortLabel: label.slice(0, 8), grade: SAMPLE.grade, semester: SAMPLE.semester, unit, status,
    evidence: evidenceText(status)
  }))
  const edges = subject.edges.map(([from, to], index) => ({ id: String(index + 1), from: subject.topics[from][0], to: subject.topics[to][0], strength: 'hard' }))
  const stats = { mastered: 0, learning: 0, weak: 0, unknown: 0 }
  nodes.forEach((node) => { stats[node.status] = (stats[node.status] || 0) + 1 })
  // 学习宇宙的累计数跨学科统计，与正式图谱一致（测评较稳也算掌握）
  const universe = { evidenceCount: 0, assessmentEvidenceCount: 0, courseEvidenceCount: 0, teacherEvidenceCount: 0, masteredCount: 0 }
  SAMPLE.subjects.forEach((item) => item.topics.forEach(([, , , status]) => {
    const evidence = evidenceOf(status)
    universe.assessmentEvidenceCount += evidence.assessment
    universe.courseEvidenceCount += evidence.course
    universe.teacherEvidenceCount += evidence.teacher
    universe.evidenceCount += evidence.assessment + evidence.course + evidence.teacher
    if (status === 'mastered' || status === 'assessed_stable') universe.masteredCount += 1
  }))
  return {
    sample: true,
    diagnostic: { mode: 'unavailable', subject: subject.key },
    subjects: SAMPLE.subjects.map((item) => ({ key: item.key, name: item.name })),
    activeSubject: subject.name,
    activeSubjectKey: subject.key,
    general: false,
    grade: GRADE_LABEL,
    semester: SAMPLE.semester,
    unassignedTermCount: 0,
    universe,
    stats,
    nodes,
    edges
  }
}

function sampleKnowledgeTopic(topicId) {
  const id = String(topicId || '')
  const subject = SAMPLE.subjects.find((item) => item.topics.some((topic) => topic[0] === id))
  if (!subject) throw new Error('示例图谱里没有这个知识点。')
  const index = subject.topics.findIndex((topic) => topic[0] === id)
  const [, label, unit, status, description, masteryStandard] = subject.topics[index]
  const link = (topicIndex) => ({ id: subject.topics[topicIndex][0], label: subject.topics[topicIndex][1], gradeLabel: GRADE_LABEL, reason: '' })
  const prerequisiteLinks = subject.edges.filter(([, to]) => to === index).map(([from]) => link(from))
  const successorLinks = subject.edges.filter(([from]) => from === index).map(([, to]) => link(to))
  return {
    id, label, code: id, description, masteryStandard, grade: SAMPLE.grade, gradeLabel: GRADE_LABEL,
    subjectKey: subject.key, subjectName: subject.name, volume: '七年级上册', unit, status, statusLabel: '',
    evidence: evidenceText(status), evidenceRecords: [], prerequisiteLinks, successorLinks, relatedLinks: [],
    prerequisites: prerequisiteLinks.map((item) => item.label).join('、') || '来源未列出前置知识'
  }
}

module.exports = { sampleKnowledgeMap, sampleKnowledgeTopic, isSampleTopicId }
