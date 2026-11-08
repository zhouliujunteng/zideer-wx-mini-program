const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const { normalizeAgentCourse, agentCourseCard, acceptanceEntry } = require('../utils/agent-course-view')

const raw = (extra = {}) => ({ stageId: 'stage-abc123', title: '约分与通分', status: 'completed', canLearn: true, progress: { total: 3, done: 3, percent: 100 }, pages: [], ...extra })

test('acceptance lives on the course page, not on the my-courses card', () => {
  const entry = (extra) => acceptanceEntry(normalizeAgentCourse(raw(extra)))
  assert.deepEqual([entry({}).available, entry({}).label], [true, ''])
  assert.equal(entry({ acceptanceStatus: 'pending_teacher' }).label, '待老师核验')
  assert.equal(entry({ acceptanceStatus: 'teacher_passed' }).label, '已通过')
  // 未知状态按「未开始」处理；还没做好的课程没有验收入口
  assert.equal(entry({ acceptanceStatus: 'hacked' }).acceptanceStatus, 'not_started')
  assert.equal(entry({ status: 'generating', canLearn: false }).available, false)
  // 卡片只在副标题里带验收进度，不再有按钮字段
  const card = agentCourseCard(normalizeAgentCourse(raw({ acceptanceStatus: 'pending_teacher' })))
  assert.equal(card.subtitle, '待老师核验')
  assert.equal('acceptanceAction' in card, false)
})

test('my-courses opens the course page; learning and 去验收 are the two entries there', () => {
  const learning = readFileSync(require.resolve('../pages/learning/index.wxml'), 'utf8')
  assert.doesNotMatch(learning, /openAcceptance|学完去验收/)
  const coursePage = readFileSync(require.resolve('../learning/agent-course/index.wxml'), 'utf8')
  // 学习按钮的文字按学习进度：开始学习 / 继续学习 / 再次学习（读不到进度时「学习课程」），见 agentCourseDetail
  assert.match(coursePage, /bindtap="startLearning"[^>]*>\{\{detail\.learnAction\}\}/)
  assert.match(coursePage, /bindtap="openAcceptance"[^>]*>[\s\S]*?去验收/)
  const script = readFileSync(require.resolve('../learning/agent-course/index.js'), 'utf8')
  assert.match(script, /\/learning\/agent-acceptance\/index\?stageId=/)
})

test('teacher review requires a reason before sending a course back', () => {
  const page = readFileSync(require.resolve('../teacher/course-acceptance/index.js'), 'utf8')
  assert.match(page, /requestRemediation\(\) \{\s*if \(!this\.data\.note\.trim\(\)\)/)
  const template = readFileSync(require.resolve('../teacher/course-acceptance/index.wxml'), 'utf8')
  // 只有「待老师核验」才出现核验按钮
  assert.match(template, /wx:if="\{\{acceptance\.status === 'pending_teacher'\}\}" class="review-card surface review-actions"/)
})

test('both acceptance pages render skeletons before the first read', () => {
  for (const page of ['../learning/agent-acceptance/index.wxml', '../teacher/course-acceptance/index.wxml']) {
    const template = readFileSync(require.resolve(page), 'utf8')
    assert.match(template, /wx:if="\{\{!loaded && !loadFailed\}\}"/, page)
    assert.match(template, /class="sk /, page)
  }
})
