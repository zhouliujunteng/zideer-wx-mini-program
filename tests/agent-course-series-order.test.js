const assert = require('node:assert/strict')
const test = require('node:test')

// 系列课按顺序学（2026-10-15 用户规则）：课程服务带上 lock，卡片、课程详情页显示待解锁、点进去先学上一节。
const { normalizeAgentCourse, agentCourseCard, agentCourseDetail } = require('../utils/agent-course-view')

function raw(overrides = {}) {
  return {
    stageId: 'stage-lesson2',
    title: '同分母分数加法',
    status: 'completed',
    progress: { total: 1, done: 1, percent: 100 },
    pages: [{ order: 1, title: '讲解', type: 'slide', status: 'done', sceneId: 'scene_1' }],
    canLearn: true,
    series: { id: 'folder-a', title: '分数加减法' },
    learning: { completed: 0, total: 1, allRecorded: false },
    createdAt: '2026-10-15T00:00:00.000Z',
    ...overrides
  }
}

const LOCK = { locked: true, previous: { stageId: 'stage-lesson1', title: '认识分数' } }

test('a locked lesson tells the student which lesson to finish first', () => {
  const course = normalizeAgentCourse(raw({ lock: LOCK }))
  assert.deepEqual(course.lock, { previousStageId: 'stage-lesson1', previousTitle: '认识分数' })
  const card = agentCourseCard(course)
  assert.equal(card.locked, true)
  assert.equal(card.tag, '待解锁')
  assert.equal(card.subtitle, '先学完「认识分数」')
  const detail = agentCourseDetail(course, null)
  assert.equal(detail.statusPill, '待解锁')
  assert.equal(detail.learnAction, '去学上一节')
  assert.equal(detail.lock.previousStageId, 'stage-lesson1')
  assert.match(detail.lock.text, /认识分数.*复述验收/)
  assert.equal(detail.pages[0].openable, false)
})

test('an unlocked lesson, or a malformed lock, behaves as before', () => {
  for (const lock of [undefined, { locked: true, previous: { stageId: 'bad' } }, { locked: false, previous: LOCK.previous }]) {
    const course = normalizeAgentCourse(raw({ lock }))
    assert.equal(course.lock, null)
    assert.equal(agentCourseCard(course).locked, false)
    assert.notEqual(agentCourseDetail(course, null).learnAction, '去学上一节')
    assert.equal(agentCourseDetail(course, null).lock, null)
  }
})
