// 学习分包页面第一次读到数据前只显示形状骨架；读到过一次后回到页面保留旧内容静默刷新，刷新失败也不换成错误页。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadPage(file, modules, extra = {}) {
  let definition
  const toasts = []
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({}),
    getCurrentPages: () => [{}, {}],
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    console,
    wx: {
      showToast(value) { toasts.push(value.title) }, navigateTo() {}, navigateBack() {}, switchTab() {}, stopPullDownRefresh() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 })
    },
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      if (name.endsWith('/services/achievement-cards') && !key) return { loadAchievementCards: async () => ({ series: [] }), stripCards: () => [] }
      if (name.endsWith('/services/share-cover') && !key) return require('../services/share-cover')
      if (name.endsWith('/payment-switch') && !key) return paymentSwitchStub({ navigateTo() {}, redirectTo() {} })
      if (!key) throw new Error(`Unexpected import ${name}`)
      return modules[key]
    },
    ...extra
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), toasts, setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = value
    }
  } }
  return page
}

// 可控的服务端：reply 决定下一次读取的结果，pending 为 true 时返回挂起的 Promise。
function controlledService() {
  const state = { reply: null, error: null, pending: false, resolve: null }
  const call = () => {
    if (state.pending) return new Promise((resolve) => { state.resolve = resolve })
    if (state.error) return Promise.reject(state.error)
    return Promise.resolve(typeof state.reply === 'function' ? state.reply() : state.reply)
  }
  return { state, call }
}

const EDITED_PAGES = [
  'daily-task', 'acceptance-result', 'remediation', 'schedule', 'library',
  'generation-status', 'agent-course', 'outline', 'check-in', 'live-session', 'agent-invite'
]

test('edited learning pages use shared shape skeletons instead of flat blocks or loading copy', () => {
  for (const name of EDITED_PAGES) {
    const wxml = read(`learning/${name}/index.wxml`)
    assert.match(wxml, /class="sk[ "]/, `${name} renders .sk skeleton blocks`)
    assert.doesNotMatch(wxml, /class="(?:[^"]* )?skeleton(?: [^"]*)?"/, `${name} no longer uses the flat grey .skeleton block`)
    assert.doesNotMatch(wxml, /正在读取|加载中/, `${name} has no loading copy`)
    // agent-invite 复用 live-session 的样式，骨架样式从那里一并引入。
    const wxss = read(`learning/${name === 'agent-invite' ? 'live-session' : name}/index.wxss`)
    assert.match(wxss, /@import "\.\.\/\.\.\/styles\/skeleton\.wxss";/, `${name} imports the skeleton styles`)
  }
})

test('check-in shows its fixed title immediately and skeletons instead of 0-day placeholders', () => {
  const wxml = read('learning/check-in/index.wxml')
  assert.match(wxml, />学习连胜<\/text>/)
  assert.match(wxml, /wx:if="\{\{loadState === 'loading'\}\}" class="checkin-skeleton"/)
})

test('schedule renders its fixed header outside the loading branch', () => {
  const wxml = read('learning/schedule/index.wxml')
  assert.ok(wxml.indexOf('陪跑日程') < wxml.indexOf('wx:if="{{loading}}"'))
})

// daily-task / acceptance-result / remediation / schedule 共用同一种 loading/loaded/failed 模式。
const SIMPLE_PAGES = [
  {
    name: 'daily-task', loader: 'loadCurrentLearningPlans', options: { planId: '1' }, field: 'plan',
    reply: () => ({ plans: [{ id: '1', name: '计划', status: 'active', items: [] }] })
  },
  {
    name: 'acceptance-result', loader: 'loadAuthorizedTopicLearningReports', options: { reportId: '5' }, field: 'result',
    reply: () => ({ students: [{ profile: { nickname: '小鹿' }, reports: [{ id: '5', status: 'ai_verified_passed' }] }] })
  },
  {
    name: 'remediation', loader: 'loadCurrentRemediationTasks', options: { acceptanceId: '8' }, field: 'task',
    reply: () => ({ tasks: [{ id: '3', acceptanceId: '8', status: 'active', topicName: '一次函数' }] })
  },
  {
    name: 'schedule', loader: 'loadCurrentLiveSchedule', options: {}, field: 'sessions',
    reply: () => ({ sessions: [{ id: '31', session: { id: '7', status: 'confirmed' } }], assignments: [] })
  }
]

for (const spec of SIMPLE_PAGES) {
  test(`${spec.name} shows skeleton only until the first load, then refreshes silently`, async () => {
    const service = controlledService()
    service.state.pending = true
    const page = loadPage(`learning/${spec.name}/index.js`, { '/identity': { [spec.loader]: service.call } })
    if (page.onLoad) page.onLoad(spec.options)
    const first = page.loadPage()
    assert.equal(page.data.loading, true)
    assert.equal(page.data.loaded, false)
    service.state.resolve(spec.reply())
    await first
    assert.equal(page.data.loading, false)
    assert.equal(page.data.loaded, true)
    const shown = JSON.stringify(page.data[spec.field])
    assert.ok(page.data[spec.field])

    // 回到页面：请求在途时仍显示旧内容，不回到骨架。
    service.state.pending = true
    const refresh = page.loadPage()
    assert.equal(page.data.loading, false)
    assert.equal(JSON.stringify(page.data[spec.field]), shown)
    service.state.resolve(spec.reply())
    await refresh

    // 静默刷新失败：保留旧内容，不切到错误页。
    service.state.pending = false
    service.state.error = new Error('offline')
    await page.loadPage()
    assert.equal(page.data.failed, false)
    assert.equal(JSON.stringify(page.data[spec.field]), shown)
  })

  test(`${spec.name} first-load failure shows the error state, not the empty state`, async () => {
    const service = controlledService()
    service.state.error = new Error('offline')
    const page = loadPage(`learning/${spec.name}/index.js`, { '/identity': { [spec.loader]: service.call } })
    if (page.onLoad) page.onLoad(spec.options)
    await page.loadPage()
    assert.equal(page.data.loading, false)
    assert.equal(page.data.loaded, false)
    assert.equal(page.data.failed, true)
  })
}

function libraryPage(service) {
  return loadPage('learning/library/index.js', {
    '/identity': { loadMemberCourseLibrary: service.call, loadViewerAccess: async () => 'ready' },
    '/live-tab-service': { getMyCourseLibrary: service.call },
    '/ui-assets': { attachUiAssets() {} },
    '/membership-gate': { openCustomCourseIntro() {} },
    '/access-gate': { guardAccess: () => false }
  })
}

test('library keeps the loaded course grid on return and on a failed refresh', async () => {
  const service = controlledService()
  service.state.reply = [{ id: 'a'.repeat(32), title: '一次函数', subject: '数学', grade: '8' }]
  const page = libraryPage(service)
  assert.equal(page.data.loading, true)
  await page.loadCourses()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.visibleCourses.length, 1)

  service.state.pending = true
  const refresh = page.loadCourses()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.visibleCourses.length, 1)
  service.state.resolve(service.state.reply)
  await refresh

  service.state.pending = false
  service.state.error = new Error('offline')
  await page.loadCourses()
  assert.equal(page.data.error, '')
  assert.equal(page.data.visibleCourses.length, 1)
})

test('library still shows a lapsed membership even after the grid was loaded', async () => {
  const service = controlledService()
  service.state.reply = [{ id: 'a'.repeat(32), title: '一次函数' }]
  const page = libraryPage(service)
  await page.loadCourses()
  service.state.error = Object.assign(new Error('请先开通会员'), { code: 'MEMBERSHIP_REQUIRED' })
  await page.loadCourses()
  assert.equal(page.data.membershipRequired, true)
  assert.equal(page.data.courses.length, 0)
})

function generationPage(service) {
  const page = loadPage('learning/generation-status/index.js', {
    '/identity': {
      loadCurrentLearningPlans: service.call,
      createCurrentCourseGenerationQuote: async () => ({}),
      confirmCurrentCourseGeneration: async () => ({}),
      prepareCourseOutlineReview: async () => ({}),
      loadCourseOutline: async () => ({})
    },
    '/course-state': require('../utils/course-state')
  })
  page.onLoad({ planItemId: '11' })
  return page
}

test('generation-status returns to the page without flashing the skeleton and survives a failed refresh', async () => {
  const service = controlledService()
  service.state.reply = { plans: [{ items: [{ id: '11', status: 'available', topicName: '一次函数', courseInstances: [] }] }] }
  const page = generationPage(service)
  await page.onShow()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.result.taskTitle, '一次函数')

  service.state.pending = true
  const back = page.onShow()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.result.taskTitle, '一次函数')
  service.state.resolve(service.state.reply)
  await back

  service.state.pending = false
  service.state.error = new Error('offline')
  await page.loadPage({ silent: true })
  assert.equal(page.data.failed, false)
  assert.equal(page.data.result.taskTitle, '一次函数')
  assert.equal(page.toasts.length, 0)
})

test('generation-status first-load failure shows the retry panel', async () => {
  const service = controlledService()
  service.state.error = new Error('offline')
  const page = generationPage(service)
  await page.onShow()
  assert.equal(page.data.failed, true)
  assert.equal(page.data.loaded, false)
})

test('live-session and agent-invite keep a shown meeting when a later refresh fails', async () => {
  const start = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const scheduleService = controlledService()
  scheduleService.state.reply = { profile: { nickname: '小鹿' }, assignments: [], sessions: [{ id: '31', status: 'confirmed', session: { id: '7', status: 'scheduled', scheduledStart: start, scheduledEnd: end, teacher: { displayName: '王老师' } } }] }
  const live = loadPage('learning/live-session/index.js', {
    '/identity': { loadCurrentLiveSchedule: scheduleService.call, loadCurrentUser: async () => null },
    '/live-session-view': require('../services/live-session-view'),
    '/ui-assets': { attachUiAssets() {} }
  })
  live.onLoad({ participantId: '31' })
  await live.loadPage()
  assert.equal(live.data.loadState, 'ready')
  scheduleService.state.error = new Error('offline')
  await live.loadPage()
  assert.equal(live.data.loadState, 'ready')

  const invite = loadPage('learning/agent-invite/index.js', {
    '/identity': { loadTeacherAgentInvite: async () => { throw new Error('offline') }, loadCurrentUser: async () => null },
    '/agent-invite-view': { buildAgentInviteModel: () => ({ state: 'upcoming', ticking: false }), inviteCoverOptions: () => ({}) },
    '/ui-assets': { attachUiAssets() {} },
    // 会议准备页按配置决定给不给「订阅通知」
    '/config/index': { SUBSCRIBE_TEMPLATES: {}, ACTION_FLOWS: {} }
  })
  invite.onLoad({ token: 't' })
  invite.data.loadState = 'ready'
  await invite.loadPage()
  assert.equal(invite.data.loadState, 'ready')
})

test('agent-invite first-load failure still shows the retry state', async () => {
  const invite = loadPage('learning/agent-invite/index.js', {
    '/identity': { loadTeacherAgentInvite: async () => { throw new Error('offline') }, loadCurrentUser: async () => null },
    '/agent-invite-view': { buildAgentInviteModel: () => ({}), inviteCoverOptions: () => ({}) },
    '/ui-assets': { attachUiAssets() {} },
    // 会议准备页按配置决定给不给「订阅通知」
    '/config/index': { SUBSCRIBE_TEMPLATES: {}, ACTION_FLOWS: {} }
  })
  invite.onLoad({ token: 't' })
  await invite.loadPage()
  assert.equal(invite.data.loadState, 'failed')
})
