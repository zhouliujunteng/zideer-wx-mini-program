// 老师排课与学生每日学习任务（2026-09-27 用户规则，课程服务 lib/course/study-plan.ts 的小程序这一半）：
// 老师在「学习安排」选每天学习时长（15 分钟打底 … 2 小时）、自动排课、逐条改日期 / 移除 / 添加；
// 学生详情「学习课程」按未学 / 学习中 / 已学完筛选；学生在「学习 › 学习任务」按日期看到老师排的任务。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const config = require('../config/index')
const phoneStatus = require('./helpers/verified-phone-session')
const view = require('../utils/study-plan-view')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const TODAY = '2026-09-27'
const flush = () => new Promise((resolve) => setImmediate(resolve))
// vm 沙箱里造出来的对象原型不同，严格深比较前先转成普通 JSON。
const plain = (value) => JSON.parse(JSON.stringify(value))

// ---------- 展示规则 ----------

test('daily durations are the six agreed options, 15 minutes as the baseline', () => {
  assert.deepEqual(view.MINUTE_OPTIONS.map((option) => option.minutes), [15, 30, 45, 60, 90, 120])
  assert.deepEqual(view.MINUTE_OPTIONS.map((option) => option.label), ['15 分钟', '30 分钟', '45 分钟', '1 小时', '1.5 小时', '2 小时'])
  assert.equal(view.MINUTE_OPTIONS[0].note, '打底')
  assert.equal(view.durationText(80), '1 小时 20 分钟')
})

test('days read relative to the course service today', () => {
  assert.equal(view.dayLabel(TODAY, TODAY), '今天')
  assert.equal(view.dayLabel('2026-09-28', TODAY), '明天')
  assert.equal(view.dayLabel('2026-09-29', TODAY), '后天')
  assert.equal(view.dayLabel('2026-10-08', TODAY), '10月8日')
  assert.equal(view.fullDayLabel(TODAY, TODAY), '今天 · 9月27日 周日')
  assert.equal(view.fullDayLabel('2026-10-08', TODAY), '10月8日 周四')
  assert.equal(view.addDays('2026-09-30', 1), '2026-10-01')
})

const task = (extra = {}) => ({
  id: 't-aaaaaaaa', day: TODAY, stageId: 'stage-a', title: '两位数退位减法', pageLabel: '第 1–3 页', minutes: 9,
  completed: 1, total: 3, progress: 33, state: 'in_progress', nextSceneId: 's2', overdue: false, source: 'auto', level: 1, subject: '数学', ...extra
})

test('teacher task rows show the state, pages, time, difficulty and carried-over days', () => {
  const learning = view.decorateTask(task(), TODAY)
  assert.deepEqual([learning.stateText, learning.stateTone, learning.meta, learning.pickerDay], ['学习中 1/3', 'action', '第 1–3 页 · 约 9 分钟 · 基础 · 数学', TODAY])
  const overdue = view.decorateTask(task({ day: '2026-09-25', overdue: true, state: 'not_started', level: 2 }), TODAY)
  assert.deepEqual([overdue.stateText, overdue.stateTone, overdue.pickerDay], ['补学', 'warn', TODAY])
  assert.match(overdue.meta, /提高 · 数学 · 原定9月25日$/)
  assert.equal(view.decorateTask(task({ state: 'done' }), TODAY).stateText, '已完成')
  const gone = view.decorateTask(task({ state: 'unavailable' }), TODAY)
  assert.deepEqual([gone.stateText, gone.meta], ['课程不可用', '学生已看不到这门课，可以移除这条任务'])
})

test('day cards compare the planned minutes with the daily time', () => {
  const over = view.decorateDay({ day: '2026-09-28', minutes: 36, tasks: [task()] }, TODAY, 30)
  assert.deepEqual([over.title, over.minutesText, over.overBudget, over.isToday], ['明天 · 9月28日 周一', '36 / 30 分钟', true, false])
  assert.equal(view.decorateDay({ day: TODAY, minutes: 33, tasks: [] }, TODAY, 30).overBudget, false)
  assert.equal(view.planSummary(null, TODAY), '还没有安排每天的学习任务')
  assert.equal(view.planSummary({ dailyMinutes: 30, lastDay: '2026-10-08' }, TODAY), '每天 30 分钟 · 排到10月8日')
  assert.equal(view.planSummary({ dailyMinutes: 90, lastDay: '' }, TODAY), '每天 1.5 小时 · 今天起还没有任务')
})

test('a course counts as learned only when every page has its record, as on the learning side', () => {
  const course = (learning, extra = {}) => ({ canLearn: true, status: 'completed', acceptance: { learning }, ...extra })
  assert.equal(view.courseLearningState(course({ completed: 0, total: 4, allRecorded: false, scenes: [] })), 'not_started')
  assert.equal(view.courseLearningState(course({ completed: 0, total: 4, allRecorded: false, scenes: [{ sceneId: 'q', state: 'in_progress' }] })), 'in_progress')
  assert.equal(view.courseLearningState(course({ completed: 2, total: 4, allRecorded: false, scenes: [] })), 'in_progress')
  assert.equal(view.courseLearningState(course({ completed: 4, total: 4, allRecorded: true, scenes: [] })), 'completed')
  assert.equal(view.courseLearningState(course(null)), 'unknown')
  assert.equal(view.courseLearningState({ canLearn: false, status: 'generating' }), 'generating')
  const tabs = view.courseFilterTabs([{ learningState: 'not_started' }, { learningState: 'completed' }, { learningState: 'generating' }], 'completed')
  assert.deepEqual(tabs.map((tab) => `${tab.label}${tab.count}${tab.active ? '*' : ''}`), ['全部3', '未学1', '学习中0', '已学完1*'])
})

// ---------- 老师「学习安排」页 ----------

const planCourse = (stageId, extra = {}) => ({ stageId, title: stageId, canLearn: true, learningState: 'not_started', completedPages: 0, totalPages: 4, minutes: 12, remainingMinutes: 12, scheduled: true, level: 1, subject: '数学', ...extra })

function planView(extra = {}) {
  return {
    teacher: { name: '王老师' },
    today: TODAY,
    dailyMinuteOptions: [15, 30, 45, 60, 90, 120],
    revision: 2,
    plan: {
      dailyMinutes: 30,
      startDay: TODAY,
      updatedAt: '2026-09-27T02:00:00.000Z',
      updatedByName: '王老师',
      lastDay: '2026-09-28',
      overdueCount: 0,
      days: [
        { day: TODAY, minutes: 24, tasks: [task({ id: 't-aaaaaaaa', stageId: 'stage-a' }), task({ id: 't-bbbbbbbb', stageId: 'stage-b', title: '三位数退位减法' })] },
        { day: '2026-09-28', minutes: 12, tasks: [task({ id: 't-cccccccc', day: '2026-09-28', stageId: 'stage-c' })] }
      ]
    },
    courses: [planCourse('stage-a'), planCourse('stage-b'), planCourse('stage-c'), planCourse('stage-done', { learningState: 'completed', remainingMinutes: 0 })],
    unscheduledCount: 0,
    ...extra
  }
}

function loadPlanPage(service, { confirm = true } = {}) {
  let definition
  const calls = { toasts: [], modals: [], navigations: [], loading: 0 }
  vm.runInNewContext(read('teacher/study-plan/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout,
    clearTimeout,
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      showModal: (options) => {
        calls.modals.push(options)
        if (options.success) options.success({ confirm, cancel: !confirm })
      },
      showLoading: () => { calls.loading += 1 },
      hideLoading() {},
      navigateTo: (options) => calls.navigations.push(options.url),
      navigateBack() {},
      redirectTo() {}
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/study-plan-view')) return view
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31', name: encodeURIComponent('小鹿') })
  return { page, calls }
}

test('the plan page draws skeletons first, then the saved time, the days and the courses left to add', async () => {
  let release
  const { page } = loadPlanPage({ loadTeacherStudyPlan: () => new Promise((resolve) => { release = resolve }) })
  const loading = page.onShow()
  assert.equal(page.data.loadState, 'loading')
  assert.equal(page.data.studentName, '小鹿')
  release(planView())
  await loading
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.selectedMinutes, 30)
  assert.equal(page.data.summaryText, '每天 30 分钟 · 排到明天')
  assert.deepEqual(page.data.days.map((day) => `${day.title}:${day.tasks.length}`), ['今天 · 9月27日 周日:2', '明天 · 9月28日 周一:1'])
  assert.deepEqual(page.data.addableCourses.map((course) => course.stageId), ['stage-a', 'stage-b', 'stage-c'])
  assert.equal(page.data.startDay, TODAY)
  assert.equal(page.data.maxStartDay, '2026-10-27')

  const template = read('teacher/study-plan/index.wxml')
  assert.match(template, /wx:for="\{\{minuteOptions\}\}"/)
  assert.match(template, /class="sk /)
  assert.match(template, /bindtap="handleAuto"/)
  assert.match(read('teacher/study-plan/index.wxss'), /@import "..\/..\/styles\/skeleton.wxss";/)
})

test('auto scheduling needs a chosen time and sends it with the start day and revision', async () => {
  const updates = []
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => planView({ plan: null, revision: 0, courses: [planCourse('stage-a', { scheduled: false })], unscheduledCount: 1 }),
    updateTeacherStudyPlan: async (id, revision, change) => {
      updates.push([id, revision, change])
      return { ...planView(), revision: 1, result: { taskCount: 3, dayCount: 2, firstDay: TODAY, lastDay: '2026-09-28', basis: 'ai', unscheduledCount: 0 } }
    }
  })
  await page.onShow()
  assert.equal(page.data.selectedMinutes, 0)
  await page.handleAuto()
  assert.deepEqual(calls.toasts, ['先选每天学习多长时间'])
  assert.equal(updates.length, 0)

  page.selectMinutes({ currentTarget: { dataset: { minutes: 45 } } })
  page.selectMinutes({ currentTarget: { dataset: { minutes: 50 } } })
  assert.equal(page.data.selectedMinutes, 45)
  await page.handleAuto()
  assert.deepEqual(plain(updates), [['31', 0, { action: 'auto', dailyMinutes: 45, startDay: TODAY, studyWeekdays: [1, 2, 3, 4, 5, 6, 7], restDays: [] }]])
  // 排课进度用页面里的进度条（2026-10-06），不再弹系统 loading
  assert.equal(calls.loading, 0)
  // 没有旧安排：不需要确认替换，直接排；排完说清楚排了多少、学生在哪看。
  assert.equal(calls.modals.length, 1)
  assert.match(calls.modals[0].content, /排好了 3 项学习任务，今天到明天，共 2 天/)
  assert.match(calls.modals[0].content, /学习 › 学习任务/)
  assert.equal(page.data.revision, 1)
  assert.equal(page.data.selectedMinutes, 30)
})

test('re-planning over existing days asks first, and declining changes nothing', async () => {
  const updates = []
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => planView(),
    updateTeacherStudyPlan: async (...args) => { updates.push(args); return planView() }
  }, { confirm: false })
  await page.onShow()
  await page.handleAuto()
  assert.equal(calls.modals.length, 1)
  assert.match(calls.modals[0].content, /今天起的学习任务会按每天 30 分钟 重新排/)
  assert.equal(updates.length, 0)
})

test('moving, removing and adding a task send the plan revision and apply the returned plan', async () => {
  const updates = []
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => planView(),
    updateTeacherStudyPlan: async (id, revision, change) => { updates.push([revision, change]); return { ...planView(), revision: revision + 1 } }
  })
  await page.onShow()
  // 原地没动不发请求
  await page.handleMoveTask({ currentTarget: { dataset: { taskId: 't-aaaaaaaa', day: TODAY, overdue: false } }, detail: { value: TODAY } })
  await page.handleMoveTask({ currentTarget: { dataset: { taskId: 't-aaaaaaaa', day: TODAY, overdue: false } }, detail: { value: '2026-09-30' } })
  await page.handleRemoveTask({ currentTarget: { dataset: { taskId: 't-bbbbbbbb', title: '三位数退位减法', pageLabel: '全部 4 页', day: TODAY, overdue: false } } })
  assert.match(calls.modals[0].content, /「三位数退位减法」 全部 4 页会从今天的学习任务里移除/)

  page.setData({ addableCourses: page.data.addableCourses.map((course) => course.stageId === 'stage-c' ? { ...course, scheduled: false } : course) })
  page.openAddSheet()
  assert.equal(page.data.sheetVisible, true)
  assert.equal(page.data.addStageId, 'stage-c')
  page.handleAddDay({ detail: { value: '2026-10-02' } })
  await page.submitAdd()

  assert.deepEqual(plain(updates), [
    [2, { action: 'move', taskId: 't-aaaaaaaa', day: '2026-09-30' }],
    [3, { action: 'remove', taskId: 't-bbbbbbbb' }],
    [4, { action: 'add', stageId: 'stage-c', day: '2026-10-02' }]
  ])
  assert.deepEqual(calls.toasts, ['已改到9月30日', '已移除', '已添加到10月2日'])
  assert.equal(page.data.sheetClosing, true)
})

test('a plan changed elsewhere reloads instead of being overwritten', async () => {
  let reads = 0
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => { reads += 1; return planView() },
    updateTeacherStudyPlan: async () => { throw Object.assign(new Error('学习安排刚被更新过，已刷新到最新，请再操作一次。'), { code: 'PLAN_CHANGED' }) }
  })
  await page.onShow()
  await page.handleClear()
  await flush()
  assert.equal(reads, 2)
  assert.deepEqual(calls.toasts, ['学习安排刚被更新过，已刷新到最新，请再操作一次。'])
})

test('a failed first read offers a retry; a failed refresh keeps the plan on screen', async () => {
  let fail = true
  const { page, calls } = loadPlanPage({ loadTeacherStudyPlan: async () => { if (fail) throw new Error('断网了'); return planView() } })
  await page.onShow()
  assert.deepEqual([page.data.loadState, page.data.loadError], ['failed', '断网了'])
  fail = false
  await page.load()
  assert.equal(page.data.loadState, 'ready')
  fail = true
  await page.onShow()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.days.length, 2)
  assert.deepEqual(calls.toasts, ['断网了'])
})

// ---------- 学生详情「学习课程」：筛选与学习安排入口 ----------

function loadStudentDetail(courses) {
  let definition
  const navigations = []
  vm.runInNewContext(read('teacher/student-detail/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast() {},
      navigateTo: (options) => navigations.push(options.url)
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          loadTeacherStudentProfile: async () => ({ profile: { displayName: '小鹿', grade: 4 }, invites: [] }),
          loadTeacherStudentAgentCourses: async () => ({ courses }),
          loadTeacherStudentAssessments: async () => []
        }
      }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/study-plan-view')) return view
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      if (name.endsWith('/services/share-cover')) return require('../services/share-cover')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) target = target[parts.shift()]
        target[parts[0]] = value
      }
      if (callback) callback()
    }
  }
  return { page, navigations }
}

test('student detail filters courses by 未学 / 学习中 / 已学完 and opens the study plan', async () => {
  const learning = (completed, total, allRecorded = false) => ({ completed, total, allRecorded, scenes: [] })
  const { page, navigations } = loadStudentDetail([
    { stageId: 'stage-new', title: '认识钟表', status: 'completed', canLearn: true, acceptance: { status: 'not_started', learningComplete: false, learning: learning(0, 4) } },
    { stageId: 'stage-half', title: '两位数退位减法', status: 'completed', canLearn: true, acceptance: { status: 'not_started', learningComplete: false, learning: learning(2, 4) } },
    { stageId: 'stage-done', title: '三位数退位减法', status: 'completed', canLearn: true, acceptance: { status: 'pending_teacher', learningComplete: true, learning: learning(5, 5, true) } },
    { stageId: 'stage-making', title: '万以内加减法', status: 'generating', canLearn: false, acceptance: { status: 'not_started', learningComplete: false, learning: null } }
  ])
  page.onLoad({ studentProfileId: '31', name: encodeURIComponent('小鹿') })
  await page.loadPage()
  await page.loadCourses()
  assert.deepEqual(page.data.courseFilters.map((tab) => `${tab.label}${tab.count}`), ['全部4', '未学1', '学习中1', '已学完1'])
  assert.equal(page.data.visibleCourses.length, 4)
  // 待核验的排最前
  assert.equal(page.data.visibleCourses[0].stageId, 'stage-done')

  // 还没进入验收的课，右侧状态跟学习情况走（不再一律写「学习中」）
  assert.deepEqual(plain(page.data.courses.map((course) => [course.stageId, course.statusText])), [
    ['stage-done', '待你核验'], ['stage-new', '未学'], ['stage-half', '学习中'], ['stage-making', '生成中']
  ])
  page.handleCourseFilter({ currentTarget: { dataset: { filter: 'not_started' } } })
  assert.deepEqual(page.data.visibleCourses.map((course) => [course.stageId, course.progressText]), [['stage-new', '还没开始学 · 共 4 部分']])
  page.handleCourseFilter({ currentTarget: { dataset: { filter: 'in_progress' } } })
  assert.deepEqual(page.data.visibleCourses.map((course) => [course.stageId, course.progressText]), [['stage-half', '已学 2 / 4 部分']])
  page.handleCourseFilter({ currentTarget: { dataset: { filter: 'completed' } } })
  assert.deepEqual(page.data.visibleCourses.map((course) => [course.stageId, course.progressText]), [['stage-done', '已学完 5 部分']])
  // 刷新课程时保留老师选的筛选
  await page.loadCourses()
  assert.equal(page.data.courseFilter, 'completed')
  assert.equal(page.data.visibleCourses.length, 1)

  page.openStudyPlan()
  assert.deepEqual(navigations, [`/teacher/study-plan/index?studentProfileId=31&name=${encodeURIComponent('小鹿')}`])
  const template = read('teacher/student-detail/index.wxml')
  assert.match(template, /bindtap="openStudyPlan"/)
  assert.match(template, /wx:for="\{\{courseFilters\}\}"[^>]*bindtap="handleCourseFilter"/)
  assert.match(template, /wx:for="\{\{visibleCourses\}\}"/)
  assert.ok(JSON.parse(read('app.json')).subpackages.find((pkg) => pkg.root === 'teacher').pages.includes('study-plan/index'))
})

// ---------- 服务层：课程服务接口 ----------

function identityService(respond) {
  const state = { token: 'signed-in', requests: [] }
  const wx = {
    getStorageSync: (key) => key === 'zion_runtime_token' ? state.token : '',
    setStorageSync() {},
    removeStorageSync() {},
    request(options) {
      if (phoneStatus(options)) return
      state.requests.push(options)
      options.success({ statusCode: 200, data: respond(options) })
    }
  }
  global.wx = wx
  const module = { exports: {} }
  vm.runInNewContext(read('services/identity.js'), {
    module, wx, console,
    getApp: () => ({ globalData: {} }),
    getCurrentPages: () => [{ route: 'pages/learning/index' }],
    require: (name) => require(path.join(__dirname, '../services', name))
  })
  return { api: module.exports, state }
}

test('the service calls the teacher and learner study-plan endpoints with the right payloads', async () => {
  const { api, state } = identityService((options) => /\/api\/learn\/study-plan$/.test(options.url)
    ? {
        today: TODAY,
        dailyMinutes: 30,
        days: [{ day: TODAY, minutes: 12, tasks: [
          { id: 't-1', stageId: 'stage-a', title: '退位减法', pageLabel: '第 3–4 页', minutes: 6, progress: 140, done: false, started: true, nextSceneId: 'scene_3', overdue: true, subject: '数学' },
          { id: 't-2', stageId: '../evil', title: 'x' },
          { id: 't-3', stageId: 'stage-b', title: '竖式', nextSceneId: 'bad scene id', progress: -5, done: true }
        ] }]
      }
    : { revision: 1 })

  await api.loadTeacherStudyPlan('31')
  await api.updateTeacherStudyPlan('31', 4, { action: 'auto', dailyMinutes: 45, startDay: TODAY })
  await api.updateTeacherStudyPlan('31', 5, { action: 'remove', taskId: 't-abcdefgh' })
  const days = await api.loadStudyPlanDays()
  const [get, auto, remove, learner] = state.requests
  assert.equal(get.url, `${config.COURSE_PORTAL_ORIGIN.replace(/\/$/, '')}/api/teacher/study-plan?studentProfileId=31`)
  assert.equal(get.header.authorization, 'Bearer signed-in')
  assert.deepEqual(plain([auto.method, auto.timeout, auto.data]), ['POST', 60000, { action: 'auto', dailyMinutes: 45, startDay: TODAY, studentProfileId: '31', revision: 4 }])
  assert.deepEqual(plain([remove.timeout, remove.data]), [20000, { action: 'remove', taskId: 't-abcdefgh', studentProfileId: '31', revision: 5 }])
  assert.match(learner.url, /\/api\/learn\/study-plan$/)
  assert.deepEqual(plain(days.days[0].tasks.map((item) => [item.stageId, item.progress, item.nextSceneId, item.overdue, item.done])), [
    ['stage-a', 100, 'scene_3', true, false],
    ['stage-b', 0, '', false, true]
  ])
  await assert.rejects(api.loadTeacherStudyPlan('x'), /学生信息不完整/)
})

// ---------- 学生「学习 › 学习任务」 ----------

function loadLearningService(studyPlan) {
  const module = { exports: {} }
  vm.runInNewContext(read('services/live-tab-service.js'), {
    module,
    require: (name) => name === './mock-service'
      ? { getLearningModel: () => ({ notifications: {}, student: {} }) }
      : name === '../utils/agent-course-view' ? require('../utils/agent-course-view')
        : name === './checkin-model' || name === './learning-streak' || name === '../utils/account-role' ? {}
          : {
              loadLearningDashboard: async () => ({ students: [{}], tasks: [{ id: 9, title: '旧学习计划任务', status: 'active', progress: 0 }], summary: { completed: 0 }, currentTask: { duration: 20 } }),
              loadAgentCourses: async () => [],
              loadCourseCovers: async () => ({}),
              loadStudyPlanDays: studyPlan
            }
  })
  return module.exports
}

const week = () => ({
  today: TODAY,
  dailyMinutes: 30,
  days: Array.from({ length: 7 }, (_, index) => ({ day: view.addDays(TODAY, index), minutes: 0, tasks: [] }))
})

test('the learning tab lists the teacher’s tasks on their days, carried-over ones first', async () => {
  const plan = week()
  plan.days[0].tasks = [
    { id: 't-old', stageId: 'stage-a', title: '两位数退位减法', pageLabel: '第 3–4 页', minutes: 6, progress: 0, done: false, started: true, nextSceneId: 'a3', overdue: true, subject: '数学' },
    { id: 't-now', stageId: 'stage-b', title: '三位数退位减法', pageLabel: '全部 4 页', minutes: 12, progress: 50, done: false, started: true, nextSceneId: 'b3', overdue: false, subject: '数学' }
  ]
  plan.days[2].tasks = [{ id: 't-later', stageId: 'stage-c', title: '验算', pageLabel: '全部 4 页', minutes: 12, progress: 0, done: false, started: false, nextSceneId: 'c1', overdue: false, subject: '' }]
  const service = loadLearningService(async () => plan)

  const today = (await service.getLiveLearningModel(0)).model
  assert.deepEqual(plain(today.studyTasks.map((row) => [row.id, row.meta, row.progress])), [
    ['plan-t-old', '前几天没学完 · 第 3–4 页 · 约 6 分钟', 0],
    ['plan-t-now', '全部 4 页 · 约 12 分钟', 50],
    [9, '学习任务', 0]
  ])
  assert.deepEqual(plain(today.studyTaskCalendar.map((day) => day.hasTask)), [true, false, true, false, false, false, false])
  // 「当前任务」是今天第一条没学完的老师任务
  assert.equal(today.overview[2].value, '6')

  const later = (await service.getLiveLearningModel(2)).model
  assert.deepEqual(plain(later.studyTasks.map((row) => [row.id, row.kind, row.stageId, row.sceneId])), [['plan-t-later', 'study-plan', 'stage-c', 'c1']])

  // 学习安排读不到：只是不显示这些任务，学习页照常
  const offline = loadLearningService(async () => { throw new Error('断网') })
  const fallback = (await offline.getLiveLearningModel(0)).model
  assert.deepEqual(plain(fallback.studyTasks.map((row) => row.id)), [9])
  assert.equal(fallback.overview[2].value, '20')
})

test('tapping a teacher task starts the course at its first unlearned page', () => {
  let definition
  const navigations = []
  vm.runInNewContext(read('pages/learning/index.js'), {
    Page(config) { definition = config },
    getApp: () => ({}),
    console,
    setTimeout,
    clearTimeout,
    wx: { navigateTo: (options) => navigations.push(options.url) },
    require: (name) => name.endsWith('/utils/my-course-groups') ? require('../utils/my-course-groups') : new Proxy({}, { get: () => () => ({}) })
  })
  const page = { ...definition, data: { ...definition.data, dashboard: null } }
  page.openTask({ currentTarget: { dataset: { kind: 'study-plan', stageId: 'stage-b', sceneId: 'b3', done: false } } })
  page.openTask({ currentTarget: { dataset: { kind: 'study-plan', stageId: 'stage-a', sceneId: '', done: true } } })
  page.openTask({ currentTarget: { dataset: { kind: 'study-plan', stageId: '../x', sceneId: 'b3', done: false } } })
  assert.deepEqual(navigations, [
    '/learning/course/index?agentCourseId=stage-b&sceneId=b3',
    '/learning/agent-course/index?stageId=stage-a'
  ])
  assert.match(read('pages/learning/index.wxml'), /data-kind="\{\{item\.kind\}\}" data-stage-id="\{\{item\.stageId\}\}" data-scene-id="\{\{item\.sceneId\}\}" data-done="\{\{item\.done\}\}" bindtap="openTask"/)
})

// 间隔复习（2026-10-08）：复习任务排在当天最前面，点进去做复习小测；老师看到但不能挪、不能删。
test('review tasks lead the day, open the review quiz, and are fixed for the teacher', async () => {
  const plan = week()
  plan.days[0].tasks = [
    { id: 'review-stage-a', kind: 'review', stageId: 'stage-a', title: '约分', pageLabel: '复习小测', minutes: 5, progress: 0, done: false, started: false, nextSceneId: '', overdue: true, subject: '数学' },
    { id: 't-now', kind: 'learn', stageId: 'stage-b', title: '通分', pageLabel: '全部 4 页', minutes: 12, progress: 0, done: false, started: false, nextSceneId: 'b1', overdue: false, subject: '数学' }
  ]
  const service = loadLearningService(async () => plan)
  const today = (await service.getLiveLearningModel(0)).model
  assert.deepEqual(plain(today.studyTasks.slice(0, 2).map((row) => [row.kind, row.title, row.meta])), [
    ['review', '复习：约分', '前几天没复习 · 不看课程回答几个问题 · 约 5 分钟'],
    ['study-plan', '通分', '全部 4 页 · 约 12 分钟']
  ])

  let definition
  const navigations = []
  vm.runInNewContext(read('pages/learning/index.js'), {
    Page(config) { definition = config },
    getApp: () => ({}),
    console,
    setTimeout,
    clearTimeout,
    wx: { navigateTo: (options) => navigations.push(options.url) },
    require: (name) => name.endsWith('/utils/my-course-groups') ? require('../utils/my-course-groups') : new Proxy({}, { get: () => () => ({}) })
  })
  const page = { ...definition, data: { ...definition.data, dashboard: null } }
  page.openTask({ currentTarget: { dataset: { kind: 'review', stageId: 'stage-a', done: false } } })
  page.openTask({ currentTarget: { dataset: { kind: 'review', stageId: '../x', done: false } } })
  assert.deepEqual(navigations, ['/learning/review/index?stageId=stage-a'])
  assert.ok((JSON.parse(read('app.json')).subpackages || JSON.parse(read('app.json')).subPackages).some((pkg) => pkg.root === 'learning' && pkg.pages.includes('review/index')))
  assert.match(read('teacher/study-plan/index.wxml'), /task\.state !== 'done' && !task\.isReview/)
})

test('the teacher sees review tasks with their own state labels', () => {
  const review = { id: 'review-stage-a', kind: 'review', day: TODAY, stageId: 'stage-a', title: '约分', minutes: 5, state: 'not_started', overdue: false, subject: '数学' }
  assert.deepEqual(plain(['title', 'stateText', 'stateTone', 'meta', 'isReview'].map((key) => view.decorateTask(review, TODAY)[key])),
    ['复习：约分', '待复习', 'muted', '不看课程的回忆小测 · 约 5 分钟 · 数学', true])
  assert.equal(view.decorateTask({ ...review, overdue: true }, TODAY).stateText, '待补复习')
  assert.equal(view.decorateTask({ ...review, state: 'done' }, TODAY).stateText, '已复习')
})

// ---------- 每周学习日与休息日（2026-10-09） ----------

test('study weekdays read naturally and drive the plan summary', () => {
  assert.equal(view.weekdaysText([1, 2, 3, 4, 5, 6, 7]), '每天')
  assert.equal(view.weekdaysText([1, 2, 3, 4, 5]), '周一到周五')
  assert.equal(view.weekdaysText([6, 7]), '周末')
  assert.equal(view.weekdaysText([1, 3, 5]), '周一、周三、周五')
  assert.equal(view.weekdaysText([]), '每天')
  assert.equal(view.weekdayNumber('2026-09-27'), 7)
  assert.equal(view.isStudyDay('2026-09-28', [1, 2, 3, 4, 5], []), true)
  assert.equal(view.isStudyDay('2026-09-28', [1, 2, 3, 4, 5], ['2026-09-28']), false)
  assert.equal(view.planSummary({ dailyMinutes: 30, lastDay: '2026-10-08', studyWeekdays: [1, 2, 3, 4, 5] }, TODAY), '周一到周五学习，每次 30 分钟 · 排到10月8日')
})

test('teachers pick study weekdays and rest days, sent with auto scheduling', async () => {
  const updates = []
  const saved = planView()
  saved.plan.studyWeekdays = [1, 2, 3, 4, 5]
  saved.plan.restDays = ['2026-09-20', '2026-10-01']
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => saved,
    updateTeacherStudyPlan: async (id, revision, change) => {
      updates.push(change)
      return { ...saved, plan: { ...saved.plan, studyWeekdays: change.studyWeekdays, restDays: change.restDays }, revision: 3, result: { taskCount: 1, dayCount: 1, firstDay: TODAY, lastDay: TODAY, basis: 'single', unscheduledCount: 0 } }
    }
  })
  await page.onShow()
  // 已保存的学习日；过去的休息日不再显示
  assert.deepEqual(page.data.weekdayOptions.filter((item) => item.selected).map((item) => item.value), [1, 2, 3, 4, 5])
  assert.equal(page.data.weekdaysCaption, '周一到周五学习，每周 5 天')
  assert.deepEqual(page.data.restDayItems.map((item) => item.text), ['10月1日 周四'])
  assert.equal(page.data.scheduleTouched, false)

  page.toggleWeekday({ currentTarget: { dataset: { value: 6 } } })
  page.toggleWeekday({ currentTarget: { dataset: { value: 1 } } })
  page.addRestDay({ detail: { value: '2026-09-29' } })
  page.removeRestDay({ currentTarget: { dataset: { day: '2026-10-01' } } })
  assert.equal(page.data.scheduleTouched, true)
  // 刷新不丢掉还没排课的修改
  await page.onShow()
  assert.deepEqual(page.data.restDayItems.map((item) => item.day), ['2026-09-29'])

  await page.handleAuto()
  assert.match(calls.modals[0].content, /周二到周六学习、每次 30 分钟 重新排/)
  assert.deepEqual(plain(updates), [{ action: 'auto', dailyMinutes: 30, startDay: TODAY, studyWeekdays: [2, 3, 4, 5, 6], restDays: ['2026-09-29'] }])
  assert.equal(page.data.scheduleTouched, false)

  // 每周至少学一天
  for (const value of [2, 3, 4, 5, 6]) page.toggleWeekday({ currentTarget: { dataset: { value } } })
  assert.deepEqual(page.data.weekdayOptions.filter((item) => item.selected).map((item) => item.value), [6])
  assert.ok(calls.toasts.includes('每周至少学一天'))
  assert.match(read('teacher/study-plan/index.wxml'), /bindtap="toggleWeekday"/)
  assert.match(read('teacher/study-plan/index.wxml'), /bindchange="addRestDay"/)
})

test('carried tasks say which study day they moved to when today is a rest day', async () => {
  const saved = planView()
  saved.plan.overdueCount = 2
  saved.plan.carryDay = '2026-09-28'
  const { page } = loadPlanPage({ loadTeacherStudyPlan: async () => saved })
  await page.onShow()
  assert.equal(page.data.carryDayText, '明天（今天休息）')
  assert.match(read('teacher/study-plan/index.wxml'), /已经带到\{\{carryDayText\}\}/)
})

// ---------- 老师工作台「没完成任务」与催学的话（2026-10-09） ----------

function loadWorkspace(service) {
  let definition
  const calls = { navigations: [] }
  vm.runInNewContext(read('teacher/workspace/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast() {},
      navigateTo: (options) => calls.navigations.push(options.url)
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/study-plan-view')) return view
      if (name.endsWith('/grade-name')) return require('../utils/grade-name')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad()
  return { page, calls }
}

const roster = {
  status: 'ready',
  teacher: { name: '王老师' },
  students: [
    { bindingId: '1', studentProfileId: '31', publicId: '100031', name: '小鹿', grade: 7 },
    { bindingId: '2', studentProfileId: '32', publicId: '100032', name: '小林', grade: 7 }
  ]
}

test('the workspace lists students behind on their tasks under their own tab', async () => {
  let release
  const { page, calls } = loadWorkspace({
    loadCurrentTeacherWorkspace: async () => roster,
    loadTeacherStudyAlerts: () => new Promise((resolve) => { release = resolve })
  })
  page.onShow()
  await flush()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.alertsState, 'loading')
  page.switchTab({ currentTarget: { dataset: { tab: 'behind' } } })
  assert.equal(page.data.tab, 'behind')
  release({
    today: TODAY,
    failedCount: 1,
    alerts: [
      { studentProfileId: '31', taskCount: 2, minutes: 18, lastMissedDay: '2026-09-26', firstMissedDay: '2026-09-26', carryDay: TODAY, titles: ['约分', '通分'] },
      { studentProfileId: '32', taskCount: 1, minutes: 6, lastMissedDay: '2026-09-25', firstMissedDay: '2026-09-23', carryDay: '2026-09-28', titles: ['分数'] },
      { studentProfileId: '99', taskCount: 1, minutes: 6, lastMissedDay: '2026-09-26', firstMissedDay: '2026-09-26', carryDay: TODAY, titles: ['x'] }
    ]
  })
  await flush()
  assert.equal(page.data.alertsState, 'ready')
  assert.equal(page.data.alertCount, 2)
  assert.equal(page.data.alertsFailedCount, 1)
  assert.deepEqual(page.data.visibleAlerts.map((item) => `${item.name}|${item.missedText}|${item.detailText}`), [
    '小鹿|昨天的任务没学完 · 2 项|已带到今天 · 约 18 分钟 · 《约分》等',
    '小林|9月23日起有任务没学完 · 1 项|今天休息，已带到9月28日 · 约 6 分钟 · 《分数》'
  ])
  page.handleSearch({ detail: { value: '小林' } })
  assert.deepEqual(page.data.visibleAlerts.map((item) => item.name), ['小林'])
  page.openReminder({ currentTarget: { dataset: { studentProfileId: '32', id: '100032', name: '小林' } } })
  assert.match(calls.navigations[0], /^\/teacher\/study-reminder\/index\?studentProfileId=32&/)

  const template = read('teacher/workspace/index.wxml')
  assert.match(template, /data-tab="behind"/)
  assert.match(template, /bindtap="openReminder"/)
  assert.ok(JSON.parse(read('app.json')).subpackages.find((pkg) => pkg.root === 'teacher').pages.includes('study-reminder/index'))
})

test('a failed alert read leaves the roster alone and offers a retry', async () => {
  const { page } = loadWorkspace({
    loadCurrentTeacherWorkspace: async () => roster,
    loadTeacherStudyAlerts: async () => { throw new Error('没完成任务的学生暂时读不到，请稍后重试。') }
  })
  await page.onShow()
  await flush()
  assert.equal(page.data.students.length, 2)
  assert.equal(page.data.alertsState, 'failed')
  assert.match(read('teacher/workspace/index.wxml'), /bindtap="loadAlerts"/)
})

function loadReminderPage(service) {
  let definition
  const calls = { clipboard: [], toasts: [] }
  vm.runInNewContext(read('teacher/study-reminder/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      setClipboardData: (options) => { calls.clipboard.push(options.data); if (options.success) options.success() },
      navigateTo() {},
      navigateBack() {},
      redirectTo() {}
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/study-plan-view')) return view
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31', name: encodeURIComponent('小鹿') })
  return { page, calls }
}

const reminderFacts = {
  today: TODAY,
  carryDay: TODAY,
  dailyMinutes: 30,
  missed: [{ title: '约分', pageLabel: '第 3–4 页', day: '2026-09-26', minutes: 6, completed: 0, total: 2 }],
  planned: []
}

test('the reminder page writes the note on first open and copies it for the teacher', async () => {
  const writes = []
  const { page, calls } = loadReminderPage({
    loadTeacherStudyReminder: async () => ({ today: TODAY, facts: reminderFacts, note: null }),
    createTeacherStudyReminder: async (id) => {
      writes.push(id)
      return { today: TODAY, facts: reminderFacts, note: { text: '小鹿，你昨天的《约分》还没学完……', teacherName: '王老师', updatedAt: '2026-09-27T02:00:00.000Z', outdated: false } }
    }
  })
  assert.equal(page.data.loadState, 'loading')
  await page.onShow()
  await flush()
  assert.deepEqual(writes, ['31'])
  assert.equal(page.data.summaryText, '1 项任务没学完，约 6 分钟')
  assert.deepEqual(page.data.missed.map((task) => `${task.dayText}|${task.meta}`), ['昨天|第 3–4 页 · 还没开始 · 约 6 分钟'])
  assert.equal(page.data.carryText, '这些没学完的内容已经带到今天，排在今天任务的最前面。')
  assert.match(page.data.note.text, /约分/)
  page.copyNote()
  assert.deepEqual(calls.clipboard, ['小鹿，你昨天的《约分》还没学完……'])
  // 再回到页面不重复生成
  await page.onShow()
  await flush()
  assert.equal(writes.length, 1)
})

test('the reminder page says so when nothing is left to catch up', async () => {
  let wrote = false
  const { page } = loadReminderPage({
    loadTeacherStudyReminder: async () => ({ today: TODAY, facts: { ...reminderFacts, missed: [] }, note: null }),
    createTeacherStudyReminder: async () => { wrote = true }
  })
  await page.onShow()
  await flush()
  assert.equal(wrote, false)
  assert.equal(page.data.missed.length, 0)
  assert.equal(page.data.summaryText, '前几天的任务都学完了')
  assert.match(read('teacher/study-reminder/index.wxml'), /class="sk /)
})
