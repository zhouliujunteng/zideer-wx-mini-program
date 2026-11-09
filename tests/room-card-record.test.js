const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 诊断室的卡片写进会议记录，老师端直播间、旁听家长看到和学生一样的卡片（2026-10-06，更新日志 1.0.3）。

const { encodeRoomCard, decodeRoomCard, questionRecordText, RECORD_MAX } = require('../utils/room-card-record')
const { buildCoursePlanCard, coursePlanRecordText } = require('../utils/course-plan-card')
const { buildTeacherRoomMessages } = require('../services/teacher-room-view')

const PLAN = buildCoursePlanCard({
  seriesTitle: '分数加减法',
  findings: '同分母会算，异分母通分不熟',
  lessons: [
    { lesson: 1, title: '通分', knowledgePoint: '最小公倍数', outline: '先找分母的最小公倍数', prerequisites: ['倍数'] },
    { lesson: 2, title: '异分母分数加法', knowledgePoint: '异分母加法', outline: '通分后相加' }
  ]
}, { id: 'plan-c1' })
const QUESTION = { kind: 'question', id: 'question-9', question: '下面哪些你还没把握？', multiSelect: true, options: [{ id: 'a', label: '通分' }, { id: 'b', label: '约分' }] }

test('a plan card survives the round trip, and its readable text still leads the record', () => {
  const content = encodeRoomCard(coursePlanRecordText(PLAN), PLAN)
  assert.ok(content.length <= RECORD_MAX)
  assert.ok(content.startsWith('【课程安排】分数加减法（共 2 节）'))
  const { text, card } = decodeRoomCard(content)
  assert.equal(text, coursePlanRecordText(PLAN))
  assert.equal(card.kind, 'plan')
  assert.equal(card.title, '分数加减法')
  assert.deepEqual(card.lessons.map((lesson) => [lesson.numberText, lesson.title, lesson.point, lesson.prerequisitesText]), [
    ['第1节', '通分', '最小公倍数', '倍数'], ['第2节', '异分母分数加法', '异分母加法', '']
  ])
})

test('a question card records the question and every option', () => {
  const content = encodeRoomCard(questionRecordText(QUESTION), QUESTION)
  assert.ok(content.startsWith('【多选题】下面哪些你还没把握？\n· 通分\n· 约分'))
  const { card } = decodeRoomCard(content)
  assert.deepEqual(card, { kind: 'question', question: '下面哪些你还没把握？', multiSelect: true, options: [{ id: 'a', label: '通分' }, { id: 'b', label: '约分' }] })
})

test('plain lines, truncated or broken data fall back to the readable text', () => {
  assert.deepEqual(decodeRoomCard('好，我们先从图像开始。'), { text: '好，我们先从图像开始。', card: null })
  const content = encodeRoomCard('【课程安排】x', PLAN)
  // 后端按 4000 字截断时数据断在半截：只显示文字
  assert.deepEqual(decodeRoomCard(content.slice(0, content.length - 5)), { text: '【课程安排】x', card: null })
  // 文字太长时先截短文字、保住卡片数据，整条不超过后端的 4000 字
  const long = encodeRoomCard('字'.repeat(RECORD_MAX), PLAN)
  assert.ok(long.length <= RECORD_MAX)
  assert.equal(decodeRoomCard(long).card.title, '分数加减法')
  // 不认识的卡片只写文字
  assert.equal(encodeRoomCard('普通的一句话', { kind: 'stage' }), '普通的一句话')
})

test('the teacher room draws the cards the student saw, tagged as the AI side', () => {
  const rows = [
    { id: '1', sender: 'ai', kind: 'text', content: encodeRoomCard(questionRecordText(QUESTION), QUESTION), readAt: 'x', createdAt: '2026-10-06T10:00:00+08:00' },
    { id: '2', sender: 'student', kind: 'text', content: '通分', readAt: '', createdAt: '2026-10-06T10:00:10+08:00' },
    { id: '3', sender: 'ai', kind: 'text', content: encodeRoomCard(coursePlanRecordText(PLAN), PLAN), readAt: '', createdAt: '2026-10-06T10:01:00+08:00' }
  ]
  const messages = buildTeacherRoomMessages(rows)
  assert.deepEqual(messages.map((item) => [item.side, item.kind]), [['left', 'question'], ['right', 'text'], ['left', 'plan']])
  assert.equal(messages[0].tag, 'AI 代答')
  assert.deepEqual(messages[0].options.map((option) => option.label), ['通分', '约分'])
  assert.equal(messages[2].lessons.length, 2)
  assert.equal(messages[2].readLabel, '未读')
  const wxml = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxml'), 'utf8')
  assert.match(wxml, /item.kind === 'plan'/)
  assert.match(wxml, /item.kind === 'question'/)
  assert.ok(!/agent-stop-icon/.test(wxml), '老师端发送中不再画「停止」方块')
})
