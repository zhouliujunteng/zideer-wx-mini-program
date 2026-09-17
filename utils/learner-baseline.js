/**
 * 学习基本盘摘要：把学习档案 + 知识图谱（全部学科的知识点与掌握证据）压成
 * 课程智能体备课用的紧凑 JSON。纯函数，便于单测。
 *
 * 只带备课需要的字段：年级、学期、教材版本、各学科掌握情况。
 * 不带姓名、学校、地区、手机号等个人信息。
 */

const NAME_LIMIT = 24
// 至少有这么多条已测知识点，才用掌握率推断优势/薄弱学科（偏科）
const MIN_ASSESSED_FOR_TENDENCY = 3

function gradeLabel(grade) {
  const value = Number(grade)
  if (value >= 1 && value <= 6) return `小学${value}年级`
  if (value >= 7 && value <= 9) return `初${value - 6}`
  if (value >= 10 && value <= 12) return `高${value - 9}`
  if (value === 0) return '不限年级'
  return '未设置年级'
}

// 与 identity.js graphStatus 保持一致的分档，再归并为备课用的四类
function masteryBucket(mastery) {
  if (!mastery) return 'untested'
  const status = String(mastery.status || '').toLowerCase()
  if (status === 'unknown' && mastery.lastAssessmentScore !== null && mastery.lastAssessmentScore !== undefined) {
    return Number(mastery.lastAssessmentScore) === 1 ? 'mastered' : 'weak'
  }
  if (['mastered', 'completed', 'passed', 'assessed_stable'].includes(status)) return 'mastered'
  if (['reinforce', 'weak', 'needs_review', 'remedial'].includes(status)) return 'weak'
  if (['learning', 'in_progress', 'planned'].includes(status)) return 'learning'
  return 'untested'
}

function pushName(list, name) {
  if (name && list.length < NAME_LIMIT) list.push(name)
}

function summarizeLearnerBaseline(profile, knowledgeMap) {
  const learner = {
    grade: profile && profile.current_grade !== undefined ? profile.current_grade : null,
    gradeLabel: gradeLabel(profile && profile.current_grade),
    semester: String(profile && profile.semester || ''),
    schoolStage: String(profile && profile.school_stage || ''),
    textbookVersion: String(profile && profile.textbook_version || '')
  }
  if (!knowledgeMap || knowledgeMap.status !== 'ready') {
    return {
      status: profile ? 'profile_only' : 'unavailable',
      learner,
      subjects: [],
      note: '知识点掌握数据暂不可用，请通过摸底提问了解学生水平。'
    }
  }

  const masteryByTopic = {}
  ;(knowledgeMap.masteries || []).forEach((item) => {
    if (item && item.knowledge_topic_id !== undefined) masteryByTopic[String(item.knowledge_topic_id)] = item
  })
  const subjects = (knowledgeMap.subjects || [])
    .slice()
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
    .map((subject) => {
      const summary = {
        name: String(subject.display_name || subject.subject_key || ''),
        topicCount: 0,
        mastered: [],
        weak: [],
        learning: [],
        masteredCount: 0,
        weakCount: 0,
        untestedCount: 0,
        masteryRate: null
      }
      ;(knowledgeMap.topics || [])
        .filter((topic) => String(topic.subject_id) === String(subject.id))
        .forEach((topic) => {
          summary.topicCount += 1
          const name = String(topic.display_name || '').trim()
          const bucket = masteryBucket(masteryByTopic[String(topic.id)])
          if (bucket === 'mastered') { summary.masteredCount += 1; pushName(summary.mastered, name) }
          else if (bucket === 'weak') { summary.weakCount += 1; pushName(summary.weak, name) }
          else if (bucket === 'learning') pushName(summary.learning, name)
          else summary.untestedCount += 1
        })
      const assessed = summary.masteredCount + summary.weakCount
      if (assessed > 0) summary.masteryRate = Math.round(summary.masteredCount / assessed * 100) / 100
      return summary
    })
    .filter((subject) => subject.topicCount > 0)

  const comparable = subjects.filter((subject) => subject.masteredCount + subject.weakCount >= MIN_ASSESSED_FOR_TENDENCY)
  const strongSubjects = comparable.filter((subject) => subject.masteryRate >= 0.8).map((subject) => subject.name)
  const weakSubjects = comparable.filter((subject) => subject.masteryRate < 0.5).map((subject) => subject.name)

  return {
    status: 'ready',
    learner,
    evidenceCount: Number(knowledgeMap.universe && knowledgeMap.universe.evidenceCount || 0),
    subjects,
    strongSubjects,
    weakSubjects,
    note: '掌握数据只覆盖当前年级学期的知识点；低年级前置知识需要摸底确认。未列出名称的知识点没有学习证据。'
  }
}

module.exports = { summarizeLearnerBaseline, masteryBucket, gradeLabel }
