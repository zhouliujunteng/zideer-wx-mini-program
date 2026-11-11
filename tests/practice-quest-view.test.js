const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const {
  normalizePractice, emptyAnswer, responseOf, questionScreen, toggleOrder, tapMatch, feedbackOf, clearSummary, practiceCard, gateReview
} = require('../utils/practice-view')
const { normalizeQuestPath, questPathView, nodeTarget } = require('../utils/quest-path-view')

// 闯关学习（2026-11-11）：互动练习一题一屏（learning/practice）与学习页闯关路径（pages/learning）。

const PRACTICE = normalizePractice({
  stageId: 'stage-a', title: '约分', kind: 'practice', status: 'ready', questionCount: 3,
  questions: [
    { type: 'single', prompt: '题1', options: ['甲', '乙', '丙', '丁'] },
    { type: 'order', prompt: '排一排', options: ['二', '一', '三'] },
    { type: 'match', prompt: '连一连', left: ['2/4', '3/9'], options: ['1/3', '1/2'] }
  ],
  progress: { current: 1, remaining: 2, cleared: 1, streak: 1, bestStreak: 1, answered: 1 }
})

test('practice screens build the response each question type expects', () => {
  const order = PRACTICE.questions[1]
  let answer = emptyAnswer(order)
  answer = toggleOrder(answer, 1)
  answer = toggleOrder(answer, 0)
  assert.equal(questionScreen(PRACTICE, answer).ready, false)
  answer = toggleOrder(answer, 2)
  assert.deepEqual(responseOf(order, answer), [1, 0, 2])
  assert.deepEqual(toggleOrder(answer, 0), [1, 2], '点已排的拿掉')

  const match = PRACTICE.questions[2]
  let pairs = emptyAnswer(match)
  pairs = tapMatch(pairs, 'left', 0)
  pairs = tapMatch(pairs, 'right', 1)
  assert.deepEqual(pairs, { pairs: [1, null], picked: 1 }, '连好一对后自动选中下一个没连的')
  pairs = tapMatch(pairs, 'right', 1)
  assert.deepEqual(pairs, { pairs: [null, 1], picked: 0 }, '右边换主人时原来那对拆开，空出来的左边自动选中')
  pairs = tapMatch(pairs, 'right', 0)
  assert.deepEqual(responseOf(match, pairs), [0, 1])
  const screen = questionScreen({ ...PRACTICE, progress: { ...PRACTICE.progress, current: 2 } }, pairs)
  assert.equal(screen.left[0].tone, screen.right[0].tone)
})

test('feedback, clear summary and the course-detail card follow the practice state', () => {
  assert.equal(feedbackOf({ correct: true, practice: { progress: { streak: 3 } } }).title, '太棒了！连对 3 道')
  assert.deepEqual(feedbackOf({ correct: false, answer: 'A. 甲', explanation: '因为' }).retryHint, '这道题会放到后面再考你一次')
  const done = normalizePractice({ ...PRACTICE, status: 'done', correctCount: 2, review: [{ answer: '甲', explanation: '', firstTry: true }] })
  assert.equal(clearSummary(done).comment, '一次就对了 2 道，错的也都改对了。')
  assert.equal(practiceCard(PRACTICE).cta, '去闯关')
  assert.equal(practiceCard(done).cleared, true)
  assert.equal(practiceCard(normalizePractice({ ...PRACTICE, status: 'failed' })).cleared, false, '出题失败不算过关，要重新出题做完')
  assert.equal(practiceCard(normalizePractice({ kind: 'homework', status: 'ready', questionCount: 3 })).cleared, false, '以前的课后作业也要交了卷才算过')
  const review = { available: true, status: 'not_started', title: '开始复述验收' }
  assert.equal(gateReview(review, practiceCard(PRACTICE)).available, false, '练习没通关，验收锁住')
  assert.equal(gateReview(review, practiceCard(done)), review)
  assert.equal(gateReview(review, practiceCard(null, true)), review, '练习读不到时不锁')
  assert.equal(gateReview({ ...review, status: 'in_progress' }, practiceCard(PRACTICE)).available, true, '已经开始的验收不锁')
  assert.equal(practiceCard(normalizePractice({ kind: 'homework', status: 'ready', questionCount: 3 })).homework, true)
})

test('the quest path zigzags nodes, marks the current step and routes taps', () => {
  const view = questPathView(normalizeQuestPath({
    goal: { title: '期末 90 分', subject: 'math' },
    current: { stageId: 'stage-a', step: 'practice' },
    stats: { lessons: 1, done: 0 },
    stages: [
      {
        id: '7-c1', kind: 'condition', title: '分数运算', subtitle: '占分多',
        lessons: [{ stageId: 'stage-a', title: '约分', steps: [
          { key: 'watch', state: 'done', label: '看课', detail: '已学完' },
          { key: 'practice', state: 'current', label: '互动练习', detail: '6 道小题' },
          { key: 'accept', state: 'locked', label: 'AI 老师验收', detail: '' }
        ] }],
        review: { count: 1, stageIds: ['stage-a'] },
        chest: { opened: false, done: 0, total: 1 }
      },
      { id: '7-c2', kind: 'condition', title: '应用题', empty: true, lessons: [] }
    ]
  }))
  const nodes = view.sections[0].nodes
  assert.deepEqual(nodes.map((n) => n.kind), ['step', 'step', 'step', 'review', 'chest'])
  assert.deepEqual(nodes.map((n) => n.offset), [0, 90, 150, 90, 0])
  assert.equal(nodes[0].lessonTitle, '约分')
  assert.equal(view.currentId, 'stage-a-practice')
  assert.equal(nodeTarget(nodes[1]).url, '/learning/practice/index?stageId=stage-a')
  assert.equal(nodeTarget(nodes[2]).toast, '先通关互动练习')
  assert.equal(nodeTarget(nodes[3]).url, '/learning/review/index?stageId=stage-a')
  assert.ok(nodeTarget(nodes[4]).toast)
  assert.equal(view.sections[1].nodes[0].kind, 'placeholder')
})

test('chapter steps of watching get their own nodes and open the course at their first unfinished page', () => {
  const view = questPathView(normalizeQuestPath({
    current: { stageId: 'stage-a', step: 'watch', part: 2 },
    stats: { lessons: 1, done: 0 },
    stages: [{ id: 's:f', kind: 'series', title: '分数', lessons: [{ stageId: 'stage-a', title: '约分', steps: [
      { key: 'watch', part: 1, sceneId: 's1', state: 'done', label: '看课 1', detail: '第 1–2 页 · 讲解' },
      { key: 'watch', part: 2, sceneId: 'scene-4', state: 'current', label: '看课 2', detail: '第 3–4 页 · 互动' },
      { key: 'watch', part: 3, sceneId: 's5', state: 'locked', label: '看课 3', detail: '' },
      { key: 'practice', state: 'locked', label: '互动练习', detail: '' },
      { key: 'accept', state: 'locked', label: 'AI 老师验收', detail: '' }
    ] }] }]
  }))
  const nodes = view.sections[0].nodes
  assert.deepEqual(nodes.map((n) => n.id), ['stage-a-watch-1', 'stage-a-watch-2', 'stage-a-watch-3', 'stage-a-practice', 'stage-a-accept'])
  assert.equal(view.currentId, 'stage-a-watch-2')
  assert.equal(nodeTarget(nodes[1]).url, '/learning/course/index?agentCourseId=stage-a&sceneId=scene-4')
  assert.equal(nodeTarget(nodes[2]).toast, '先学完上一段')
})

test('the practice page is registered and its wxml has no inline rpx', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  assert.ok(JSON.stringify(app).includes('"practice/index"'))
  for (const file of ['../learning/practice/index.wxml', '../pages/learning/index.wxml']) {
    const wxml = fs.readFileSync(path.join(__dirname, file), 'utf8')
    for (const style of wxml.match(/style="[^"]*"/g) || []) assert.ok(!/rpx/.test(style), `${file}: ${style}`)
  }
})

test('course detail only opens the pages of the current chapter step', () => {
  const { normalizeAgentLearning } = require('../utils/agent-course-view')
  const scenes = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((sceneId, i) => ({ sceneId, state: i < 2 ? 'completed' : 'not_started', counts: true }))
  const learning = normalizeAgentLearning({ total: 6, completed: 2, allRecorded: false, scenes })
  assert.deepEqual(Object.keys(learning.beyond), ['a5', 'a6'], '第 2 段（第 3–4 页）在学，第 3 段锁着')
  const finished = normalizeAgentLearning({ total: 6, completed: 6, allRecorded: true, scenes })
  assert.deepEqual(finished.beyond, {})
})
