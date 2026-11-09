const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

// 学生的个性化学习偏好（2026-10-07 用户需求）：宇宙页入口 → 学习偏好页；诊断会议的老师定制课程前
// 先读学习宇宙和学习偏好（随学习基本盘附在开场词后面）。
const {
  toggleChoice,
  decorateGroups,
  previewLines,
  sameChoices,
  summaryText,
  normalizePreferenceView
} = require('../utils/learning-preference')
const { summarizeLearningPreference } = require('../utils/learner-baseline')
const { buildLiveSessionOpening } = require('../utils/live-session-brief')
const { buildAgentMessageText } = require('../utils/learning-options')

// 与课程服务 /api/learn/learning-preference 回包同形
const VIEW = {
  status: 'set',
  catalog: {
    noteLimit: 300,
    notePlaceholder: '比如……',
    groups: [
      { id: 'explain', title: '怎么讲我更容易懂', hint: '最多选 3 项', max: 3, options: [
        { id: 'life', label: '多举生活例子', prompt: '多用生活里的例子。' },
        { id: 'visual', label: '多画图多演示', prompt: '能画图就画图。' },
        { id: 'why-first', label: '先讲为什么', prompt: '先讲道理。' },
        { id: 'story', label: '用故事或问题引入', prompt: '用故事开头。' }
      ] },
      { id: 'pace', title: '讲课节奏', hint: '选 1 项', max: 1, options: [
        { id: 'slow', label: '慢一点，步骤拆细', prompt: '讲慢一点。' },
        { id: 'fast', label: '快一点，直奔难点', prompt: '快一点。' }
      ] }
    ]
  },
  preference: { choices: { explain: ['visual', 'gone'], pace: ['slow'], retired: ['x'] }, note: '容易粗心', updatedAt: '2026-10-07T08:00:00.000Z' },
  labels: ['多画图多演示', '慢一点，步骤拆细'],
  text: '【学生的学习偏好】……'
}

test('the saved preference is cleaned against the catalog the service sent', () => {
  const view = normalizePreferenceView(VIEW)
  assert.deepEqual(view.choices, { explain: ['visual'], pace: ['slow'] })
  assert.equal(view.note, '容易粗心')
  assert.equal(view.status, 'set')
  assert.equal(normalizePreferenceView({ catalog: VIEW.catalog, preference: null, status: 'empty' }).status, 'empty')
})

test('single-choice groups swap, multi-choice groups stop at their limit', () => {
  const { catalog } = normalizePreferenceView(VIEW)
  let choices = {}
  choices = toggleChoice(catalog, choices, 'pace', 'slow').choices
  choices = toggleChoice(catalog, choices, 'pace', 'fast').choices
  assert.deepEqual(choices.pace, ['fast'])
  assert.equal(toggleChoice(catalog, choices, 'pace', 'fast').choices.pace, undefined)

  ;['story', 'life', 'visual'].forEach((id) => { choices = toggleChoice(catalog, choices, 'explain', id).choices })
  assert.deepEqual(choices.explain, ['life', 'visual', 'story'])
  const full = toggleChoice(catalog, choices, 'explain', 'why-first')
  assert.equal(full.full, true)
  assert.equal(full.max, 3)
  assert.deepEqual(full.choices.explain, ['life', 'visual', 'story'])
  assert.equal(toggleChoice(catalog, choices, 'explain', 'nope').full, false)
})

test('options carry a selected flag for WXML and the preview shows the built-in prompts', () => {
  const { catalog } = normalizePreferenceView(VIEW)
  const groups = decorateGroups(catalog, { explain: ['visual'] })
  assert.deepEqual(groups[0].options.map((option) => option.selected), [false, true, false, false])
  assert.equal(groups[0].selectedCount, 1)
  assert.deepEqual(previewLines(catalog, { pace: ['slow'], explain: ['life', 'visual'] }, ' 多提醒我检查 '), [
    { id: 'explain', title: '怎么讲我更容易懂', text: '多用生活里的例子。能画图就画图。' },
    { id: 'pace', title: '讲课节奏', text: '讲慢一点。' },
    { id: 'note', title: '我还想说', text: '多提醒我检查' }
  ])
  assert.equal(sameChoices({ pace: ['slow'] }, { pace: ['slow'] }), true)
  assert.equal(sameChoices({ pace: ['slow'] }, {}), false)
})

test('the universe entry summarises up to three choices', () => {
  assert.equal(summaryText(['多举生活例子', '先讲为什么']), '多举生活例子、先讲为什么')
  assert.equal(summaryText(['a', 'b', 'c', 'd', 'e']), 'a、b、c 等 5 项')
  assert.equal(summaryText([], '我容易粗心'), '已写下补充说明')
  assert.equal(summaryText([], ''), '')
})

test('the learner baseline carries the preference, and says so when it could not be read', () => {
  assert.deepEqual(summarizeLearningPreference(VIEW), { status: 'set', labels: VIEW.labels, text: VIEW.text })
  assert.equal(summarizeLearningPreference({ status: 'empty' }).status, 'empty')
  assert.equal(summarizeLearningPreference(null).status, 'unavailable')

  const text = buildAgentMessageText({
    text: '开场',
    universe: true,
    baseline: { status: 'ready', subjects: [], learningPreference: summarizeLearningPreference(VIEW) },
    attachOptions: true,
    attachBaseline: true
  })
  assert.match(text, /<zhilu-learner-context>/)
  assert.match(text, /"learningPreference":\{"status":"set"/)
})

test('the diagnosis meeting opening tells the teacher to read the universe and the preference before planning', () => {
  const opening = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report' } })
  assert.match(opening, /<zhilu-learner-context>/)
  assert.match(opening, /learningPreference/)
  assert.match(opening, /学习宇宙/)
  assert.match(opening, /「学习偏好」里存下来/)
  // 多选答案回放时按「、」拆开还原所选项：问学习方式的选项名里不能有「、」
  const options = opening.match(/选项用这几个：(.+?)，最后加「都可以」/)[1].match(/「[^」]+」/g)
  assert.ok(options.length >= 5)
  options.forEach((option) => assert.doesNotMatch(option, /、/))
})

test('the universe tab links to the preference page, which is registered and hidden from guardians', () => {
  const app = JSON.parse(readFileSync(require.resolve('../app.json'), 'utf8'))
  assert.ok(app.subpackages.find((item) => item.root === 'learning').pages.includes('learning-preference/index'))
  const universe = readFileSync(require.resolve('../pages/knowledge-universe/index.js'), 'utf8')
  const template = readFileSync(require.resolve('../pages/knowledge-universe/index.wxml'), 'utf8')
  assert.match(universe, /\/learning\/learning-preference\/index/)
  assert.match(universe, /\/learning\/learning-goal\/index/)
  assert.match(template, /wx:if="\{\{!guardianAccount\}\}"/)
  assert.match(template, /老师备课先看/)
  // 首次读到之前只画骨架，不先显示「还没定 / 还没设置」
  assert.match(template, /planState === 'ready'[\s\S]*还没定[\s\S]*wx:else class="sk/)
  assert.match(template, /planState === 'ready'[\s\S]*还没设置[\s\S]*wx:else class="sk/)
})

test('the preference page draws skeletons before the catalog arrives and never calls methods in WXML', () => {
  const template = readFileSync(require.resolve('../learning/learning-preference/index.wxml'), 'utf8')
  const styles = readFileSync(require.resolve('../learning/learning-preference/index.wxss'), 'utf8')
  // 偏好是学生自己编辑的：读不到也照样能选（顶部提示可重新读取），不再整页报错
  assert.doesNotMatch(template, /state === 'failed'/)
  assert.match(template, /state === 'ready'[\s\S]*readFailed[\s\S]*class="sk/)
  assert.match(styles, /@import "\.\.\/\.\.\/styles\/skeleton\.wxss"/)
  assert.match(styles, /@import "\.\.\/\.\.\/styles\/learning-plan-form\.wxss"/)
  ;(template.match(/\{\{[^}]*\}\}/g) || []).forEach((expression) => assert.doesNotMatch(expression, /\.\w+\(/, expression))
})

test('the preference page falls back to the built-in catalog when the saved preference cannot be read', () => {
  const { FALLBACK_CATALOG } = require('../utils/learning-preference')
  const view = normalizePreferenceView(null)
  assert.equal(view.status, 'empty')
  assert.deepEqual(view.catalog.groups.map((group) => group.id), ['explain', 'pace', 'practice', 'tone'])
  FALLBACK_CATALOG.groups.forEach((group) => group.options.forEach((option) => {
    assert.ok(option.prompt.length > 8)
    assert.doesNotMatch(option.label, /、/)
  }))
})

const {
  normalizeGoalView,
  decorateDirections,
  toggleDirection,
  deadlineText,
  goalPreviewLines,
  goalSummaryText,
  deadlineRange,
  beijingToday
} = require('../utils/learning-goal')
const { summarizeLearningGoal } = require('../utils/learner-baseline')

const GOAL_VIEW = {
  status: 'set',
  today: '2026-10-07',
  catalog: { goalLimit: 200, goalPlaceholder: '比如……', maxDays: 1098, directions: [{ id: 'exam', label: '提高考试成绩' }, { id: 'weak', label: '补上薄弱知识点' }] },
  goal: { direction: 'exam', goal: '期末数学考到 90 分', deadline: '2026-10-17', updatedAt: '2026-10-07T08:00:00Z' },
  summary: '期末数学考到 90 分',
  text: '【学生的学习目标】……'
}

test('the learning goal view cleans the saved goal and falls back to built-in directions', () => {
  const view = normalizeGoalView(GOAL_VIEW)
  assert.equal(view.direction, 'exam')
  assert.equal(view.deadline, '2026-10-17')
  assert.equal(goalSummaryText(view), '期末数学考到 90 分')
  assert.equal(require('../utils/learning-goal').goalDeadlineTag(view), '还有 10 天')
  assert.equal(require('../utils/learning-goal').goalDeadlineTag({ ...view, today: '2026-11-01' }), '已过期')
  const fallback = normalizeGoalView(null)
  assert.equal(fallback.status, 'empty')
  assert.equal(fallback.catalog.directions.length, 6)
  fallback.catalog.directions.forEach((item) => assert.doesNotMatch(item.label, /、/))
  assert.equal(goalSummaryText(fallback), '')
  assert.equal(goalSummaryText(normalizeGoalView({ ...GOAL_VIEW, goal: { direction: 'weak', goal: '', deadline: '' } })), '补上薄弱知识点')
})

test('the goal page previews what the teacher sees and only offers dates from today', () => {
  const { catalog } = normalizeGoalView(GOAL_VIEW)
  assert.deepEqual(decorateDirections(catalog, 'weak').map((item) => item.selected), [false, true])
  assert.equal(toggleDirection('weak', 'weak'), '')
  assert.equal(toggleDirection('weak', 'exam'), 'exam')
  assert.deepEqual(goalPreviewLines(catalog, { direction: 'exam', goal: ' 期末 90 分 ', deadline: '2026-10-07' }, '2026-10-07'), [
    { id: 'direction', title: '目标方向', text: '提高考试成绩' },
    { id: 'goal', title: '具体目标', text: '期末 90 分' },
    { id: 'deadline', title: '希望完成时间', text: '2026-10-07（就是今天）' }
  ])
  assert.deepEqual(goalPreviewLines(catalog, { direction: '', goal: '', deadline: '2026-12-01' }, '2026-10-07'), [])
  assert.equal(deadlineText('2026-10-01', '2026-10-07'), '已经过了')
  assert.deepEqual(deadlineRange('2026-10-07', 10), { start: '2026-10-07', end: '2026-10-17' })
  assert.match(beijingToday(Date.parse('2026-10-06T17:00:00Z')), /^2026-10-07$/)
})

test('the learner baseline carries the goal and the opening tells the teacher to read it first', () => {
  assert.deepEqual(summarizeLearningGoal(GOAL_VIEW), { status: 'set', summary: '期末数学考到 90 分', text: '【学生的学习目标】……' })
  assert.equal(summarizeLearningGoal({ status: 'empty' }).status, 'empty')
  assert.equal(summarizeLearningGoal(undefined).status, 'unavailable')
  const opening = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report' } })
  assert.match(opening, /learningGoal/)
  assert.match(opening, /「我的学习目标」里写下来/)
  assert.ok(opening.indexOf('learningGoal.status') < opening.indexOf('learningPreference.status'))
})

test('the goal page is registered, draws skeletons first and lets the student write even when the read fails', () => {
  const app = JSON.parse(readFileSync(require.resolve('../app.json'), 'utf8'))
  assert.ok(app.subpackages.find((item) => item.root === 'learning').pages.includes('learning-goal/index'))
  const template = readFileSync(require.resolve('../learning/learning-goal/index.wxml'), 'utf8')
  assert.match(template, /state === 'ready'[\s\S]*readFailed[\s\S]*class="sk/)
  assert.match(template, /mode="date"/)
  assert.match(template, /<dev-reset-fab \/>/)
  ;(template.match(/\{\{[^}]*\}\}/g) || []).forEach((expression) => assert.doesNotMatch(expression, /\.\w+\(/, expression))
})
