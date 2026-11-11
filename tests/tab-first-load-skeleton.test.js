// 四个 tab 首页第一次读到真实数据前只显示骨架：不渲染演示数据，也不先闪空状态文案。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadPage(file, modules) {
  let definition
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({}),
    wx: {
      showToast() {}, navigateTo() {}, reLaunch() {}, vibrateShort() {}, nextTick(fn) { fn() },
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) })
    },
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/fit-font')) return require('../utils/fit-font')
      if (name.endsWith('/utils/account-role')) return require('../utils/account-role')
      if (name.endsWith('/utils/access-gate')) return require('../utils/access-gate')
      if (name.endsWith('/utils/score-tools-live')) return require('../utils/score-tools-live')
      if (name.endsWith('/utils/mini-program-version')) return require('../utils/mini-program-version')
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      if (name.endsWith('/utils/quest-path-view')) return require('../utils/quest-path-view')
      if (name.endsWith('/payment-switch') && !key) return paymentSwitchStub({ navigateTo() {}, redirectTo() {} })
      if (!key) throw new Error(`Unexpected import ${name}`)
      return modules[key]
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = value
    }
    if (callback) callback()
  } }
  return page
}

test('every tab page imports the shared skeleton styles', () => {
  for (const tab of ['home', 'learning', 'me', 'knowledge-map']) {
    assert.match(read(`pages/${tab}/index.wxss`), /@import "..\/..\/styles\/skeleton.wxss";/)
    assert.match(read(`pages/${tab}/index.wxml`), /sk/)
  }
})

test('home shows course skeletons instead of the empty shelf copy before the first load', async () => {
  let resolve
  const page = loadPage('pages/home/index.js', {
    '/live-tab-service': { getLiveHomeModel: () => new Promise((done) => { resolve = done }) },
    '/ui-assets': { attachUiAssets() {} },
    '/membership-gate': { openCustomCourseIntro() {} },
    '/referral-binding': { resolvePendingReferral: async () => null },
    '/identity': { isAuthenticationRequired: () => false }
  })
  assert.equal(page.data.loaded, false)
  assert.match(read('pages/home/index.wxml'), /wx:elif="\{\{!loaded\}\}"[^>]*more-courses-grid/)
  const pending = page.loadModel()
  resolve({ model: { notifications: { count: 0 }, moreCourses: [] }, dashboard: {} })
  await pending
  assert.equal(page.data.loaded, true)
})

test('home marks a failed first load so the page offers a retry instead of an empty shelf', async () => {
  const page = loadPage('pages/home/index.js', {
    '/live-tab-service': { getLiveHomeModel: async () => { throw new Error('offline') } },
    '/ui-assets': { attachUiAssets() {} },
    '/membership-gate': { openCustomCourseIntro() {} },
    '/referral-binding': { resolvePendingReferral: async () => null },
    '/identity': { isAuthenticationRequired: () => false }
  })
  await page.loadModel()
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.loadFailed, true)
})

test('learning skeleton model carries real dates but no demo tasks, courses or numbers', () => {
  const service = require('../services/live-tab-service')
  const model = service.getLearningSkeletonModel(0)
  assert.equal(model.studyTasks.length, 0)
  assert.equal(model.myCourses.length, 0)
  assert.equal(model.todoItems.length, 0)
  assert.equal(model.studyTaskCalendar.length, 7)
  assert.equal(model.studyTaskCalendar.some((day) => day.hasTask), false)
  assert.deepEqual(model.overview.map((item) => item.label), ['已完成', '连续学习', '当前任务'])
})

test('learning page starts from the skeleton model, not mock data', () => {
  const source = read('pages/learning/index.js')
  assert.doesNotMatch(source, /mock-service/)
  const page = loadPage('pages/learning/index.js', {
    '/live-tab-service': { getLearningSkeletonModel: () => ({ studyTasks: [], myCourses: [] }), getLiveLearningModel: async () => ({}) },
    '/agent-course-focus': { takeAgentCourseFocus: () => '' },
    '/identity': { loadCurrentServiceContacts: async () => ({ status: 'no_active_contacts', contacts: [] }), hasSession: () => true },
    '/customer-service': { openCustomerServiceChat: async () => {}, customerServiceErrorMessage: () => '' },
    '/ui-assets': { attachUiAssets() {} },
    '/achievement-cards': { loadAchievementCards: async () => ({ series: [] }), stripCards: () => [] }
  })
  page.onLoad()
  assert.equal(page.data.loaded, false)
  // 成就卡也从骨架开始：读到前不显示一句话、不显示卡
  assert.equal(page.data.cardsLoaded, false)
  assert.deepEqual(page.data.stripCards, [])
  assert.deepEqual(page.data.model.studyTasks, [])
})

test('me page keeps the loaded profile when shown again instead of resetting to placeholders', async () => {
  let profileCalls = 0
  const page = loadPage('pages/me/index.js', {
    '/mock-service': { getMeModel: () => ({ profile: { name: '演示用户', id: 'ZL1' }, accountSummary: [{ label: '课程积分', value: '286' }], quickActions: [{ label: '消息中心', unreadCount: 3 }] }) },
    '/live-tab-service': { getLiveMeModel: async () => { profileCalls += 1; return { profile: { name: '真实学生', id: '123456' }, accountSummary: [], quickActions: [] } }, withGuardianQuickActions: (actions) => actions },
    '/identity': { loadCurrentMembership: async () => null, loadCurrentTeacherWorkspace: async () => ({ status: 'not_teacher' }), hasSession: () => true },
    '/membership-view': { membershipView: (value) => ({ active: Boolean(value) }) },
    '/ui-assets': { attachUiAssets() {} }
  })
  page.onLoad()
  assert.equal(page.data.model.profile.name, '')
  assert.equal(page.data.model.accountSummary[0].value, '')
  assert.equal(page.data.model.quickActions[0].unreadCount, undefined)
  assert.equal(page.data.profileLoaded, false)
  await page.onShow()
  assert.equal(page.data.model.profile.name, '真实学生')
  const shown = page.onShow()
  assert.equal(page.data.model.profile.name, '真实学生')
  await shown
  assert.equal(profileCalls, 2)
})

test('live me model drops the demo unread badge', async () => {
  const module = { exports: {} }
  vm.runInNewContext(read('services/live-tab-service.js'), {
    module,
    require: (name) => {
      if (name === './mock-service') return { getMeModel: () => ({ profile: {}, accountSummary: [{}, {}], quickActions: [{ label: '消息中心', unreadCount: 3 }] }) }
      if (name === '../utils/account-role') return require('../utils/account-role')
      if (name === './identity') return {
        loadMeDashboard: async () => ({ profile: { displayName: '学生', publicId: '100001' }, balances: {} }),
        loadCurrentGrowthCenter: async () => null
      }
      return {}
    }
  })
  const model = await module.exports.getLiveMeModel()
  assert.equal(model.quickActions[0].unreadCount, undefined)
})

test('learning universe only shows its empty copy after a real load', () => {
  const wxml = read('pages/knowledge-universe/index.wxml')
  assert.match(wxml, /<block wx:if="\{\{loaded\}\}">[\s\S]*会进入你的学习宇宙[\s\S]*<\/block>/)
  assert.match(wxml, /wx:if="\{\{loadFailed\}\}"/)
  assert.match(read('pages/knowledge-map/index.js'), /if \(this\.data\.mapLoaded\) \{/)
})
