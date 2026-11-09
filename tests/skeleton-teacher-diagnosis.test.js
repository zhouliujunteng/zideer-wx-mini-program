// 老师端、测评、诊断页第一次读到数据前只画骨架：不闪默认值、「正在读取」文案或空状态；
// 读到过一次后回到页面保留旧数据静默刷新；第一次读取失败给重试，不给空状态。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

// teacher/add-student 打开时没有后端数据位（只有固定的输入表单，结果卡片在提交后才出现），不在此列；
// 核对老师身份期间不能提交，由下面「add student」用例盯着。
const PAGES = [
  'teacher/workspace', 'teacher/student-detail', 'teacher/live-room', 'teacher/study-plan', 'teacher/parent-report',
  'assessment/center', 'assessment/short',
  'diagnosis/report', 'diagnosis/subject', 'diagnosis/score-forecast', 'diagnosis/topic',
  'diagnosis/pre-plan', 'diagnosis/plans', 'diagnosis/plan-detail'
]

function loadPage(file, modules, wxExtra = {}) {
  let definition
  const toasts = []
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({}),
    getCurrentPages: () => [{}, {}],
    console,
    setInterval: () => 1,
    clearInterval() {},
    encodeURIComponent,
    decodeURIComponent,
    wx: {
      showToast(options) { toasts.push(options.title) }, navigateTo() {}, navigateBack() {}, switchTab() {}, redirectTo() {},
      setNavigationBarTitle() {}, stopPullDownRefresh() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, statusBarHeight: 44, safeArea: { bottom: 778 } }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      ...wxExtra
    },
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      if (name.endsWith('/utils/grade-name')) return require('../utils/grade-name')
      if (name.endsWith('/services/share-cover') && !key) return require('../services/share-cover')
      if (!key) throw new Error(`Unexpected import ${name}`)
      return modules[key]
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = value
    }
  } }
  return { page, toasts }
}

// 可控的后端：每次调用挂起，由测试决定返回或失败
function deferredService() {
  const pending = []
  const call = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  return { call, pending }
}

const uiAssets = { attachUiAssets() {} }
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('every page imports the shared skeleton and drops the flat block and loading copy', () => {
  for (const dir of PAGES) {
    assert.match(read(`${dir}/index.wxss`), /@import "..\/..\/styles\/skeleton.wxss";/, dir)
    const wxml = read(`${dir}/index.wxml`)
    assert.match(wxml, /class="sk\b/, dir)
    assert.doesNotMatch(wxml, /class="skeleton\b/, dir)
    assert.doesNotMatch(wxml, /正在读取|正在核对/, dir)
  }
})

test('diagnosis pages show the error panel and empty copy only after the first load settled', () => {
  for (const dir of ['diagnosis/report', 'diagnosis/subject', 'diagnosis/score-forecast', 'diagnosis/pre-plan', 'diagnosis/plans', 'diagnosis/plan-detail', 'diagnosis/topic']) {
    const wxml = read(`${dir}/index.wxml`)
    assert.match(wxml, /wx:if="\{\{failed && !loaded\}\}"/, dir)
    assert.match(wxml, /wx:elif="\{\{!loaded\}\}"/, dir)
  }
})

test('teacher workspace: skeleton until the first reply, then keeps the roster on return', async () => {
  const service = deferredService()
  const { page } = loadPage('teacher/workspace/index.js', { '/identity': { loadCurrentTeacherWorkspace: service.call }, '/ui-assets': uiAssets })
  const first = page.loadPage()
  assert.equal(page.data.loaded, false)
  service.pending[0].resolve({ status: 'ready', teacher: { name: '王老师' }, students: [{ name: '小鹿', grade: 8 }] })
  await first
  assert.equal(page.data.loaded, true)
  const again = page.loadPage()
  assert.equal(page.data.teacher.name, '王老师')
  assert.equal(page.data.students.length, 1)
  service.pending[1].reject(new Error('offline'))
  await again
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.students.length, 1)
})

test('teacher workspace: a failed first read is not mistaken for an empty roster', async () => {
  const { page } = loadPage('teacher/workspace/index.js', { '/identity': { loadCurrentTeacherWorkspace: async () => { throw new Error('offline') } }, '/ui-assets': uiAssets })
  await page.loadPage()
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.failed, true)
  assert.match(read('teacher/workspace/index.wxml'), /wx:elif="\{\{!loaded \|\| \(tab === 'behind' && alertsState === 'loading'\)\}\}" class="student-list"/)
})

test('add student: the form shows at once but cannot submit before the teacher check', async () => {
  const service = deferredService()
  let bound = 0
  const { page } = loadPage('teacher/add-student/index.js', { '/identity': { loadCurrentTeacherWorkspace: service.call, bindStudentAsCurrentTeacher: async () => { bound += 1; return { status: 'bound', student: {} } } }, '/ui-assets': uiAssets })
  page.onLoad()
  assert.equal(page.data.checking, true)
  page.setData({ code: '123456' })
  await page.submit()
  assert.equal(bound, 0)
  assert.match(read('teacher/add-student/index.wxml'), /disabled="\{\{checking \|\| submitting/)
  service.pending[0].resolve({ status: 'ready', teacher: { name: '王老师' }, students: [] })
})

test('student detail: a failed refresh keeps the loaded profile instead of the error page', async () => {
  let fail = false
  const { page, toasts } = loadPage('teacher/student-detail/index.js', {
    '/identity': { loadTeacherStudentProfile: async () => { if (fail) throw new Error('断网'); return { profile: { displayName: '小鹿', grade: 8 }, invites: [] } } },
    '/agent-invite-view': { buildInviteShareTitle: () => '', inviteCoverOptions: () => ({}) },
    '/ui-assets': uiAssets
  })
  page.onLoad({ studentProfileId: '9' })
  assert.equal(page.data.loadState, 'loading')
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  fail = true
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.profile.displayName, '小鹿')
  assert.deepEqual(toasts, ['断网'])
})

test('live room: once read, a network blip never swaps an empty room for the error state', async () => {
  let fail = false
  const { page } = loadPage('teacher/live-room/index.js', {
    '/live-room-service': { watchTeacherRoom: async () => { if (fail) throw new Error('断网'); return { status: 'ready', invite: { subject: '数学' }, messages: [], lastId: '' } }, sayAsTeacher: async () => ({}) },
    '/teacher-room-view': require('../services/teacher-room-view'),
    '/ui-assets': uiAssets,
    '/utils/navigation': require('../utils/navigation'),
    '/utils/voice-input': require('../utils/voice-input')
  })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  assert.equal(page.data.loadState, 'ready')
  fail = true
  await page.loadRoom()
  assert.equal(page.data.loadState, 'ready')
  page.onUnload()
})

test('assessment center: fixed copy renders at once, numbers wait for the backend', async () => {
  const service = deferredService()
  const { page } = loadPage('assessment/center/index.js', { '/identity': { loadAssessmentCenter: service.call }, '/ui-assets': uiAssets })
  page.onLoad()
  assert.equal(page.data.model.title, '测评中心')
  assert.equal(page.data.model.heroTitle, '先了解，再出发')
  assert.deepEqual(page.data.model.stats.map((item) => item.value), ['', '', ''])
  assert.equal(page.data.model.history.countLabel, '')
  assert.equal(page.data.loaded, false)
  const first = page.loadPage()
  service.pending[0].resolve({ attempts: [{ id: 1, status: 'submitted' }], subjects: [] })
  await first
  assert.equal(page.data.loaded, true)
  assert.deepEqual([...page.data.model.stats.map((item) => item.value)], ['0', '1', '0'])
  const again = page.loadPage()
  assert.equal(page.data.model.history.countLabel, '1 条记录')
  service.pending[1].reject(new Error('offline'))
  await again
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.model.history.records.length, 1)
})

test('assessment center: a failed first load offers a retry instead of empty sections', async () => {
  let fail = true
  const { page } = loadPage('assessment/center/index.js', { '/identity': { loadAssessmentCenter: async () => { if (fail) throw new Error('offline'); return { attempts: [], subjects: [] } } }, '/ui-assets': uiAssets })
  await page.loadPage()
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.loadFailed, true)
  assert.match(read('assessment/center/index.wxml'), /bindtap="retryLoad"/)
  fail = false
  await page.retryLoad({ type: 'tap' })
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.refreshing, false)
})

test('short assessment: returning to the page refreshes silently instead of showing the skeleton again', async () => {
  const service = deferredService()
  const { page } = loadPage('assessment/short/index.js', { '/assessment': { call: service.call, entryView: () => ({}), reportView: (value) => value || null } })
  page.onLoad({})
  page.onShow()
  assert.equal(page.data.loading, true)
  assert.equal(page.data.skeleton, 'list')
  service.pending[0].resolve({ scopes: [{ id: 1, name: '数学' }], attempts: [] })
  await flush()
  assert.equal(page.data.loading, false)
  page.onHide()
  page.onShow()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.scopes.length, 1)
  service.pending[1].reject(new Error('offline'))
  await flush()
  assert.equal(page.data.failed, false)
  assert.equal(page.data.scopes.length, 1)
})

test('short assessment: opening a saved attempt draws the question skeleton', () => {
  const service = deferredService()
  const { page } = loadPage('assessment/short/index.js', { '/assessment': { call: service.call, entryView: () => ({}), reportView: (value) => value || null } })
  page.onLoad({ attemptId: '51' })
  page.onShow()
  assert.equal(page.data.loading, true)
  assert.equal(page.data.skeleton, 'attempt')
})

const REPORTS = { reports: [{ status: 'completed', weakTopics: [{ name: '函数' }], summary: {} }], predictions: [] }
const PLANS = { plans: [{ id: 'p1', name: '计划', status: 'active', items: [] }] }

for (const [file, modules, reply, load, keep] of [
  ['diagnosis/report/index.js', (call) => ({ '/identity': { loadCurrentDiagnosticReports: call } }), REPORTS, 'loadPage', (data) => data.report],
  ['diagnosis/pre-plan/index.js', (call) => ({ '/identity': { loadCurrentDiagnosticReports: call } }), REPORTS, 'loadPage', (data) => data.topics.length],
  ['diagnosis/plans/index.js', (call) => ({ '/identity': { loadCurrentLearningPlans: call } }), PLANS, 'loadPage', (data) => data.plans.length],
  ['diagnosis/score-forecast/index.js', (call) => ({ '/assessment': { call, reportView: () => ({}) } }), { reports: [{ id: 1, report: {} }] }, 'loadPage', (data) => data.reports.length],
  ['diagnosis/plan-detail/index.js', (call) => ({ '/identity': { loadCurrentLearningPlans: call }, '/course-state': require('../utils/course-state') }), PLANS, 'onShow', (data) => data.plan]
]) {
  test(`${file}: skeleton first, silent refresh after, retry on first failure`, async () => {
    const service = deferredService()
    const { page } = loadPage(file, modules(service.call))
    if (page.onLoad) page.onLoad({ planId: 'p1' })
    const first = page[load]()
    assert.equal(page.data.loaded, false)
    service.pending[0].resolve(reply)
    await first
    assert.equal(page.data.loaded, true)
    assert.ok(keep(page.data))
    const again = page[load]()
    assert.equal(page.data.loaded, true)
    assert.ok(keep(page.data))
    service.pending[1].reject(new Error('offline'))
    await again
    assert.equal(page.data.loaded, true)
    assert.ok(keep(page.data))

    const failing = loadPage(file, modules(async () => { throw new Error('offline') })).page
    if (failing.onLoad) failing.onLoad({ planId: 'p1' })
    await failing[load]()
    assert.equal(failing.data.loaded, false)
    assert.equal(failing.data.failed, true)
  })
}

test('topic page keeps section titles on screen and offers a retry after a failed first read', async () => {
  let fail = true
  const { page } = loadPage('diagnosis/topic/index.js', {
    '/identity': {
      loadKnowledgeTopic: async () => { if (fail) throw new Error('offline'); return { id: 81, label: '函数' } },
      loadCurrentTopicCandidates: async () => ({ status: 'ready', candidates: [] }),
      addCurrentTopicCandidate: async () => ({}), removeCurrentTopicCandidate: async () => ({})
    },
    '/assessment': { call: async () => ({ states: [] }), masteryLabel: () => '' }
  })
  await page.loadTopic('81', '')
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.failed, true)
  fail = false
  await page.retryLoad()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.topic.label, '函数')
  const wxml = read('diagnosis/topic/index.wxml')
  assert.match(wxml, /'知识说明', '掌握标准', '前置知识', '后续知识', '我的掌握证据'/)
})
