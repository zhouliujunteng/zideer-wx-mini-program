const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')

function loadService() {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/assessment.js'), 'utf8'), { module, exports: module.exports, require: (name) => name === '../utils/question-timing' ? require('../utils/question-timing') : ({ requestK12Assessment: async () => ({}) }) })
  return module.exports
}
function pageFixture(call) {
  let definition
  const service = loadService()
  const navigations = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assessment/short/index.js'), 'utf8'), { Page: p => { definition = p }, require: () => ({ ...service, call }), wx: { showModal() {}, navigateTo(o) { navigations.push(o) } }, Date, setInterval, clearInterval })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({}); page.visible = true
  page.navigations = navigations
  return page
}

test('report view: judged topics first, pending topics show progress, review marks answer and wrong choice', () => {
  const { reportView } = loadService()
  const view = reportView({
    round: 1, roundCount: 3, completedRounds: 1, isFinal: false, nextRound: 2, totalScore: 61.9, band: '薄弱',
    roundSummary: { correctCount: 1, earnedMarks: 2, possibleMarks: 3 },
    topics: [
      { topicId: 1, name: '甲', tier: 'A', n: 4, answered: 2, c: 2, state: 'pending' },
      { topicId: 2, name: '乙', tier: 'B', n: 2, answered: 2, c: 1, state: 'reinforce' },
      { topicId: 3, name: '丙', tier: 'C', n: 1, answered: 1, c: 0, state: 'not_mastered' }
    ],
    review: [{ questionId: 9, number: 1, options: [{ value: 'A', label: 'x' }, { value: 'B', label: 'y' }], selected: 'B', answer: 'A', correct: false }]
  })
  assert.deepEqual(view.judgedTopics.map(t => t.topicId), [3, 2])
  assert.equal(view.pendingTopics[0].rateLabel, '已测 2/4')
  assert.equal(view.judgedTopics[1].rateLabel, '1/2')
  assert.equal(view.title, '第 1 轮已完成')
  assert.equal(view.progressLabel, '已完成 1/3 轮')
  assert.equal(view.bandTone, 'weak')
  assert.deepEqual(view.review[0].options.map(o => o.tone), ['is-answer', 'is-wrong'])
  assert.equal(view.review[0].resultLabel, '答错')
})

test('entry view labels each mode with round progress', () => {
  const { entryView } = loadService()
  assert.equal(entryView({ roundCount: 5, roundMinutes: 28, entry: { mode: 'start' } }).detail, '共 5 轮，每轮约 28 分钟')
  assert.equal(entryView({ roundCount: 5, entry: { mode: 'continue', round: 3, completedRounds: 2 } }).actionLabel, '开始第 3 轮')
  assert.equal(entryView({ roundCount: 5, entry: { mode: 'resume', round: 3, completedRounds: 2 } }).detail, '已完成 2/5 轮 · 可分次完成')
  assert.equal(entryView({ roundCount: 5, entry: { mode: 'report', completedRounds: 5 } }).actionLabel, '查看报告')
})

test('tapping a finished scope opens its report; an in-progress one reads the saved attempt instead of starting a new one', async () => {
  const calls = []
  const page = pageFixture(async (op, payload) => { calls.push([op, payload]); return { attempt: { id: 7, status: 'draft', revision: 1, answeredCount: 1, totalQuestions: 2, current: null } } })
  await page.start({ currentTarget: { dataset: { id: 184, mode: 'report', attemptId: 7 } } })
  assert.deepEqual(page.navigations.map(n => n.url), ['/assessment/report/index?attemptId=7'])
  assert.equal(calls.length, 0)
  await page.start({ currentTarget: { dataset: { id: 184, mode: 'resume', attemptId: 7 } } })
  await new Promise(r => setImmediate(r))
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['read', { attemptId: 7 }]))
})

test('the record list opens finished records as reports and resumes drafts in place', async () => {
  const calls = []
  const page = pageFixture(async (op, payload) => { calls.push([op, payload]); return { attempt: { id: 9, status: 'draft', revision: 1, answeredCount: 0, totalQuestions: 2, current: null } } })
  page.resume({ currentTarget: { dataset: { id: 8, status: 'partial' } } })
  page.resume({ currentTarget: { dataset: { id: 6, status: 'submitted' } } })
  assert.deepEqual(page.navigations.map(n => n.url), ['/assessment/report/index?attemptId=8', '/assessment/report/index?attemptId=6'])
  page.resume({ currentTarget: { dataset: { id: 9, status: 'draft' } } })
  await new Promise(r => setImmediate(r))
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['read', { attemptId: 9 }]))
})

test('answers carry the time spent on the question; countdown resumes from the round start time', async () => {
  const calls = []
  const page = pageFixture(async (op, payload) => { calls.push([op, payload]); return { attempt: { id: 1, status: 'draft', revision: 1, answeredCount: 1, totalQuestions: 2, current: null } } })
  const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  page.showAttempt({ id: 1, status: 'draft', revision: 0, answeredCount: 0, totalQuestions: 2, roundStartedAt: startedAt, roundLimitSeconds: 1800, roundCount: 3, round: 2, current: { id: 11, options: [{ value: 'A', label: 'x' }] } })
  page.stopTimer()
  assert.ok(Math.abs(page.countdownLeft - 1200) <= 2)
  assert.equal(page.data.roundLabel, '第 2 轮 / 共 3 轮')
  page.questionShownAt = Date.now() - 42000
  page.data.answer = 'A'
  await page.next({ currentTarget: { dataset: {} } })
  page.stopTimer()
  assert.equal(calls[0][0], 'answer')
  assert.ok(calls[0][1].secondsUsed >= 42 && calls[0][1].secondsUsed <= 44)
})

// 2026-10-03 再测一次：做完整张卷后测评页多一个「再测一次」，确认后带 retake 开新卷；再测过的标上第几次。
test('a finished scope offers a retake; confirming starts a new paper with retake', async () => {
  const { entryView } = loadService()
  const done = entryView({ roundCount: 3, entry: { mode: 'report', completedRounds: 3, paperNumber: 1, canRetake: true } })
  assert.equal(done.retakeLabel, '再测一次')
  assert.equal(done.detail, '已完成全部 3 轮')
  assert.equal(entryView({ roundCount: 3, entry: { mode: 'report', completedRounds: 3, paperNumber: 2, canRetake: true } }).detail, '第 2 次 · 已完成全部 3 轮')
  assert.equal(entryView({ roundCount: 3, entry: { mode: 'report', completedRounds: 3, canRetake: false } }).retakeLabel, '')
  assert.equal(entryView({ roundCount: 3, entry: { mode: 'resume', round: 2, completedRounds: 1, paperNumber: 2 } }).detail, '第 2 次 · 已完成 1/3 轮 · 可分次完成')
  assert.equal(entryView({ roundCount: 3, entry: { mode: 'resume', round: 2, completedRounds: 1, paperNumber: 2 } }).retakeLabel, '')

  const calls = []
  let definition
  const service = loadService()
  const modals = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assessment/short/index.js'), 'utf8'), {
    Page: p => { definition = p },
    require: () => ({ ...service, call: async (op, payload) => { calls.push([op, payload]); return { attempt: { id: 31, status: 'draft', revision: 0, answeredCount: 0, totalQuestions: 3, current: null } } } }),
    wx: { showModal(o) { modals.push(o) }, navigateTo() {} }, Date, setInterval, clearInterval
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v) } }
  page.onLoad({}); page.visible = true
  page.retake({ currentTarget: { dataset: { id: 184 } } })
  assert.equal(modals.length, 1)
  assert.equal(calls.length, 0)
  modals[0].success({ confirm: false })
  assert.equal(calls.length, 0)
  modals[0].success({ confirm: true })
  await new Promise(r => setImmediate(r))
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['start', { scopeId: 184, retake: true }]))
  assert.equal(page.attemptId, 31)
})
