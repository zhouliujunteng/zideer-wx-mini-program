const test = require('node:test')
const assert = require('node:assert/strict')
const { guardianCourseSection } = require('../utils/guardian-course-view')

// 家长看板「定制课程」：读到前骨架、读不到重试、读到才可能是空；课多时从正在学的前一节起放 5 节
const steps = (watch, practice, accept) => [
  { key: 'watch', label: '看课', state: watch, detail: '已学完' },
  { key: 'practice', label: '互动练习', state: practice, detail: '6 道小题' },
  { key: 'accept', label: '复述验收', state: accept, detail: '讲给老师听' }
]
const lesson = (n, extra) => ({ stageId: `s${n}`, title: `第${n}节`, stage: '分数', done: false, locked: true, paywall: false, current: false, steps: steps('locked', 'locked', 'locked'), ...extra })

test('loading, failure and empty are told apart', () => {
  assert.deepEqual(guardianCourseSection(undefined), { skeleton: true, failed: false, goals: [] })
  assert.deepEqual(guardianCourseSection({ loaded: false, failed: true }), { skeleton: false, failed: true, goals: [] })
  assert.deepEqual(guardianCourseSection({ loaded: true, goals: [] }).goals, [])
})

test('a goal shows progress, the current lesson and its three steps', () => {
  const goal = { title: '期末数学 90 分', active: true, lessons: 2, done: 1, current: { title: '第2节', step: '互动练习' },
    items: [lesson(1, { done: true, locked: false, steps: steps('done', 'done', 'done') }), lesson(2, { locked: false, current: true, steps: steps('done', 'open', 'locked') })] }
  const [view] = guardianCourseSection({ loaded: true, goals: [goal] }).goals
  assert.equal(view.title, '期末数学 90 分')
  assert.equal(view.progress, '已学完 1/2 节')
  assert.equal(view.current, '正在学：第2节 · 互动练习')
  assert.equal(view.percent, 50)
  assert.deepEqual(view.items.map((item) => [item.title, item.statusText, item.statusTone]), [['第1节', '已学完', 'done'], ['第2节', '正在学', 'current']])
  assert.deepEqual(view.items[1].steps.map((step) => step.tone), ['done', 'open', 'locked'])
})

test('long lists fold around the current lesson and expand on request; several goals are labelled', () => {
  const items = Array.from({ length: 9 }, (_, i) => lesson(i + 1, i < 5 ? { done: true, locked: false } : i === 5 ? { locked: false, current: true } : {}))
  items[8].paywall = true
  const goals = [{ title: '数学', active: true, lessons: 9, done: 5, current: { title: '第6节', step: '看课' }, items }, { title: '英语', active: false, lessons: 1, done: 1, current: null, items: [lesson(1, { done: true })] }]
  const section = guardianCourseSection({ loaded: true, goals })
  assert.deepEqual(section.goals[0].items.map((item) => item.title), ['第5节', '第6节', '第7节', '第8节', '第9节'])
  assert.equal(section.goals[0].hidden, 4)
  assert.equal(section.goals[0].items[4].statusText, '开会员解锁')
  assert.equal(section.goals[0].title, '当前目标：数学')
  assert.equal(section.goals[1].title, '学习目标：英语')
  assert.equal(section.goals[1].current, '全部学完了')
  const expanded = guardianCourseSection({ loaded: true, goals }, { g0: true })
  assert.equal(expanded.goals[0].items.length, 9)
  assert.equal(expanded.goals[0].hidden, 0)
})
