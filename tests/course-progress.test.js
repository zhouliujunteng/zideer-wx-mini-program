const assert = require('node:assert/strict')
const test = require('node:test')
const { courseTaskProgress, courseGenerationState } = require('../utils/course-state')

test('generated and learned are separate: ready content is generated, not completed learning', () => {
  const value = courseTaskProgress({ status: 'ready', contentVersionRef: 'saved' }, null, 'available')
  assert.equal(value.progress, 100)
  assert.equal(value.progressText, '已生成')
  assert.equal(value.progressLabel, '待学习')
  assert.equal(courseTaskProgress({ status: 'in_progress', contentVersionRef: 'saved', learningProgress: 35 }, null, 'available').progressText, '35%')
})

test('generation displays the real server percentage, no fabricated percentage during missing data', () => {
  const course = { status: 'planned', generationJob: { status: 'queued', progress: 67, stage: 'generating_scenes' } }
  assert.equal(courseTaskProgress(course, null, 'available').progress, 67)
  assert.equal(courseTaskProgress(course, null, 'available').progressLabel, '生成中')
  assert.equal(courseGenerationState(course, null, 'available').detail, '正在生成课程内容，生成进度 67%。')
  assert.equal(courseTaskProgress({ status: 'planned', generationJob: { status: 'queued' } }, null, 'available').progressText, '排队中')
  assert.equal(courseTaskProgress({ status: 'planned', generationJob: { status: 'generating', progressSyncFailed: true } }, null, 'available').progressText, '同步中')
})

test('a server completion never grants access until the course is settled and ready', () => {
  const course = { status: 'planned', generationJob: { status: 'queued', progress: 100, stage: 'completed' } }
  assert.equal(courseTaskProgress(course, null, 'available').progress, 99)
  assert.equal(courseGenerationState(course, null, 'available').canLaunch, false)
  assert.equal(courseTaskProgress({ status: 'voided_credit_limit' }, null, 'available').progressText, '已作废')
})
