const test = require('node:test')
const assert = require('node:assert/strict')
const { buildChild, diagnosisFor } = require('../utils/guardian-dashboard-view')

// 学生看板（设计稿 M50）的界面模型：全部来自后端数据，没有数据的模块不编造
const now = Date.parse('2026-09-25T10:00:00+08:00') // 周五
const relation = {
  student_profile: {
    id: 221, nickname: '小鹿', current_grade: 4, avatar: { url: 'https://cdn/a.png' },
    learning_time_rollups: [
      { period_start: '2026-09-25', effective_seconds: 2280 },
      { period_start: '2026-09-23', effective_seconds: 5400 },
      { period_start: '2026-09-20', effective_seconds: 600 }
    ],
    received_agent_invites: [
      { id: 1, status: 'scheduled', subject_label: '数学', scheduled_online_at: '2026-09-27T19:00+08:00', meeting_minutes: 45, teacher_profile: { display_name: '王' } },
      { id: 2, status: 'closed', subject_label: '数学', scheduled_online_at: '2026-09-24T15:02+08:00', meeting_minutes: 45 },
      { id: 3, status: 'scheduled', subject_label: '数学', scheduled_online_at: '2026-09-22T14:00+08:00' },
      { id: 4, status: 'canceled', subject_label: '英语', scheduled_online_at: '2026-09-26T14:00+08:00' }
    ],
    assessment_mistakes: [{ id: 40, submitted_at: '2026-09-24T15:00:44+08:00', scope_name: '4年级语文 · 上学期 · 摸底诊断', subject_code: 'chi', question_count: 25, wrong_count: 2, wrong: [{ prompt: '下列词语', topic_name: '词语' }, { prompt: '选出正确读音', topic_name: '拼音' }] }],
    topic_learning_reports: [{ id: 1, status: 'ai_evaluated_pending_teacher', generated_at: '2026-09-24T20:00:00+08:00', feynman_acceptance: { knowledge_topic: { display_name: '小数的意义' }, audio_assets: [{ duration_ms: 30000 }, { duration_ms: 8000 }] } }],
    learning_plans: [{ name: '数学基础巩固计划', status: 'active', plan_items: [{ status: 'completed' }, { status: 'available', knowledge_topic: { display_name: '小数比较' } }, { status: 'locked' }] }]
  }
}

test('learning stats use today and this Monday-to-today week from the daily rollups', () => {
  const child = buildChild(relation, now)
  assert.equal(child.grade, '小学四年级')
  assert.deepEqual(child.learning.statCards.map((card) => [card.value, card.valueUnit || '', card.suffixValue || '', card.unit]), [['38', '', '', '分钟'], ['2', '小时', '8', '分钟']])
  assert.deepEqual(child.learning.subjects.map((subject) => [subject.title, subject.statusLabel]), [['数学', '近期学习'], ['语文', '近期学习']])
})

test('the plan shows real progress and the schedule only upcoming, uncancelled appointments', () => {
  const child = buildChild(relation, now)
  assert.deepEqual(child.plan, { title: '数学基础巩固计划', detail: '已完成 1/3 项 · 下一项：小数比较' })
  assert.equal(child.schedule.course, '数学陪跑课')
  assert.equal(child.schedule.detail, '9月27日 周日 19:00 · 预计 45 分钟 · 王老师')
  const empty = buildChild({ student_profile: { id: 2 } }, now)
  assert.equal(empty.plan, null)
  assert.equal(empty.schedule, null)
  assert.deepEqual(empty.learning.subjects, [])
})

test('diagnosis for a day lists that day\'s mistakes, records and acceptances; no homework section', () => {
  const child = buildChild(relation, now)
  const day = diagnosisFor(child, '2026-09-24')
  assert.equal(day.selectedDateLabel, '9月24日 周四')
  assert.deepEqual(day.sections.map((section) => section.title), ['错题动态', '学习记录', '验收记录'])
  const [mistakes, records, acceptance] = day.sections
  assert.deepEqual(mistakes.rows.map((row) => [row.number, row.title, row.detail]), [['01', '下列词语', '语文 · 词语'], ['02', '选出正确读音', '语文 · 拼音']])
  assert.equal(mistakes.summary, '当日新增 2 道错题')
  assert.deepEqual(records.rows.map((row) => row.title), ['数学陪跑课', '完成4年级语文 · 上学期 · 摸底诊断'])
  assert.deepEqual(acceptance.rows.map((row) => [row.title, row.statusLabel]), [['小数的意义', '待核验']])
  assert.equal(day.audioDuration, '00:38')

  const today = diagnosisFor(child)
  assert.equal(today.selectedDateLabel, '今天 · 9月25日 周五')
  assert.deepEqual(today.sections[1].rows.map((row) => row.detail), ['当日累计 38 分钟'])
  assert.equal(today.sections[2].rows.length, 0)
  assert.equal(today.audioDuration, '')
})
