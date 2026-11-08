const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 课后作业（2026-10-13 用户规则「每节课学完 AI 出练习题」）：课程详情卡片、作业页、家长看板「作业动态」
const { normalizeHomework, homeworkCard, questionRows, allAnswered, resultSummary, guardianHomeworkSection } = require('../utils/homework-view')
const { normalizeAgentCourse, agentCourseCard } = require('../utils/agent-course-view')
const { buildChild, diagnosisFor } = require('../utils/guardian-dashboard-view')

const READY = {
  stageId: 'stage-hw0000001',
  title: '分数的约分',
  status: 'ready',
  questionCount: 2,
  questions: [
    { type: 'single', prompt: '6/8 约分后是？', options: ['3/4', '2/3', '1/2', '6/8'] },
    { type: 'judge', prompt: '约分后分数大小不变', options: ['对', '错'] }
  ],
  result: null
}

test('the course detail card follows the homework status', () => {
  assert.equal(homeworkCard(null), null) // 还没读到：页面画骨架
  assert.equal(homeworkCard(null, true).action, 'reload')
  assert.deepEqual(
    ['locked', 'preparing', 'ready', 'failed'].map((status) => homeworkCard(normalizeHomework({ ...READY, status })).title),
    ['学完整节课后出练习题', '正在出练习题', '2 道练习题待完成', '练习题没有出好']
  )
  assert.equal(homeworkCard(normalizeHomework({ status: 'locked' })).available, false)
  const done = homeworkCard(normalizeHomework({ ...READY, status: 'done', result: { correct: 1, total: 2, items: [] } }))
  assert.deepEqual([done.title, done.cta, done.icon], ['答对 1/2 道', '看解析', 'passed'])
  // 未知状态按「还没学完」处理
  assert.equal(normalizeHomework({ status: 'weird' }).status, 'locked')
})

test('answering marks the chosen option; after submit right and wrong are shown with explanations', () => {
  const homework = normalizeHomework(READY)
  const rows = questionRows(homework, ['B', ''])
  assert.deepEqual(rows[0].options.map((option) => option.state), ['', 'selected', '', ''])
  assert.deepEqual(rows.map((row) => row.typeLabel), ['单选题', '判断题'])
  assert.equal(allAnswered(homework, ['B', '']), false)
  assert.equal(allAnswered(homework, ['B', 'A']), true)
  assert.equal(resultSummary(homework), null)

  const done = normalizeHomework({
    ...READY,
    status: 'done',
    result: { correct: 1, total: 2, items: [
      { choice: 'B', answer: 'A', correct: false, explanation: '分子分母同时除以 2' },
      { choice: 'A', answer: 'A', correct: true, explanation: '' }
    ] }
  })
  const graded = questionRows(done)
  assert.deepEqual(graded[0].options.map((option) => option.state), ['right', 'wrong', '', ''])
  assert.equal(graded[0].correct, false)
  assert.equal(graded[0].answerText, '正确答案 A')
  assert.equal(graded[0].explanation, '分子分母同时除以 2')
  assert.equal(graded[1].correct, true)
  assert.equal(resultSummary(done).score, '1/2')
  // 还没交卷时页面模型里没有答案
  assert.equal(normalizeHomework({ ...READY, result: { correct: 2, total: 2, items: [] } }).result, null)
})

test('my-course cards remind about unfinished homework', () => {
  const raw = { stageId: 'stage-hw0000001', title: '分数的约分', status: 'completed', canLearn: true, pages: [], progress: { total: 3, done: 3, percent: 100 }, learning: { completed: 3, total: 3, allRecorded: true } }
  assert.equal(agentCourseCard(normalizeAgentCourse(raw)).tag, '')
  assert.equal(agentCourseCard(normalizeAgentCourse({ ...raw, homework: { status: 'ready', questionCount: 3 } })).tag, '作业待完成')
  assert.equal(agentCourseCard(normalizeAgentCourse({ ...raw, homework: { status: 'done', questionCount: 3, correctCount: 2 } })).tag, '')
  assert.equal(normalizeAgentCourse({ ...raw, homework: { status: 'bogus' } }).homework, null)
})

test('the guardian dashboard shows homework of the chosen day, with skeleton and retry states', () => {
  const day = '2026-10-13'
  assert.equal(guardianHomeworkSection(undefined, day).skeleton, true)
  assert.equal(guardianHomeworkSection({ loaded: false, failed: false, items: [] }, day).skeleton, true)
  assert.equal(guardianHomeworkSection({ loaded: false, failed: true, items: [] }, day).failed, true)
  const items = [
    { stageId: 'stage-a', title: '约分', status: 'done', questionCount: 4, correctCount: 3, createdAt: '2026-10-12T12:00:00Z', readyAt: '2026-10-12T12:01:00Z', submittedAt: '2026-10-13T01:30:00Z' },
    { stageId: 'stage-b', title: '通分', status: 'ready', questionCount: 3, correctCount: null, createdAt: '2026-10-13T02:00:00Z', readyAt: '2026-10-13T02:01:00Z', submittedAt: null },
    { stageId: 'stage-c', title: '旧课', status: 'ready', questionCount: 3, createdAt: '2026-10-01T02:00:00Z', readyAt: '2026-10-01T02:01:00Z' },
    { stageId: 'stage-d', title: '没出好', status: 'failed', questionCount: 0, createdAt: '2026-10-13T02:00:00Z' }
  ]
  const section = guardianHomeworkSection({ loaded: true, failed: false, items }, day)
  assert.deepEqual(section.rows.map((row) => [row.title, row.statusLabel]), [['约分', '已完成'], ['通分', '待完成']])
  assert.equal(section.rows[0].detail, '4 道练习题 · 09:30 完成 · 答对 3 道')
  assert.equal(section.summary, '当日 2 份作业 · 1 份待完成')
  assert.equal(guardianHomeworkSection({ loaded: true, items: [] }, day).summary, '当日没有课后作业')

  // 接进学习诊断：放在最前面；不传作业状态时照旧三块
  const child = buildChild({ student_profile: { id: 31, nickname: '小明', current_grade: 5 } }, Date.parse('2026-10-13T04:00:00Z'))
  assert.deepEqual(diagnosisFor(child, day, { loaded: true, items }).sections.map((s) => s.title), ['作业动态', '错题动态', '学习记录', '验收记录'])
  assert.equal(diagnosisFor(child, day).sections.length, 3)
})

test('the homework page is registered in the learning package and wired to the course service', () => {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'))
  const learning = (app.subPackages || app.subpackages).find((item) => item.root === 'learning')
  assert.ok(learning.pages.includes('homework/index'))
  const wxss = fs.readFileSync(path.join(__dirname, '../learning/homework/index.wxss'), 'utf8')
  assert.match(wxss, /@import "..\/..\/styles\/account-form.wxss";/)
  assert.match(wxss, /@import "..\/..\/styles\/skeleton.wxss";/)
  const identity = fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8')
  assert.match(identity, /\/api\/learn\/agent-courses\/\$\{encodeURIComponent\(stageId\)\}\/homework/)
  assert.match(identity, /\/api\/learn\/guardian-homework\?studentProfileId=/)
})

function setupHomeworkPage(responses) {
  let definition
  const calls = []
  const timers = []
  const toasts = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/homework/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => {
      if (name.endsWith('/utils/homework-view')) return require('../utils/homework-view')
      if (name.endsWith('/utils/agent-course-view')) return require('../utils/agent-course-view')
      if (name.endsWith('/utils/screen')) return { rpxToPx: (value) => value / 2 }
      return {
        loadAgentCourseHomework: async (stageId) => { calls.push(['load', stageId]); return responses.load() },
        submitAgentCourseHomework: async (stageId, choices) => { calls.push(['submit', choices]); return responses.submit(choices) },
        retryAgentCourseHomework: async () => { calls.push(['retry']); return responses.retry() }
      }
    },
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32 }),
      showToast: (options) => toasts.push(options.title),
      showModal: (options) => options.success({ confirm: true }),
      navigateBack() {},
      switchTab() {},
      redirectTo() {}
    },
    getCurrentPages: () => [{}, {}],
    setTimeout: (fn) => { timers.push(fn); return timers.length },
    clearTimeout() {}
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch) => { Object.assign(page.data, patch) }
  return { page, calls, timers, toasts }
}

test('the homework page polls while questions are prepared, then grades on submit', async () => {
  let current = { ...READY, status: 'preparing', questions: [] }
  const { page, calls, timers } = setupHomeworkPage({
    load: async () => ({ homework: current }),
    submit: async (choices) => ({ homework: { ...READY, status: 'done', result: { correct: 2, total: 2, items: choices.map((choice) => ({ choice, answer: choice, correct: true, explanation: '' })) } } }),
    retry: async () => ({ homework: { ...READY, status: 'preparing', questions: [] } })
  })
  page.onLoad({ stageId: 'stage-hw0000001' })
  assert.equal(page.data.loaded, false) // 第一次读到前：骨架
  await page.onShow()
  assert.equal(page.data.homework.status, 'preparing')
  assert.equal(timers.length, 1)
  current = READY
  await timers[0]()
  assert.equal(page.data.homework.status, 'ready')
  assert.equal(page.data.canSubmit, false)
  page.choose({ currentTarget: { dataset: { index: 0, letter: 'A' } } })
  page.submit() // 还有题没选：不交
  assert.equal(calls.filter((call) => call[0] === 'submit').length, 0)
  page.choose({ currentTarget: { dataset: { index: 1, letter: 'B' } } })
  assert.equal(page.data.canSubmit, true)
  page.submit()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls.find((call) => call[0] === 'submit')[1], ['A', 'B'])
  assert.equal(page.data.homework.status, 'done')
  assert.equal(page.data.summary.score, '2/2')
})

test('the homework page offers a retry when generation failed, and an error panel on first load failure', async () => {
  const failing = setupHomeworkPage({ load: async () => { throw new Error('课后作业暂时无法读取，请稍后重试。') } })
  failing.page.onLoad({ stageId: 'stage-hw0000001' })
  await failing.page.onShow()
  assert.equal(failing.page.data.loadFailed, true)

  const { page, calls } = setupHomeworkPage({
    load: async () => ({ homework: { ...READY, status: 'failed', questions: [] } }),
    retry: async () => ({ homework: { ...READY, status: 'preparing', questions: [] } })
  })
  page.onLoad({ stageId: 'stage-hw0000001' })
  await page.onShow()
  assert.equal(page.data.homework.status, 'failed')
  await page.retryGenerate()
  assert.ok(calls.some((call) => call[0] === 'retry'))
  assert.equal(page.data.homework.status, 'preparing')
})
