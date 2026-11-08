// 消息、资料、兑换、智能体与 account/* 页面：第一次读到真实数据前只画骨架，
// 不显示演示数据、默认值、「加载中」文案或空状态；读到过一次后回到页面保留旧数据静默刷新。
const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/allow-diagnosis-room-entry')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadPage(file, modules, wxExtra = {}) {
  let definition
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({ globalData: {} }),
    getCurrentPages: () => [],
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    wx: {
      showToast() {}, showLoading() {}, hideLoading() {}, navigateTo() {}, reLaunch() {}, stopPullDownRefresh() {},
      getStorageSync: () => '', setStorageSync() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      ...wxExtra
    },
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
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

const skeletonPages = [
  'pages/messages', 'pages/system-messages', 'pages/redemption', 'pages/profile', 'pages/profile-setup', 'pages/diagnosis-room',
  'account/family', 'account/binding-code', 'account/guardian-dashboard', 'account/child-learning-feed',
  'account/identity', 'account/service-contact', 'account/login-identities', 'account/topic-learning-report'
]

test('pages with server data import the shared skeleton and drop loading copy and flat skeletons', () => {
  for (const page of skeletonPages) {
    assert.match(read(`${page}/index.wxss`), /@import "\.\.\/\.\.\/styles\/skeleton\.wxss";/, page)
    const wxml = read(`${page}/index.wxml`)
    assert.match(wxml, /class="sk /, page)
    assert.doesNotMatch(wxml, /正在(加载|读取)[^"]*…?<\/view>|读取中…|skeleton skeleton|class="[\w-]+ skeleton"/, page)
  }
})

test('messages: skeleton before the first read, empty copy only after it, old list kept when a refresh fails', async () => {
  let fail = false
  const page = loadPage('pages/messages/index.js', {
    '/identity': { loadCurrentNotifications: async () => { if (fail) throw new Error('offline'); return [{ id: 1, business_type: 'course', status: 'unread', payload: { title: '课程就绪' } }] } },
    '/message-view': require('../utils/message-view'),
    '/ui-assets': { attachUiAssets() {} }
  })
  assert.equal(page.data.loaded, false)
  const wxml = read('pages/messages/index.wxml')
  assert.match(wxml, /wx:if="\{\{!loaded && !failed\}\}" class="message-summary-skeleton"/)
  assert.ok(wxml.indexOf('model.emptyText') > wxml.indexOf('wx:elif="{{!loaded}}"'))
  await page.loadPage()
  assert.equal(page.data.loaded, true)
  fail = true
  await page.loadPage()
  assert.equal(page.data.failed, false)
  assert.equal(page.data.notifications.length, 1)
})

test('system messages show the category title immediately and ignore taps until loaded', async () => {
  const page = loadPage('pages/system-messages/index.js', {
    '/identity': { loadCurrentNotifications: async () => [], markCurrentNotificationRead: async () => {} },
    '/message-view': require('../utils/message-view')
  })
  page.onLoad({ category: 'assessment' })
  assert.equal(page.data.model.title, '评测反馈')
  assert.equal(page.data.loaded, false)
})

test('redemption hides the record count and empty copy until records load, and keeps the code on a failed first read', async () => {
  const wxml = read('pages/redemption/index.wxml')
  assert.match(wxml, /wx:if="\{\{loaded && model.historyCountLabel\}\}" class="redemption-section-count"/)
  assert.ok(wxml.lastIndexOf('还没有兑换记录') > wxml.indexOf('wx:elif="{{!loaded}}"'))
  const page = loadPage('pages/redemption/index.js', {
    '/identity': { loadCurrentGrowthCenter: async () => { throw new Error('offline') }, redeemCurrentStudentCode: async () => ({}) },
    '/ui-assets': { attachUiAssets() {} }
  })
  page.handleInput({ detail: { value: 'ab 12' } })
  await page.loadPage()
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.loadFailed, true)
  assert.equal(page.data.model.inputValue, 'AB12')
})

for (const [file, service, payload] of [
  ['account/family/index.js', 'loadCurrentFamilyRelations', { self: {}, students: [{ id: 1, student: { nickname: '小鹿' } }], guardians: [] }],
  ['account/guardian-dashboard/index.js', 'loadGuardianDashboard', { children: [{ profile: { id: 1, nickname: '小鹿' } }] }],
  ['account/child-learning-feed/index.js', 'loadGuardianLearningFeed', { children: [{ profile: { id: 1, nickname: '小鹿' } }] }],
  ['account/topic-learning-report/index.js', 'loadAuthorizedTopicLearningReports', { students: [{ id: 1, profile: { nickname: '小鹿' }, reports: [{ id: 5 }, { id: 6 }] }] }],
  ['account/service-contact/index.js', 'loadCurrentServiceContacts', { status: 'ready', contacts: [{ id: 'c1', title: '课程顾问' }] }]
]) {
  test(`${file}: first read marks loaded, a failed refresh keeps the old data instead of the error panel`, async () => {
    let fail = false
    const page = loadPage(file, {
      '/identity': { [service]: async () => { if (fail) throw new Error('offline'); return JSON.parse(JSON.stringify(payload)) } },
      '/customer-service': { isEnterpriseWechatContact: () => true, openCustomerServiceChat: async () => {}, customerServiceErrorMessage: () => '' },
      '/guardian-dashboard-view': require('../utils/guardian-dashboard-view'),
      '/ui-assets': { attachUiAssets() {} }
    }, { createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }) })
    assert.equal(page.data.loaded, false)
    await page.loadPage()
    assert.equal(page.data.loaded, true)
    const snapshot = JSON.stringify(page.data)
    fail = true
    await page.loadPage()
    assert.equal(page.data.failed, false)
    assert.equal(JSON.stringify({ ...page.data, loading: false }), JSON.stringify({ ...JSON.parse(snapshot), loading: false }))
  })
}

test('topic report refresh stays on the report the user was reading', async () => {
  const page = loadPage('account/topic-learning-report/index.js', {
    '/identity': { loadAuthorizedTopicLearningReports: async () => ({ students: [{ id: 1, profile: { nickname: '小鹿' }, reports: [{ id: 5 }, { id: 6 }] }] }) }
  })
  page.onLoad({})
  await page.loadPage()
  page.selectReport({ currentTarget: { dataset: { id: 6 } } })
  await page.loadPage()
  assert.equal(page.data.selected.id, 6)
})

test('binding code: returning to the page keeps the old code on screen while a new one is issued', async () => {
  let resolve
  const page = loadPage('account/binding-code/index.js', {
    '/identity': { createCurrentStudentBindingCode: () => new Promise((done) => { resolve = done }) }
  })
  let pending = page.loadCode()
  assert.equal(page.data.loaded, false)
  resolve({ code: '12345678', expiresAt: new Date(Date.now() + 60000).toISOString() })
  await pending
  pending = page.loadCode()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.code, '12345678')
  resolve({ code: '87654321', expiresAt: new Date(Date.now() + 60000).toISOString() })
  await pending
  page.stopTimer()
  assert.equal(page.data.code, '87654321')
})

test('identity: a failed refresh keeps the loaded status instead of the error panel', async () => {
  let fail = false
  const page = loadPage('account/identity/index.js', {
    '/identity': { loadCurrentIdentityVerification: async () => { if (fail) throw new Error('offline'); return { verification: { verification_status: 'verified' }, roles: [] } }, submitCurrentGuardianIdentityVerification: async () => ({}), isAuthenticationRequired: () => false },
    '/business-labels': { roleLabel: (code) => code }
  })
  page.onShow()
  await new Promise(setImmediate)
  assert.equal(page.data.identity.statusClass, 'verified')
  fail = true
  await page.loadPage()
  assert.equal(page.data.failed, false)
  assert.match(read('account/identity/index.wxml'), /wx:if="\{\{!identity && !failed\}\}"/)
})

function profilePage(loadCurrentUser, saves = []) {
  return loadPage('pages/profile/index.js', {
    '/mock-service': require('../services/mock-service'),
    '/identity': {
      loadCurrentUser, saveCurrentLearningProfile: async (form) => { saves.push(form); return { profile: {} } },
      isAuthenticationRequired: () => false, loadCurrentReferrer: async () => null, bindCurrentPromotionCode: async () => ({})
    },
    '/ui-assets': { attachUiAssets() {} },
    '/referral-context': { clearPendingReferral() {} }
  })
}

test('profile never shows the demo name or default values before the backend profile arrives', async () => {
  let resolve
  const saves = []
  const page = profilePage(() => new Promise((done) => { resolve = done }), saves)
  page.onLoad()
  assert.equal(page.data.profileLoaded, false)
  assert.equal(page.data.model.name, '')
  assert.ok(page.data.model.rows.every((row) => row.value === ''))
  assert.doesNotMatch(JSON.stringify(page.data.model.rows), /五年级|周流君腾/)
  assert.equal(page.data.promotion.loaded, false)
  // 资料没读到时不能用空值覆盖后端
  await page.handleSave()
  assert.equal(saves.length, 0)
  const shown = page.onShow()
  resolve({ profile: { id: 1, nickname: '', current_grade: 8, semester: '下学期' } })
  await shown
  assert.equal(page.data.profileLoaded, true)
  assert.equal(page.data.model.name, '')
  assert.equal(page.data.model.rows.find((row) => row.id === 'grade').value, '8年级下学期')
})

test('profile keeps the loaded profile on screen while it refreshes on return', async () => {
  let calls = 0
  let resolve
  const page = profilePage(() => { calls += 1; return calls === 1 ? Promise.resolve({ profile: { nickname: '小鹿' } }) : new Promise((done) => { resolve = done }) })
  page.onLoad()
  await page.onShow()
  const again = page.onShow()
  assert.equal(page.data.model.name, '小鹿')
  resolve({ profile: { nickname: '小鹿鹿' } })
  await again
  assert.equal(page.data.model.name, '小鹿鹿')
})

test('profile setup draws the role card skeleton instead of loading copy, and hides the step count until loaded', () => {
  const wxml = read('pages/profile-setup/index.wxml')
  assert.match(wxml, /wx:if="\{\{!loading && !loadFailed\}\}" class="profile-setup-progress"/)
  assert.match(wxml, /class="sk profile-role-pair-sk"/)
  assert.doesNotMatch(wxml, /正在读取学习档案/)
})

function agentChatPage(storage = {}) {
  const pagePath = require.resolve('../pages/diagnosis-room/index.js')
  delete require.cache[pagePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast() {},
    request() { return { abort() {}, onChunkReceived() {} } },
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return page
}

test('agent chat never carries the demo history into the real page', () => {
  const page = agentChatPage()
  page.onLoad({})
  assert.deepEqual(page.data.historyItems, [])
  assert.deepEqual(page.data.model.history.conversations, [])
  assert.equal(page.data.restoring, false)
  page.handleHistorySearch({ detail: { value: '分数' } })
  assert.deepEqual(page.data.historyItems, [])
  page.onUnload()
})

test('agent chat shows message skeletons instead of the welcome while it restores the last conversation', () => {
  const { COURSE_AGENT } = require('../services/course-agent-service')
  const page = agentChatPage({ [COURSE_AGENT.storageKeys.session]: 'session-1' })
  page.onLoad({})
  assert.equal(page.data.restoring, true)
  page.handleAgentStreamStatus('live')
  assert.equal(page.data.restoring, false)
  page.onUnload()
  assert.match(read('pages/diagnosis-room/index.wxml'), /wx:if="\{\{restoring && !messages\.length && !liveMode\}\}" class="agent-restore-skeleton"/)
})
