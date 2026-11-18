const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeQuestPath, questPathView, nodeTarget, nodePopover, findNode } = require('../utils/quest-path-view')
const { normalizeRound, checkpointRows, creditsLine, roundStage, confirmError } = require('../utils/quest-round-view')

// 续学（2026-11-18 用户要求）：一个目标的课全闯完以后，路径末尾「阶段复测」→ 系统出下一轮方案 → 确认 → 制作

const doneLesson = {
  stageId: 'stage-a',
  title: '第1节 坐标系',
  steps: [
    { key: 'watch', state: 'done', label: '看课' },
    { key: 'practice', state: 'done', label: '互动练习' },
    { key: 'accept', state: 'done', label: '当小老师' }
  ],
  chest: { state: 'opened' }
}
const basePath = (continuation, extra = {}) =>
  normalizeQuestPath({
    stages: [{ id: 'plan-1', kind: 'plan', title: '打基础', lessons: [doneLesson] }],
    current: null,
    stats: { lessons: 1, done: 1 },
    continuation,
    ...extra
  })

test('课都学完了：路径最后多一个「第 2 轮，继续往下学」，当前关就是阶段复测', () => {
  const view = questPathView(basePath({ state: 'start', roundNo: 2, roundId: null, diagnosisId: null, label: '阶段复测', detail: '测一测学过的卡点' }))
  const part = view.parts[view.parts.length - 1]
  assert.equal(part.id, 'part-continuation')
  assert.equal(part.banner, '第 2 轮，继续往下学')
  assert.equal(view.currentId, 'continuation-next')
  assert.equal(view.currentPartId, 'part-continuation')
  const node = findNode(view, 'continuation-next')
  assert.equal(node.glyph, '/assets/quest/search.svg')
  assert.equal(nodePopover(node).action, '开始复测')
  assert.deepEqual(nodeTarget(node), { roundStart: true })
})

test('复测到一半进测评页接着测；方案出好了去确认页', () => {
  const testing = findNode(questPathView(basePath({ state: 'testing', roundNo: 2, roundId: 5, diagnosisId: 30, label: '阶段复测', detail: '测到一半，接着测' })), 'continuation-next')
  assert.equal(nodePopover(testing).action, '接着测')
  assert.equal(nodeTarget(testing).url, '/learning/goal-diagnosis/index?id=30')
  const proposed = findNode(
    questPathView(basePath({ state: 'proposed', roundNo: 2, roundId: 5, diagnosisId: 30, label: '确认下一轮', detail: '', proposal: { title: '打牢函数基础', summary: '', lessons: ['第1节 坐标系', '第2节 图像'] } })),
    'continuation-next'
  )
  assert.equal(nodePopover(proposed).action, '看看方案')
  assert.match(nodePopover(proposed).detail, /2 节课：第1节 坐标系、第2节 图像/)
  assert.equal(nodeTarget(proposed).url, '/learning/quest-round/index?id=5')
})

test('正在排课 / 正在制作只提示，不当当前关；目标达成去定新目标', () => {
  const planning = questPathView(basePath({ state: 'planning', roundNo: 2, roundId: 5, label: '规划下一轮', detail: '正在按你的目标排下一轮课程' }))
  assert.equal(planning.currentId, '')
  const node = findNode(planning, 'continuation-next')
  assert.equal(node.state, 'locked')
  assert.equal(nodePopover(node).note, '正在按你的目标排下一轮课程')
  assert.equal(nodeTarget(node).toast, '正在按你的目标排下一轮课程')
  const achieved = questPathView(basePath({ state: 'achieved', roundNo: 2, roundId: 5, label: '目标达成', detail: '' }))
  const trophy = findNode(achieved, 'continuation-next')
  assert.equal(trophy.glyph, '/assets/quest/trophy.svg')
  assert.equal(achieved.parts[achieved.parts.length - 1].banner, '目标达成')
  assert.equal(nodeTarget(trophy).url, '/learning/learning-goal/index?mode=new')
})

test('前面还有没过的关时，当前关不跳到续学；旧版课程服务没有续学就不画', () => {
  const withCurrent = questPathView(basePath({ state: 'proposed', roundNo: 2, roundId: 5, label: '确认下一轮' }, { current: { stageId: 'stage-a', step: 'accept' } }))
  assert.equal(withCurrent.currentId, 'stage-a-accept')
  const old = questPathView(basePath(undefined))
  assert.equal(old.parts.some((part) => part.id === 'part-continuation'), false)
  assert.equal(normalizeQuestPath({ continuation: { state: 'nonsense' } }).continuation, null)
})

test('确认页：复测结果分三组、积分只是预估、按状态给按钮', () => {
  const round = normalizeRound({
    id: 5,
    roundNo: 2,
    status: 'proposed',
    checkpoint: { resolved: ['正比例函数'], still: ['一次函数的图像'], fresh: [] },
    proposal: { title: '打牢函数基础', summary: '先补坐标系', lessons: [{ title: '第1节 坐标系', focus: '从数轴搭桥' }, { title: '第2节 图像', focus: '描点法' }] },
    credits: { available: 5000, perLesson: [120, 180], total: [240, 360] }
  })
  assert.deepEqual(checkpointRows(round.checkpoint).map((row) => [row.key, row.items]), [
    ['resolved', ['正比例函数']],
    ['still', ['一次函数的图像']]
  ])
  assert.match(creditsLine(round.credits, 2), /每节大约 120–180 积分，2 节约 240–360 积分（只是预估/)
  assert.match(creditsLine({ available: 30, perLesson: null, total: null }, 2), /按实际制作用量扣积分。家庭现有 30 积分/)
  assert.equal(roundStage(round).action, 'confirm')
  assert.equal(roundStage({ status: 'building' }).waiting, true)
  assert.equal(roundStage({ status: 'blocked', blocked: { message: '家庭积分不够了' } }).copy, '家庭积分不够了')
  assert.equal(roundStage({ status: 'achieved' }).action, 'goal')
  assert.deepEqual(confirmError({ code: 'MEMBERSHIP_REQUIRED' }).membership, true)
  assert.deepEqual(confirmError({ code: 'CREDITS_SHORT' }).membership, true)
  assert.equal(confirmError({ message: '网络不好' }).membership, false)
  // 不认识的状态按「正在排课」等
  assert.equal(normalizeRound({ status: 'weird' }).status, 'planning')
})
