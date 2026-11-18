// 自助诊断会议（2026-11-17）：闯关第三关点了自己开始；学科选择菜单不超过微信的 6 项
const test = require('node:test')
const assert = require('node:assert/strict')
global.wx = global.wx || {}
const { normalizeQuestPath, questPathView, nodeTarget, nodePopover } = require('../utils/quest-path-view')
const { splitSubjects, roomUrl } = require('../utils/self-meeting-entry')

const SUBJECTS = [
  { code: 'math', label: '数学' }, { code: 'chi', label: '语文' }, { code: 'eng', label: '英语' },
  { code: 'phy', label: '物理' }, { code: 'chem', label: '化学' }, { code: 'bio', label: '生物' },
  { code: 'sci', label: '科学' }, { code: 'pol', label: '道德与法治' }, { code: 'his', label: '历史' }, { code: 'geo', label: '地理' }
]

test('第三关带 selfStart：弹窗写「开始诊断会议」，点了走自助开始', () => {
  const path = normalizeQuestPath({
    goal: { title: '期末数学', subject: '' },
    onboarding: [
      { key: 'goal', state: 'done', label: '设置学习目标', detail: '期末数学' },
      { key: 'diagnosis', state: 'done', label: '围绕目标测评', detail: '目标导图已生成' },
      { key: 'meeting', state: 'open', label: '开始诊断会议', detail: '不用约时间，点了直接开始', selfStart: true }
    ],
    stages: [],
    current: { stageId: 'onboarding', step: 'meeting' },
    stats: { lessons: 0, done: 0 }
  })
  const view = questPathView(path)
  const node = view.parts.flatMap((part) => part.nodes).find((item) => item.step === 'meeting')
  assert.equal(node.selfStart, true)
  assert.deepEqual(nodeTarget(node), { selfMeeting: true })
  assert.equal(nodePopover(node).action, '开始诊断会议')
})

test('学科菜单：常用 5 门 + 其他学科，第二层是剩下的', () => {
  const { first, rest } = splitSubjects(SUBJECTS)
  assert.deepEqual(first.map((item) => item.label), ['数学', '语文', '英语', '物理', '化学'])
  assert.equal(rest.length, 5)
  assert.ok(first.length + 1 <= 6 && rest.length <= 6)
})

test('进诊断室带邀请令牌', () => {
  assert.equal(roomUrl('abc123'), '/pages/diagnosis-room/index?inviteToken=abc123')
})
