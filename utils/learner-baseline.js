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

/**
 * 学生在「学习宇宙 › 学习偏好」里自己设置的偏好（课程服务 /api/learn/learning-preference 的回包）→
 * 附进学习基本盘的一段。text 是课程服务按内置提示词拼好的原话，AI 老师照着排课、写每页要求。
 * 读不到时如实标 unavailable，不当成「没设置」。
 */
function summarizeLearningPreference(view) {
  if (!view || (view.status !== 'set' && view.status !== 'empty')) {
    return { status: 'unavailable', note: '学习偏好暂时没读到：会议里问一句他喜欢怎么学。' }
  }
  if (view.status === 'empty') {
    return { status: 'empty', note: '他还没有设置学习偏好。' }
  }
  return {
    status: 'set',
    labels: (Array.isArray(view.labels) ? view.labels : []).map(String).slice(0, 16),
    text: String(view.text || '')
  }
}

/**
 * 学生在「学习宇宙 › 我的学习目标」里自己定的目标（偏好接口回包里的 goal）→ 附进学习基本盘的一段。
 * text 是课程服务拼好的原话（方向、具体目标、完成时间与还剩几天）。读不到如实标 unavailable。
 */
function summarizeLearningGoal(view) {
  if (!view || (view.status !== 'set' && view.status !== 'empty')) {
    return { status: 'unavailable', note: '学习目标暂时没读到：会议里问一句他想达到什么目标。' }
  }
  if (view.status === 'empty') return { status: 'empty', note: '他还没有定学习目标。' }
  return { status: 'set', summary: String(view.summary || ''), text: String(view.text || '') }
}

// 按目标测评的目标导图（2026-10-10 用户规则）：诊断会议开场就交给老师 AI，定纲直接按导图的卡点来，不再从头摸底。
// view = 课程服务 GET /api/learn/goal-diagnosis 的回包。只放知识点名、编号、年级和状态，不含题目与答案。
const GOAL_NODE_STATE = { mastered: '已掌握', shaky: '需巩固', gap: '卡点', root_gap: '根源卡点', pending: '待测', testing: '测了一部分', untested: '暂未测' }
const GOAL_LIST_LIMIT = 12

function summarizeGoalMap(view) {
  if (!view || typeof view !== 'object') return { status: 'unavailable', note: '目标导图暂时没读到：照常摸底。' }
  const diagnosis = view.diagnosis
  if (!diagnosis || !diagnosis.map || diagnosis.status === 'failed' || diagnosis.status === 'planning') {
    return { status: 'none', note: '他还没有按目标测评过。' }
  }
  const nodes = Array.isArray(diagnosis.map.nodes) ? diagnosis.map.nodes : []
  const summary = diagnosis.map.summary || {}
  const topics = {}
  nodes.forEach((node) => {
    if (node.kind !== 'topic' || node.alias || !node.topicId || topics[node.topicId]) return
    topics[node.topicId] = node
  })
  const list = Object.keys(topics).map((id) => topics[id])
  const pick = (states) => list.filter((node) => states.indexOf(node.status) >= 0).slice(0, GOAL_LIST_LIMIT)
  const brief = (node) => ({ id: Number(node.topicId), name: node.label, grade: node.gradeLabel || '' })
  const courses = []
  list.forEach((node) => {
    const titles = (node.courses || []).map((course) => course.title).filter(Boolean)
    if (titles.length) courses.push({ id: Number(node.topicId), name: node.label, courses: titles })
  })
  return {
    status: 'set',
    subject: String(diagnosis.subjectName || ''),
    goal: String((diagnosis.goal && (diagnosis.goal.title || diagnosis.goal.text)) || ''),
    state: diagnosis.status === 'finished' ? '已测完' : diagnosis.status === 'active' ? '测评中' : '测了一部分',
    // 学习目标改过了：这张导图是按旧目标测的，只作参考
    goalChanged: Boolean(view.goalChanged),
    conditions: nodes.filter((node) => node.kind === 'condition').map((node) => ({ title: node.label, state: GOAL_NODE_STATE[node.status] || '' })),
    rootGaps: (summary.rootGaps || []).map((item) => ({ id: Number(item.topicId), name: item.label, grade: item.gradeLabel || '' })),
    studyOrder: (summary.path || []).map((item) => ({ id: Number(item.topicId), name: item.label, root: Boolean(item.root) })),
    gaps: pick(['gap', 'root_gap', 'shaky']).map((node) => Object.assign(brief(node), { state: GOAL_NODE_STATE[node.status] })),
    mastered: pick(['mastered']).map(brief),
    untested: pick(['pending', 'testing', 'untested']).map(brief),
    // 考试类目标：本学期单元测到了几个、还有哪些单元没测（2026-10-11）
    examScope: summary.scope && Number(summary.scope.units)
      ? { label: String(summary.scope.label || ''), units: Number(summary.scope.units), covered: Number(summary.scope.covered) || 0, missing: (summary.scope.missing || []).slice(0, GOAL_LIST_LIMIT) }
      : null,
    // 已经给这些卡点做过的定制课（不要重复排）
    coursesDone: courses.slice(0, GOAL_LIST_LIMIT)
  }
}

module.exports = { summarizeLearnerBaseline, summarizeLearningPreference, summarizeLearningGoal, summarizeGoalMap, masteryBucket, gradeLabel }
