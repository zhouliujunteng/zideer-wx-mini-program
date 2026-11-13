const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeQuestPath, questPathView, nodeTarget, nodePopover, findNode } = require('../utils/quest-path-view')
const { normalizeAgentCourse } = require('../utils/agent-course-view')
const { goalSpecificity } = require('../utils/learning-goal')

// 闯关入门三关 + 免费体验只开放前 3 节（2026-11-11 用户规则）

const ONBOARDING = [
  { key: 'goal', state: 'done', label: '设置学习目标', detail: '期末数学 90 分' },
  { key: 'preference', state: 'done', label: '设置学习偏好', detail: '已设置' },
  { key: 'meeting', state: 'current', label: '进入诊断会议', detail: '11-12 19:00 · 王老师', inviteToken: 'abc_123' }
]

test('入门三关画成路径最上面的「准备开始」部分，当前关在第三关', () => {
  const view = questPathView(normalizeQuestPath({ onboarding: ONBOARDING, stages: [], current: { stageId: 'onboarding', step: 'meeting' }, stats: { lessons: 0, done: 0 } }))
  assert.equal(view.parts[0].id, 'part-onboarding')
  assert.equal(view.parts[0].banner, '入门关卡')
  assert.deepEqual(view.parts[0].nodes.map((node) => node.step), ['goal', 'preference', 'meeting'])
  assert.equal(view.currentId, 'onboarding-meeting')
  assert.equal(view.currentPartId, 'part-onboarding')
  const meeting = findNode(view, 'onboarding-meeting')
  assert.equal(meeting.glyph, '/assets/quest/calendar.svg')
  assert.equal(nodePopover(meeting).action, '进入诊断会议')
  assert.equal(nodeTarget(meeting).url, '/learning/agent-invite/index?token=abc_123')
  assert.equal(nodeTarget(findNode(view, 'onboarding-goal')).url, '/learning/learning-goal/index?from=quest')
  assert.equal(nodePopover(findNode(view, 'onboarding-goal')).action, '修改目标')
})

test('第三关锁着：没有按钮、提示等推广老师约好；没有入门关时照旧', () => {
  const steps = [ONBOARDING[0], ONBOARDING[1], { key: 'meeting', state: 'locked', label: '预约老师诊断会议', detail: '等推广老师帮你约好诊断会议' }]
  const view = questPathView(normalizeQuestPath({ onboarding: steps, stages: [], stats: {} }))
  const meeting = findNode(view, 'onboarding-meeting')
  assert.equal(meeting.glyph, '/assets/quest/lock.svg')
  const pop = nodePopover(meeting)
  assert.equal(pop.action, '')
  assert.equal(pop.note, '等推广老师帮你约好诊断会议')
  assert.equal(nodeTarget(meeting).toast, '等推广老师帮你约好诊断会议')
  const plain = questPathView(normalizeQuestPath({ stages: [], stats: {} }))
  assert.equal(plain.parts.length, 0)
})

test('免费体验第 4 节起：整节锁着、分隔线标「开会员解锁」、说明卡带 paywall', () => {
  const lesson = (n, extra) => ({
    stageId: `stage_${n}`,
    title: `第 ${n} 节`,
    steps: [{ key: 'watch', state: 'locked' }, { key: 'practice', state: 'locked' }, { key: 'accept', state: 'locked' }],
    chest: { state: 'locked' },
    ...extra
  })
  const view = questPathView(normalizeQuestPath({
    stages: [{ id: 's1', title: '函数', lessons: [lesson(3, { locked: true, lockedBy: { stageId: 'stage_2', title: '第 2 节' } }), lesson(4, { locked: true, paywall: true })] }],
    stats: { lessons: 2, done: 0 }
  }))
  assert.equal(view.paywalled, true)
  const paid = view.parts.find((part) => part.stageId === 'stage_4')
  assert.equal(paid.tag, '开会员解锁')
  const watch = paid.nodes.find((node) => node.step === 'watch')
  assert.equal(watch.paywall, true)
  assert.equal(nodePopover(watch).paywall, true)
  assert.equal(nodeTarget(watch).paywall, true)
  const plain = view.parts.find((part) => part.stageId === 'stage_3')
  assert.equal(plain.tag, '')
  assert.equal(nodeTarget(plain.nodes[0]).toast, '先学完「第 2 节」')
})

test('课程列表：lock.paywall 认得出来（previous 可能为空）', () => {
  const course = normalizeAgentCourse({ stageId: 'stage-4', title: '第 4 节', status: 'completed', canLearn: true, percent: 100, lock: { locked: true, paywall: true, previous: { stageId: '', title: '' } } })
  assert.ok(course.lock && course.lock.paywall)
})

test('目标写具体：三条打勾，太笼统的标 vague', () => {
  assert.equal(goalSpecificity('学好数学', '').vague, true)
  const good = goalSpecificity('期末数学考到 90 分以上，函数不再丢分', '')
  assert.equal(good.passed, 3)
  assert.equal(good.vague, false)
  assert.equal(goalSpecificity('英语阅读正确率到八成', '2026-12-30').checks.find((item) => item.id === 'when').ok, true)
  assert.equal(goalSpecificity('', '').vague, false)
})

// 一个学生好几个学习目标（2026-11-13）：学习页左上角的目标入口与下拉面板
test('goal tracks: each goal gets its own flag colour, the current one is marked, at most 8', () => {
  const { goalTracksView } = require('../utils/quest-path-view')
  const path = normalizeQuestPath({
    trackId: 5,
    tracks: [
      { trackId: 3, title: '期末数学 90 分', active: false, lessons: 4 },
      { trackId: 5, title: '英语完形填空不丢分', active: true, lessons: 0 },
      { trackId: 0, title: '坏数据' }
    ]
  })
  const view = goalTracksView(path.tracks)
  assert.deepEqual(view.items.map((item) => [item.trackId, item.tone, item.meta]), [[3, 'orange', '4 节定制课'], [5, 'blue', '还没有定制课程']])
  assert.equal(view.active.trackId, 5)
  assert.equal(view.tone, 'blue')
  assert.equal(view.canAdd, true)
  const full = goalTracksView(Array.from({ length: 8 }, (_, i) => ({ trackId: i + 1, title: `目标${i}`, active: i === 0, lessons: 0 })))
  assert.equal(full.canAdd, false)
  // 旧版课程服务没有目标列表：不显示入口
  assert.equal(goalTracksView(normalizeQuestPath({}).tracks), null)
  assert.equal(goalTracksView([]).addLabel, '定一个学习目标')
})
