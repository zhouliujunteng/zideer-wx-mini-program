const test = require('node:test')
const assert = require('node:assert/strict')
const { PLAN_TOOL_NAME, buildCoursePlanCard, coursePlanRecordText } = require('../utils/course-plan-card')

// 诊断室「课程安排」卡片：propose_course_plan 登记的方案原样摆给学生（2026-10-04 线上实测学生从没见过大纲）。
const args = {
  seriesTitle: '两位数退位减法过关',
  findings: '你在「个位不够减」上还不稳，第 2 节多加两页',
  lessons: [
    { lesson: 1, title: '估算先行', knowledgePoint: '用估算判断得数是否合理', outline: '第1页 凑整估算；第2页 估一估再算', prerequisites: ['整十数加减'] },
    { lesson: 2, title: '个位不够减怎么办', knowledgePoint: '退位减法', outline: '第1页 借1当10；第2页 竖式退位', prerequisites: ['数位', ' '] }
  ]
}

test('the tool name matches the course service gate', () => {
  assert.equal(PLAN_TOOL_NAME, 'propose_course_plan')
})

test('a registered plan becomes a card with the series and every lesson outline', () => {
  const card = buildCoursePlanCard(args, { id: 'plan-c1' })
  assert.equal(card.kind, 'plan')
  assert.equal(card.id, 'plan-c1')
  assert.equal(card.label, '课程安排')
  assert.equal(card.title, '两位数退位减法过关')
  assert.equal(card.countText, '共 2 节')
  assert.equal(card.findings, args.findings)
  assert.deepEqual(card.lessons.map((lesson) => lesson.numberText), ['第1节', '第2节'])
  assert.equal(card.lessons[1].point, '退位减法')
  assert.equal(card.lessons[1].outline, '第1页 借1当10；第2页 竖式退位')
  // 空白的前置知识点不显示
  assert.equal(card.lessons[1].prerequisitesText, '数位')
})

test('a later plan in the same meeting is labelled as the revised one', () => {
  assert.equal(buildCoursePlanCard(args, { id: 'plan-c2', revised: true }).label, '调整后的课程安排')
})

test('no lessons, no card', () => {
  assert.equal(buildCoursePlanCard({ seriesTitle: 'x', lessons: [] }), null)
  assert.equal(buildCoursePlanCard(null), null)
  assert.equal(buildCoursePlanCard({ lessons: [{ lesson: 1 }] }), null)
})

test('the meeting record carries the whole plan as text for the teacher', () => {
  const text = coursePlanRecordText(buildCoursePlanCard(args, { id: 'plan-c1' }))
  assert.match(text, /^【课程安排】两位数退位减法过关（共 2 节）/)
  assert.match(text, /第2节 个位不够减怎么办｜知识点：退位减法/)
  assert.match(text, /要用到：整十数加减/)
})
