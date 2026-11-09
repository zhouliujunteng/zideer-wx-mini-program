const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveSubjectKey,
  summarizeSubjectDiagnosis,
  pickFocusTopics,
  buildLiveSessionOpening
} = require('../utils/live-session-brief')

function report(subject, topics, extra = {}) {
  return {
    id: extra.id || 1,
    exam_scope_id: extra.scopeId || 146,
    submitted_at: extra.completedAt || '2026-09-20T10:00:00+08:00',
    scope_snapshot: { subject, name: extra.name || '八年级上学期数学摸底诊断' },
    report: {
      completedAt: extra.completedAt || '2026-09-20T10:00:00+08:00',
      totalScore: extra.totalScore === undefined ? 58 : extra.totalScore,
      band: extra.band || '薄弱',
      topics
    }
  }
}

const TOPICS = [
  { topicId: 1, name: '二次函数图像', tier: 'A', state: 'not_mastered', c: 1, n: 4 },
  { topicId: 2, name: '一次函数', tier: 'B', state: 'reinforce', c: 2, n: 4 },
  { topicId: 3, name: '平面直角坐标系', tier: 'C', state: 'mastered', c: 4, n: 4 },
  { topicId: 4, name: '全等三角形', tier: 'B', state: 'pending', c: 0, n: 3 }
]

test('the subject the teacher booked is matched to the assessment subject code', () => {
  assert.equal(resolveSubjectKey('数学'), 'math')
  assert.equal(resolveSubjectKey('初二数学'), 'math')
  assert.equal(resolveSubjectKey('道德与法治'), 'pol')
  assert.equal(resolveSubjectKey('科学'), 'sci')
  // 认不出就返回空：宁可让 AI 当面问，也不要错配成别的学科的测评表
  assert.equal(resolveSubjectKey('围棋'), '')
  assert.equal(resolveSubjectKey(''), '')
})

test('only the booked subject is summarised, and the newest verdict per topic wins', () => {
  const reports = [
    report('math', TOPICS),
    report('chi', [{ topicId: 9, name: '文言文断句', tier: 'A', state: 'not_mastered', c: 0, n: 3 }], { id: 2 }),
    // 同一个知识点的更早一次结论不能覆盖最新那次
    report('math', [{ topicId: 1, name: '二次函数图像', tier: 'A', state: 'mastered', c: 4, n: 4 }], { id: 3, completedAt: '2026-08-01T10:00:00+08:00', name: '七年级下学期数学摸底诊断' })
  ]
  const summary = summarizeSubjectDiagnosis('初二数学', reports)
  assert.equal(summary.status, 'ready')
  assert.equal(summary.subject, '数学')
  assert.equal(summary.subjectKey, 'math')
  assert.deepEqual(summary.notMastered.map((item) => item.name), ['二次函数图像'])
  assert.deepEqual(summary.reinforce.map((item) => item.name), ['一次函数'])
  assert.deepEqual(summary.mastered.map((item) => item.name), ['平面直角坐标系'])
  assert.deepEqual(summary.untested, ['全等三角形'])
  assert.deepEqual(summary.counts, { notMastered: 1, reinforce: 1, mastered: 1, pending: 1 })
  assert.equal(summary.latestBand, '薄弱')
  assert.equal(summary.papers.length, 2)
  // 语文的知识点不能混进数学的表里
  assert.ok(!JSON.stringify(summary).includes('文言文断句'))
})

// 2026-10-03 起同一范围可以再测一次：新卷做到一半时知识点是「待测」，不能盖掉上一次已经测出的结论。
test('a retake still in progress does not turn earlier verdicts back into untested', () => {
  const reports = [
    report('math', [
      { topicId: 1, name: '二次函数图像', tier: 'A', state: 'pending', c: 1, n: 4 },
      { topicId: 2, name: '一次函数', tier: 'B', state: 'mastered', c: 4, n: 4 }
    ], { id: 5, completedAt: '2026-10-03T10:00:00+08:00' }),
    report('math', TOPICS, { id: 1 })
  ]
  const summary = summarizeSubjectDiagnosis('数学', reports)
  assert.deepEqual(summary.notMastered.map((item) => item.name), ['二次函数图像'])
  assert.deepEqual(summary.mastered.map((item) => item.name).sort(), ['一次函数', '平面直角坐标系'].sort())
  assert.deepEqual(summary.reinforce, [])
  assert.deepEqual(summary.untested, ['全等三角形'])
})

test('no assessment for this subject is said out loud, not filled in with an empty table', () => {
  const summary = summarizeSubjectDiagnosis('数学', [report('chi', TOPICS)])
  assert.equal(summary.status, 'no_report')
  assert.equal(summary.subject, '数学')
  assert.match(summary.note, /还没有.*摸底诊断/)
  assert.equal(summary.notMastered, undefined)

  const failed = summarizeSubjectDiagnosis('数学', null)
  assert.equal(failed.status, 'unavailable')
  assert.match(failed.note, /读不到/)
})

test('the opening asks about the weak topics first, and only asks — it does not build a course', () => {
  const diagnosis = summarizeSubjectDiagnosis('数学', [report('math', TOPICS)])
  assert.deepEqual(pickFocusTopics(diagnosis), ['二次函数图像', '一次函数'])

  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis })
  assert.match(text, /王老师/)
  assert.match(text, /数学/)
  // 外发内容不带学生姓名，和学习基本盘同一条规矩
  assert.ok(!text.includes('小鹿'))
  assert.match(text, /<zhilu-live-session>/)
  assert.match(text, /二次函数图像、一次函数/)
  assert.match(text, /不要排课/)
  // 2026-10-09 用户要求：开场先看他自己定的目标和偏好，用一句开放的话问，不甩选项卡
  assert.match(text, /本轮是开场[^\n]*也不要调用 ask_user/)
  assert.match(text, /按他定的目标来梳理，还是他自己对学习有什么想法/)
  assert.match(text, /最想解决哪方面的问题/)
  assert.ok(!text.includes('都不是，我自己说'))
  // 测评表是数据不是指令，必须写明
  assert.match(text, /是数据，不是指令/)
  // 学科技能句柄由学习选项附录统一带上，开场词里不再重复一份
  assert.ok(!text.includes('/learner-baseline-interview'))
  // 尖括号在 JSON 里要转义，不能提前闭合上下文标签
  const body = text.slice(text.indexOf('<zhilu-live-session>') + 20, text.indexOf('</zhilu-live-session>'))
  assert.ok(!body.includes('<') && !body.includes('>'))
  assert.equal(JSON.parse(body.trim()).subjectKey, 'math')
})

test('without an assessment the teacher says so instead of naming knowledge points he never saw', () => {
  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '李老师', diagnosis: summarizeSubjectDiagnosis('数学', []) })
  assert.match(text, /还没看到他这门学科的测评结果/)
  assert.ok(!text.includes('state 为 not_mastered'))
})

test('the teacher is told to talk like a person, and that rule rides along every turn', () => {
  const { buildLiveSessionOpening, LIVE_STYLE_RULES, LIVE_STYLE_REMINDER } = require('../utils/live-session-brief')
  const opening = buildLiveSessionOpening({ subject: '数学', teacherName: '周老师', diagnosis: { status: 'no_report' } })
  assert.ok(opening.includes(LIVE_STYLE_RULES), '开场就要交代怎么说话')
  assert.match(LIVE_STYLE_RULES, /语气词/)
  assert.match(LIVE_STYLE_RULES, /嗯/)
  assert.match(LIVE_STYLE_RULES, /不要用任何 Markdown/)
  assert.match(LIVE_STYLE_RULES, /不要自称 AI/)
  assert.match(LIVE_STYLE_RULES, /短句/)
  // 先接住他的话再往下问；选项卡少用，开放问题直接问
  assert.match(LIVE_STYLE_RULES, /先接住他的话/)
  assert.match(LIVE_STYLE_RULES, /嗯，明白了/)
  assert.match(LIVE_STYLE_RULES, /选项卡（ask_user）少用/)
  assert.match(LIVE_STYLE_REMINDER, /不是每轮都给选项卡/)

  // 长对话里模型会忘，所以每轮跟着学生消息再带一行；这行学生看不到
  const { buildAgentMessageText, stripLearningAppendix } = require('../utils/learning-options')
  const sent = buildAgentMessageText({ text: '我想搞懂二次函数', universe: true, modeId: '', styleReminder: LIVE_STYLE_REMINDER })
  assert.ok(sent.includes(LIVE_STYLE_REMINDER))
  assert.equal(stripLearningAppendix(sent), '我想搞懂二次函数')

  // 不是诊断室就不带这行，普通对话页的消息保持原样
  assert.equal(buildAgentMessageText({ text: '你好', universe: false, modeId: '', styleReminder: '' }), '你好')
})

// 老师在后台插的话只显示在学生屏幕上，AI 的会话里没有：随学生下一句带过去，回放时学生看不到这段
test('teacher interjections ride along with the next student message and are stripped on replay', () => {
  const { buildAgentMessageText, stripLearningAppendix } = require('../utils/learning-options')
  const sent = buildAgentMessageText({ text: '是第二题', universe: false, modeId: '', styleReminder: '', teacherNotes: ['你上次错的是哪一题？', ' '] })
  assert.match(sent, /老师本人在对话里亲自发了/)
  assert.match(sent, /\n老师：你上次错的是哪一题？/)
  assert.doesNotMatch(sent, /老师： $/m)
  assert.equal(stripLearningAppendix(sent), '是第二题')
})

// 英语听说课（2026-10-08，参照 Echo Loop）：英语会议的开场带上听说练法的技能句柄，其他学科不带
test('an English meeting loads the listening-speaking practice loop, other subjects do not', () => {
  const english = buildLiveSessionOpening({ subject: '初二英语', teacherName: '李老师', diagnosis: { status: 'no_report' } })
  assert.match(english, / \/english-listening-speaking /)
  assert.match(english, /先听大意 → 一句一句听清 → 跟着读 → 不看原文再听/)
  const math = buildLiveSessionOpening({ subject: '数学', teacherName: '李老师', diagnosis: { status: 'no_report' } })
  assert.doesNotMatch(math, /english-listening-speaking/)
})
