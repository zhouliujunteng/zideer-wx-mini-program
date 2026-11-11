const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { normalizeAgentCourse, agentCourseCard, agentCourseDetail, normalizeAgentLearning } = require('../utils/agent-course-view')
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
  assert.equal(course.statusLabel, '制作中')
  assert.equal(course.isGenerating, true)
  assert.equal(course.percent, 50)
  assert.equal(course.summary, '正在制作第 2 / 3 页')
  assert.deepEqual(course.pages.map((page) => page.statusLabel), ['已完成', '制作中', '排队中'])
  assert.deepEqual(course.pages.map((page) => page.typeLabel), ['讲解', '互动', '测验'])
  assert.equal(normalizeAgentCourse({ ...rawCourse(), stageId: '../x' }), null)

  const partial = normalizeAgentCourse(rawCourse({ status: 'partial', canLearn: true, progress: { total: 3, done: 2, percent: 67 } }))
  assert.equal(partial.summary, '已完成 2 / 3 页，可以开始学习')
})

test('my-course cards show generating progress and route by readiness', () => {
  const generating = agentCourseCard(normalizeAgentCourse(rawCourse()))
  assert.deepEqual(
    { id: generating.id, kind: generating.kind, stateLabel: generating.stateLabel, progress: generating.progress, progressText: generating.progressText },
    { id: `agent:${STAGE}`, kind: 'agent', stateLabel: '制作中', progress: 50, progressText: '50%' }
  )
  const ready = agentCourseCard(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true, progress: { total: 3, done: 3, percent: 100 } })))
  assert.equal(ready.stateLabel, '已完成')
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

function fakeStorage() {
  const store = new Map()
  return {
    setStorageSync: (key, value) => store.set(key, value),
    getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
    removeStorageSync: (key) => store.delete(key),
    store
  }
}

function setupLearningPage(storage = fakeStorage()) {
  let definition
  const navigations = []
  const timers = new Map()
  let serial = 0
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/learning/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => (name.endsWith('agent-course-focus')
      ? loadFocusUtil(storage)
      : name.endsWith('/utils/my-course-groups')
        ? require('../utils/my-course-groups')
        : { getLearningModel: () => ({ calendarTitle: '今天', studyTasks: [] }) }),
    getApp: () => ({}),
    wx: { navigateTo: ({ url }) => navigations.push(url), showToast() {}, ...storage },
    setTimeout: (fn) => { timers.set(++serial, fn); return serial },
    clearTimeout: (id) => timers.delete(id)
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, timers, storage }
}

// 交接工具直接读全局 wx，这里给它一份测试用的 storage。
function loadFocusUtil(storage) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/agent-course-focus.js'), 'utf8'), {
    module,
    wx: { ...storage },
    Date
  })
  return module.exports
}

test('opening an agent course always goes to the course page (progress, or 学习课程 / 去验收)', () => {
  const { page, navigations } = setupLearningPage()
  page.data.model = { myCourses: [
    agentCourseCard(normalizeAgentCourse(rawCourse())),
    agentCourseCard(normalizeAgentCourse(rawCourse({ stageId: 'stage-done000001', status: 'completed', canLearn: true })))
  ] }
  page.openMyCourse({ currentTarget: { dataset: { id: `agent:${STAGE}`, kind: 'agent' } } })
  page.openMyCourse({ currentTarget: { dataset: { id: 'agent:stage-done000001', kind: 'agent' } } })
  assert.deepEqual(navigations, [
    `/learning/agent-course/index?stageId=${STAGE}`,
    '/learning/agent-course/index?stageId=stage-done000001'
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

function setupProgressPage(replies, learning = { value: null }) {
  let definition
  const navigations = []
  const timers = new Map()
  let serial = 0
  const calls = []
  const toasts = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => {
      if (name.endsWith('agent-course-view')) return require('../utils/agent-course-view')
      if (name.endsWith('practice-view')) return require('../utils/practice-view')
      if (name.endsWith('utils/screen')) return require('../utils/screen')
      if (name.endsWith('ui-assets')) return { attachUiAssets() {} }
      // 测试快捷方式的开关：这里的用例都是没输入过开启码的手机（见 agent-course-test-finish.test.js）
      if (name.endsWith('utils/dev-reset')) return { readDevResetCode: () => '', onDevResetChange: () => () => {} }
      return {
        getStoredToken: () => 'token',
        loadAgentCourse: async (stageId) => {
          calls.push(stageId)
          const next = replies.shift()
          if (next instanceof Error) throw next
          return normalizeAgentCourse(next)
        },
        loadAgentCourseAcceptance: async () => {
          if (learning.value instanceof Error) throw learning.value
          return { acceptance: { learning: learning.value } }
        },
        loadCourseCovers: async (refs) => ({ [refs[0]]: 'https://course.example/api/course-covers/a.jpg' })
      }
    },
    wx: {
      navigateTo: ({ url }) => navigations.push(url),
      switchTab: ({ url }) => navigations.push(url),
      showToast: ({ title }) => toasts.push(title),
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32 })
    },
    setTimeout: (fn) => { timers.set(++serial, fn); return serial },
    clearTimeout: (id) => timers.delete(id)
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return { page, navigations, timers, calls, toasts }
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
  assert.equal(page.data.course.statusLabel, '已完成')
  assert.equal(calls.length, 3)
  // 生成结束后不再轮询：最后一次读取没有再安排计时器
  assert.equal(timers.size, 0)
  page.startLearning()
  assert.deepEqual(navigations, [`/learning/course/index?agentCourseId=${STAGE}`])
})

test('course detail (design M37) shows only real fields: production progress, then page count when learning progress is unavailable', async () => {
  const { page, navigations, timers, toasts } = setupProgressPage([
    rawCourse({ createdAt: '2026-09-24T08:00:00+08:00' }),
    rawCourse({ status: 'completed', canLearn: true, acceptanceStatus: 'pending_teacher', progress: { total: 3, done: 3, percent: 100 } })
  ])
  page.onLoad({ stageId: STAGE })
  assert.equal(page.data.contentTop, 20 + 40 + 9)
  await page.onShow()
  const generating = page.data.detail
  assert.equal(generating.subtitle, '9月24日制作')
  assert.deepEqual([generating.statusPill, generating.statusTone], ['制作中', 'blue'])
  assert.deepEqual(generating.progressRow, { label: '制作进度', value: '50%', percent: 50, track: true })
  assert.deepEqual([generating.review.available, generating.review.title], [false, '等待课程做好'])
  page.openAcceptance()
  assert.deepEqual([toasts, navigations], [['课程做好后才能验收'], []])
  // 封面与「我的课程」卡片同一张，按 stageId 取
  await Promise.resolve()
  assert.equal(page.data.coverUrl, 'https://course.example/api/course-covers/a.jpg')
  await [...timers.values()].pop()()
  const ready = page.data.detail
  assert.deepEqual([ready.statusPill, ready.progressRow.value, ready.progressRow.percent], ['已做好', '共 3 页', null])
  assert.deepEqual([ready.review.available, ready.review.title], [true, '待老师核验'])
  assert.equal(ready.learnAction, '学习课程')
  page.openAcceptance()
  assert.deepEqual(navigations, [`/learning/agent-acceptance/index?stageId=${STAGE}`])
})

test('course detail shows learning progress from the acceptance API, and locks 验收 until the course is learned', async () => {
  const ready = (acceptanceStatus = 'not_started') => rawCourse({ status: 'completed', canLearn: true, acceptanceStatus, progress: { total: 3, done: 3, percent: 100 } })
  const learning = { value: { completed: 1, total: 3, allRecorded: false } }
  const { page, navigations, toasts } = setupProgressPage([ready(), ready(), ready('teacher_rejected')], learning)
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  let detail = page.data.detail
  assert.deepEqual([detail.statusPill, detail.statusTone, detail.learnAction], ['学习进行中', 'blue', '继续学习'])
  assert.deepEqual(detail.progressRow, { label: '学习进度', value: '33%', percent: 33, track: true })
  assert.deepEqual([detail.review.available, detail.review.title], [false, '学完后开放验收'])
  assert.equal(detail.review.text, '还有 2 页没学完，学完整门课就能开始复述验收')
  page.openAcceptance()
  assert.deepEqual([toasts, navigations], [['学完整门课后才能验收'], []])
  // 学完：100%、再次学习，验收解锁
  learning.value = { completed: 3, total: 3, allRecorded: true }
  await page.handlePullRefresh()
  detail = page.data.detail
  assert.deepEqual([detail.statusPill, detail.progressRow.value, detail.learnAction], ['已学完', '100%', '再次学习'])
  assert.deepEqual([detail.review.available, detail.review.title], [true, '开始复述验收'])
  assert.equal(page.data.refreshing, false)
  // 老师要求重学、学习记录又读不到：退回页数显示，验收放行给验收页自己判断
  learning.value = new Error('offline')
  await page.onShow()
  detail = page.data.detail
  assert.deepEqual([detail.statusPill, detail.progressRow.value, detail.learnAction], ['已做好', '共 3 页', '学习课程'])
  assert.deepEqual([detail.review.available, detail.review.title], [true, '建议重学'])
})

// 2026-09-24 用户反馈：「开始复述验收」画的是对勾，看着像已经验收完了。对勾只留给老师确认通过。
test('复述验收 card draws a check mark only after the teacher has signed off', () => {
  const learned = normalizeAgentLearning({ completed: 3, total: 3, allRecorded: true })
  const iconFor = (acceptanceStatus) => agentCourseDetail(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true, acceptanceStatus })), learned).review.icon
  assert.deepEqual(
    ['not_started', 'in_progress', 'ai_retry', 'teacher_rejected', 'pending_teacher', 'teacher_passed'].map(iconFor),
    ['talk', 'talk', 'talk', 'talk', 'waiting', 'passed']
  )
  const notLearned = agentCourseDetail(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true })), normalizeAgentLearning({ completed: 1, total: 3, allRecorded: false }))
  assert.equal(notLearned.review.icon, 'lock')
  assert.equal(agentCourseDetail(normalizeAgentCourse(rawCourse())).review.icon, 'lock')
  assert.equal(agentCourseDetail(normalizeAgentCourse(rawCourse({ status: 'failed' }))).review.icon, 'lock')
  // 2026-10-04 起图标用 CSS 画在橙色图标块里（原来老师通过是绿色圈勾，和整体配色不搭）：对勾只画在 passed 分支
  const wxml = fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.wxml'), 'utf8')
  assert.match(wxml, /detail\.review\.icon === 'talk'[^>]*class="review-glyph review-glyph--talk"/)
  assert.match(wxml, /detail\.review\.icon === 'waiting'[^>]*class="review-glyph review-glyph--clock"/)
  assert.match(wxml, /detail\.review\.icon === 'passed'[^>]*class="review-glyph review-glyph--check"/)
  assert.match(wxml, /wx:else class="review-glyph review-glyph--lock"/)
  // 另一个对勾在「课后作业」卡片（2026-10-13）：作业做完才画
  assert.match(wxml, /homework\.icon === 'passed'[^>]*class="review-glyph review-glyph--check"/)
  assert.equal((wxml.match(/review-glyph--check/g) || []).length, 2)
})

// 2026-10-04 用户反馈「复述验收、课程内容好丑，绿色元素不搭」：本页不再出现绿色；没学完时验收卡画学习进度环，接下来该学的一页点亮
test('course detail drops the green accents, rings progress on a locked review card and lights the next page', () => {
  const css = fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.wxss'), 'utf8')
  for (const green of ['#388A6A', '#E6F3EE', '#3B8F6E', '#2F9E6E']) assert.ok(!css.toUpperCase().includes(green.toUpperCase()), `green ${green} still in index.wxss`)
  const course = normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true, pages: [
    { order: 1, title: '拆十位', type: 'slide', status: 'done', sceneId: 'scene_a1' },
    { order: 2, title: '判一判', type: 'interactive', status: 'done', sceneId: 'scene_a2' },
    { order: 3, title: '练一练', type: 'quiz', status: 'done', sceneId: 'scene_a3' }
  ] }))
  const detail = agentCourseDetail(course, normalizeAgentLearning({ completed: 2, total: 3, allRecorded: false, scenes: [
    { sceneId: 'scene_a1', state: 'completed' }, { sceneId: 'scene_a3', state: 'completed' }
  ] }))
  assert.deepEqual(detail.review.ring, { percent: 67, text: '2/3' })
  assert.equal(detail.review.cta, '')
  assert.deepEqual(detail.pages.map((row) => [row.type, row.isNext]), [['slide', false], ['interactive', true], ['quiz', false]])
  assert.equal(detail.pagesSummary, '已学 2/3 页')
  const learned = agentCourseDetail(course, normalizeAgentLearning({ completed: 3, total: 3, allRecorded: true }))
  assert.deepEqual([learned.review.ring, learned.review.cta], [null, '去验收'])
  const waiting = agentCourseDetail(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true, acceptanceStatus: 'pending_teacher' })), normalizeAgentLearning({ completed: 3, total: 3, allRecorded: true }))
  assert.equal(waiting.review.cta, '查看')
})

// 课程封面是 4:3 横图，「我的课程」卡片横着显示；详情页原来裁成 3:4 竖图（2026-09-24 用户反馈）。
test('course detail shows the cover landscape, like the 我的课程 card', () => {
  const css = fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.wxss'), 'utf8')
  const rule = (selector) => (css.match(new RegExp(`\\n${selector.replace('.', '\\.')} \\{([^}]*)\\}`)) || [])[1] || ''
  const cover = rule('.course-cover-thumb')
  assert.match(cover, /width: 100%/)
  const height = Number((cover.match(/height: (\d+)rpx/) || [])[1])
  // 卡片内宽 750 - 32×2 - 22×2 = 642rpx：宽大于高才是横图
  assert.ok(height > 0 && height < 642, `cover height ${height}rpx`)
  assert.match(rule('.course-overview-card'), /flex-direction: column/)
})

test('learning progress never shows 100% before the course counts as learned', () => {
  assert.deepEqual(normalizeAgentLearning({ completed: 3, total: 3, allRecorded: false }), { completed: 3, total: 3, finished: false, percent: 99, scenes: {} })
  assert.deepEqual(normalizeAgentLearning({ completed: 0, total: 4, allRecorded: false }), { completed: 0, total: 4, finished: false, percent: 0, scenes: {} })
  assert.equal(normalizeAgentLearning({ completed: 1, total: 0 }), null)
  assert.equal(normalizeAgentLearning(null), null)
  const notStarted = agentCourseDetail(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true })), normalizeAgentLearning({ completed: 0, total: 3, allRecorded: false }))
  assert.deepEqual([notStarted.statusPill, notStarted.learnAction], ['尚未开始', '开始学习'])
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

test('the course card in the chat hands the course over to 我的课程', () => {
  const storage = fakeStorage()
  const pagePath = require.resolve('../pages/diagnosis-room/index.js')
  delete require.cache[pagePath]
  const routes = []
  let definition = null
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    ...storage,
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    switchTab: ({ url }) => routes.push(url),
    navigateTo: ({ url }) => routes.push(url),
    showToast: ({ title }) => routes.push(`toast:${title}`),
    nextTick: (callback) => callback(),
    request() {},
    hideKeyboard() {}
  }
  require(pagePath)
  const page = { ...definition, data: {}, setData() {} }

  page.handleStageOpen({ currentTarget: { dataset: { stageId: STAGE } } })
  assert.deepEqual(routes, ['/pages/learning/index'])
  assert.equal(storage.store.get('agent-course-focus').stageId, STAGE)

  // 链接坏掉时不跳转，也不留下待聚焦的课程
  storage.store.clear()
  routes.length = 0
  page.handleStageOpen({ currentTarget: { dataset: { stageId: '../../etc' } } })
  assert.deepEqual(routes, ['toast:课程还在准备中，请稍后再试'])
  assert.equal(storage.store.size, 0)
})

test('我的课程 picks up the handed-over course: progress while generating, straight into learning when ready', () => {
  const storage = fakeStorage()
  const focus = loadFocusUtil(storage)

  focus.rememberAgentCourseFocus(STAGE)
  const generating = setupLearningPage(storage)
  generating.page._visible = true
  generating.page._focusStageId = STAGE
  generating.page.data.model = { myCourses: [agentCourseCard(normalizeAgentCourse(rawCourse()))] }
  generating.page.applyAgentCourseFocus()
  assert.deepEqual(generating.navigations, [])
  assert.equal(generating.page.data.focusCourseId, `agent:${STAGE}`)
  assert.equal(generating.page.data.courseScrollAnchor, 'my-courses-anchor')
  // 高亮只是短暂提示，超时后自动收起
  ;[...generating.timers.values()].pop()()
  assert.equal(generating.page.data.focusCourseId, '')

  const ready = setupLearningPage(storage)
  ready.page._visible = true
  ready.page._focusStageId = STAGE
  ready.page.data.model = { myCourses: [agentCourseCard(normalizeAgentCourse(rawCourse({ status: 'completed', canLearn: true })))] }
  ready.page.applyAgentCourseFocus()
  assert.deepEqual(ready.navigations, [`/learning/course/index?agentCourseId=${STAGE}`])
  assert.equal(ready.page._focusStageId, '')
})

test('a course that is not registered yet keeps the learning tab refreshing, then gives up', () => {
  const { page, timers } = setupLearningPage()
  page._visible = true
  page._focusStageId = STAGE
  page.data.dashboard = { tasks: [] }
  page.data.model = { myCourses: [], hasGeneratingAgentCourse: false }
  page.applyAgentCourseFocus()
  assert.equal(page._focusStageId, STAGE)
  page.scheduleProgressPolling()
  assert.equal(timers.size, 1, '等待中的课程应继续按节拍刷新')
  for (let attempt = 0; attempt < 12; attempt += 1) page.applyAgentCourseFocus()
  assert.equal(page._focusStageId, '')
  page.scheduleProgressPolling()
  assert.equal(timers.size, 0)
})

test('the learning tab consumes the handover once, and ignores a stale one', () => {
  const storage = fakeStorage()
  const focus = loadFocusUtil(storage)
  focus.rememberAgentCourseFocus(STAGE)
  assert.equal(focus.takeAgentCourseFocus(), STAGE)
  assert.equal(focus.takeAgentCourseFocus(), '')

  storage.setStorageSync('agent-course-focus', { stageId: STAGE, at: Date.now() - 6 * 60 * 1000 })
  assert.equal(focus.takeAgentCourseFocus(), '')
})

// 2026-09-24 用户需求：学完第一页退回课程详情，第一页显示「已学完」、后面的显示「未学」；点某一页直接从这一页开始学。
test('课程内容 marks each page learned or not, and a tap starts the course at that page', async () => {
  const readyCourse = rawCourse({
    status: 'partial',
    canLearn: true,
    progress: { total: 4, done: 3, failed: 1, percent: 100 },
    pages: [
      { order: 1, title: '个位不够减怎么办', type: 'slide', status: 'done', sceneId: 'scene_a1' },
      { order: 2, title: '用竖式算退位减法', type: 'slide', status: 'done', sceneId: 'scene_a2' },
      { order: 3, title: '互动：借一当十', type: 'interactive', status: 'failed' },
      { order: 4, title: '练一练', type: 'quiz', status: 'done', sceneId: 'scene_a4' }
    ]
  })
  const learning = { value: { completed: 1, total: 2, allRecorded: false, scenes: [
    { sceneId: 'scene_a1', state: 'completed' },
    { sceneId: 'scene_a2', state: 'not_started' },
    { sceneId: 'scene_a4', state: 'in_progress' }
  ] } }
  const { page, navigations, toasts } = setupProgressPage([readyCourse, readyCourse, readyCourse], learning)
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  const rows = page.data.detail.pages
  assert.deepEqual(rows.map((row) => row.stateLabel), ['已学完', '未学', '没有做好', '学习中'])
  assert.deepEqual(rows.map((row) => row.openable), [true, true, false, true])

  page.openPage({ currentTarget: { dataset: { order: 2 } } })
  assert.deepEqual(navigations, [`/learning/course/index?agentCourseId=${STAGE}&sceneId=scene_a2`])
  page.openPage({ currentTarget: { dataset: { order: 3 } } })
  assert.deepEqual([navigations.length, toasts], [1, ['这一页没有做好，先学其他页']])

  // 学完第二页回到详情页（onShow 刷新）：第二页变成「已学完」
  learning.value = { ...learning.value, completed: 2, scenes: [{ sceneId: 'scene_a1', state: 'completed' }, { sceneId: 'scene_a2', state: 'completed' }] }
  await page.onShow()
  assert.deepEqual(page.data.detail.pages.map((row) => row.stateLabel), ['已学完', '已学完', '没有做好', '未学'])

  // 学习进度读不到：不猜学没学，做好的页照样能点
  learning.value = new Error('offline')
  await page.onShow()
  assert.deepEqual(page.data.detail.pages.map((row) => [row.stateLabel, row.openable]), [['', true], ['', true], ['没有做好', false], ['', true]])

  const wxml = fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.wxml'), 'utf8')
  assert.match(wxml, /wx:for="\{\{detail\.pages\}\}"[^>]*bindtap="openPage"[^>]*data-order="\{\{item\.order\}\}"/)
})

test('while the course is being made, 课程内容 shows production state and no page opens', async () => {
  const { page, navigations } = setupProgressPage([rawCourse({ pages: [
    { order: 1, title: '坐标系', type: 'slide', status: 'done', sceneId: 'scene_b1' },
    { order: 2, title: '图像', type: 'interactive', status: 'generating' }
  ] })])
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  assert.deepEqual(page.data.detail.pages.map((row) => [row.stateLabel, row.openable]), [['已完成', false], ['制作中', false]])
  page.openPage({ currentTarget: { dataset: { order: 1 } } })
  assert.deepEqual(navigations, [])
})
