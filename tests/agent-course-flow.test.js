const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { normalizeAgentCourse, agentCourseCard } = require('../utils/agent-course-view')
const { apply, createInitialCourseAgentState } = (() => {
  const fold = require('../utils/course-agent-fold')
  return {
    createInitialCourseAgentState: fold.createInitialCourseAgentState,
    apply: (state, events) => events.reduce((current, event) => fold.foldCourseAgentEvent(current, event), state)
  }
})()

const STAGE = 'stage-abcDEF1234'

function rawCourse(overrides = {}) {
  return {
    stageId: STAGE,
    title: '一次函数',
    status: 'generating',
    progress: { total: 3, done: 1, failed: 0, generating: 1, percent: 50 },
    pages: [
      { order: 1, title: '坐标系', type: 'slide', status: 'done' },
      { order: 2, title: '图像', type: 'interactive', status: 'generating' },
      { order: 3, title: '小测', type: 'quiz', status: 'pending' }
    ],
    canLearn: false,
    createdAt: '2026-09-17T00:00:00.000Z',
    ...overrides
  }
}

test('normalizes live progress into labelled course and page states', () => {
  const course = normalizeAgentCourse(rawCourse())
  assert.equal(course.statusLabel, '生成中')
  assert.equal(course.isGenerating, true)
  assert.equal(course.percent, 50)
  assert.equal(course.summary, '正在生成第 2 / 3 页')
  assert.deepEqual(course.pages.map((page) => page.statusLabel), ['已完成', '生成中', '排队中'])
  assert.deepEqual(course.pages.map((page) => page.typeLabel), ['讲解', '互动', '测验'])
  assert.equal(normalizeAgentCourse({ ...rawCourse(), stageId: '../x' }), null)

  const partial = normalizeAgentCourse(rawCourse({ status: 'partial', canLearn: true, progress: { total: 3, done: 2, percent: 67 } }))
  assert.equal(partial.summary, '已生成 2 / 3 页，可以开始学习')
})

test('my-course cards show generating progress and route by readiness', () => {
  const generating = agentCourseCard(normalizeAgentCourse(rawCourse()))
  assert.deepEqual(
    { id: generating.id, kind: generating.kind, stateLabel: generating.stateLabel, progress: generating.progress, progressText: generating.progressText },
    { id: `agent:${STAGE}`, kind: 'agent', stateLabel: '生成中', progress: 50, progressText: '50%' }
  )
  const ready = agentCourseCard(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true, progress: { total: 3, done: 3, percent: 100 } })))
  assert.equal(ready.stateLabel, '已生成')
  assert.equal(ready.progressText, '待学习')
})

test('learning tab lists agent courses (generating first) even when they are not finished', async () => {
  const module = { exports: {} }
  let agentCourses
  const identity = {
    loadLearningDashboard: async () => ({ students: [{}], tasks: [], myCourses: [
      { courseInstanceId: '91', canLaunch: true, title: '计划课程', progress: 100, progressText: '已完成' }
    ] }),
    loadMemberCourseLibrary: async () => [],
    loadAgentCourses: () => agentCourses()
  }
  agentCourses = async () => [
    normalizeAgentCourse(rawCourse({ stageId: 'stage-done000001', title: '已完成的课', status: 'completed', canLearn: true })),
    normalizeAgentCourse(rawCourse())
  ]
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module,
    require: (name) => name === './mock-service'
      ? { getLearningModel: () => ({ notifications: {} }) }
      : name === '../utils/agent-course-view' ? require('../utils/agent-course-view') : identity
  })
  const { model } = await module.exports.getLiveLearningModel()
  assert.deepEqual(model.myCourses.map((course) => course.title), ['一次函数', '已完成的课', '计划课程'])
  assert.equal(model.hasGeneratingAgentCourse, true)

  agentCourses = async () => { throw new Error('offline') }
  const fallback = await module.exports.getLiveLearningModel()
  assert.deepEqual([...fallback.model.myCourses.map((course) => course.title)], ['计划课程'])
  assert.equal(fallback.model.hasGeneratingAgentCourse, false)
})

function setupLearningPage() {
  let definition
  const navigations = []
  const timers = new Map()
  let serial = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/learning/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: () => ({ getLearningModel: () => ({ calendarTitle: '今天', studyTasks: [] }) }),
    getApp: () => ({}),
    wx: { navigateTo: ({ url }) => navigations.push(url), showToast() {} },
    setTimeout: (fn) => { timers.set(++serial, fn); return serial },
    clearTimeout: (id) => timers.delete(id)
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, timers }
}

test('opening an agent course goes to live progress until it can be learned', () => {
  const { page, navigations } = setupLearningPage()
  page.data.model = { myCourses: [
    agentCourseCard(normalizeAgentCourse(rawCourse())),
    agentCourseCard(normalizeAgentCourse(rawCourse({ stageId: 'stage-done000001', status: 'completed', canLearn: true })))
  ] }
  page.openMyCourse({ currentTarget: { dataset: { id: `agent:${STAGE}`, kind: 'agent' } } })
  page.openMyCourse({ currentTarget: { dataset: { id: 'agent:stage-done000001', kind: 'agent' } } })
  assert.deepEqual(navigations, [
    `/learning/agent-course/index?stageId=${STAGE}`,
    '/learning/course/index?agentCourseId=stage-done000001'
  ])
})

test('learning tab keeps polling while an agent course is generating', () => {
  const { page, timers } = setupLearningPage()
  page._visible = true
  page.data.dashboard = { tasks: [] }
  page.data.model = { hasGeneratingAgentCourse: true }
  page.scheduleProgressPolling()
  assert.equal(timers.size, 1)
  page.data.model = { hasGeneratingAgentCourse: false }
  page.scheduleProgressPolling()
  assert.equal(timers.size, 0)
})

function setupProgressPage(replies) {
  let definition
  const navigations = []
  const timers = new Map()
  let serial = 0
  const calls = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => name.endsWith('agent-course-view') ? require('../utils/agent-course-view') : {
      loadAgentCourse: async (stageId) => {
        calls.push(stageId)
        const next = replies.shift()
        if (next instanceof Error) throw next
        return normalizeAgentCourse(next)
      }
    },
    wx: { navigateTo: ({ url }) => navigations.push(url), switchTab: ({ url }) => navigations.push(url) },
    setTimeout: (fn) => { timers.set(++serial, fn); return serial },
    clearTimeout: (id) => timers.delete(id)
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, timers, calls }
}

test('progress page polls while generating, stops when ready, then starts learning', async () => {
  const { page, navigations, timers, calls } = setupProgressPage([
    rawCourse(),
    rawCourse({ progress: { total: 3, done: 2, generating: 1, percent: 83 } }),
    rawCourse({ status: 'completed', canLearn: true, progress: { total: 3, done: 3, percent: 100 } })
  ])
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  assert.equal(page.data.course.percent, 50)
  assert.equal(timers.size, 1)
  await [...timers.values()].pop()()
  assert.equal(page.data.course.percent, 83)
  await [...timers.values()].pop()()
  assert.equal(page.data.course.statusLabel, '已生成')
  assert.equal(calls.length, 3)
  // 生成结束后不再轮询：最后一次读取没有再安排计时器
  assert.equal(timers.size, 0)
  page.startLearning()
  assert.deepEqual(navigations, [`/learning/course/index?agentCourseId=${STAGE}`])
})

test('progress page stops polling when hidden and keeps showing progress through a transient error', async () => {
  const { page, timers } = setupProgressPage([rawCourse(), new Error('网络错误')])
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  await [...timers.values()].pop()()
  assert.equal(page.data.course.percent, 50)
  assert.equal(page.data.errorMessage, '网络不稳定，正在重新读取进度…')
  page.onHide()
  assert.equal(timers.size, 0)
})

test('progress page rejects a malformed course link without calling the server', async () => {
  const { page, calls } = setupProgressPage([])
  page.onLoad({ stageId: '../../etc' })
  await page.onShow()
  assert.equal(calls.length, 0)
  assert.equal(page.data.course, null)
  assert.ok(page.data.errorMessage)
})

test('one course card per course: created, then flipped to generating in place', () => {
  const state = apply(createInitialCourseAgentState(), [
    { id: 1, type: 'session_start', data: {} },
    { id: 2, type: 'stage_link', data: { stageId: STAGE, title: '一次函数', url: `/classroom/${STAGE}` } },
    { id: 3, type: 'course_generation', data: { stageId: STAGE, title: '一次函数', url: `/classroom/${STAGE}`, totalPages: 3, status: 'generating' } }
  ])
  const cards = state.nodes.filter((node) => node.kind === 'stage')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].generating, true)
})
