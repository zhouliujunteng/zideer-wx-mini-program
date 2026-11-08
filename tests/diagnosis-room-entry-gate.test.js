const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
require('./helpers/stub-ui-assets')

// 诊断室（pages/diagnosis-room）只给老师邀请的陪跑直播间用（2026-09-29 用户规则）。页面注册在 app.json 里，
// 任何人都能按路径直接打开：不带邀请时整页只有「请从老师的邀请进入」，不登录、不发请求、没有对话框。
const pagePath = require.resolve('../pages/diagnosis-room/index.js')
const identityPath = require.resolve('../services/identity.js')
const entryPath = require.resolve('../utils/diagnosis-room-entry.js')

function stubModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports, children: [], paths: [] }
}

function loadPage({ envVersion = 'release', pages = 1 } = {}) {
  delete require.cache[pagePath]
  delete require.cache[entryPath]
  const calls = { requests: [], switchTabs: [], backs: 0, invites: 0 }
  stubModule(identityPath, {
    loadTeacherAgentInvite: async () => {
      calls.invites += 1
      return { status: 'ready', online: false, invite: { token: 'tk1', subject: '数学', scheduledOnlineAt: '2099-01-01T00:00:00+08:00', teacherName: '王老师' } }
    },
    markTeacherAgentSession: async () => ({ status: 'ready' }),
    loadLearnerBaseline: async () => null
  })
  let definition = null
  global.Page = (page) => { definition = page }
  global.getApp = () => ({ globalData: {} })
  global.getCurrentPages = () => new Array(pages).fill({})
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    hideKeyboard() {},
    nextTick: (callback) => callback(),
    request: (options) => { calls.requests.push(options.url); return { abort() {}, onChunkReceived() {} } },
    switchTab: (options) => calls.switchTabs.push(options.url),
    navigateBack: () => { calls.backs += 1 },
    getRecorderManager: () => ({ onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {}, onPause() {}, onResume() {}, onInterruptionBegin() {}, onInterruptionEnd() {}, start() {}, stop() {} }),
    getFileSystemManager: () => ({ unlink() {} }),
    createSelectorQuery: () => {
      const query = { in: () => query, select: () => query, boundingClientRect: () => query, scrollOffset: () => query, fields: () => query, exec: (cb) => cb && cb([]) }
      return query
    }
  }
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, calls }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('opened by path without an invite: only the notice, no chat, no requests', async () => {
  const { page, calls } = loadPage()
  page.onLoad({})
  page.onShow()
  await sleep(5)
  assert.equal(page.data.entryBlocked, true)
  assert.equal((page.data.model || {}).header, undefined, '不加载对话页模型')
  assert.deepEqual(page.data.messages, [])
  assert.deepEqual(calls.requests, [], '不登录、不恢复上次对话、不发任何请求')
  page.onHide()
  page.onUnload()
})

test('a home-style prompt or the learning options do not open the chat either', () => {
  for (const options of [{ prompt: encodeURIComponent('帮我做一个复习计划') }, { universe: '1', mode: 'deep-interactive' }, { inviteToken: '   ' }]) {
    const { page } = loadPage()
    page.onLoad(options)
    assert.equal(page.data.entryBlocked, true, JSON.stringify(options))
    page.onUnload()
  }
})

test('the mock timeline only plays in the develop version', () => {
  for (const envVersion of ['release', 'trial']) {
    const { page } = loadPage({ envVersion })
    page.onLoad({ mock: '1' })
    assert.equal(page.data.entryBlocked, true, envVersion)
    page.onUnload()
  }
  const { page } = loadPage({ envVersion: 'develop' })
  page.onLoad({ mock: '1' })
  assert.equal(page.data.entryBlocked, false)
  assert.equal(page._agentMock, true)
  page.onUnload()
})

test('the teacher invite still opens the live room', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteToken: 'tk1' })
  await sleep(5)
  assert.equal(page.data.entryBlocked, false)
  assert.equal(page.data.liveMode, true)
  assert.equal(calls.invites, 1)
  page.onUnload()
})

test('back goes home when the page was opened directly, and back otherwise', () => {
  const direct = loadPage({ pages: 1 })
  direct.page.onLoad({})
  direct.page.handleBack()
  assert.deepEqual(direct.calls.switchTabs, ['/pages/home/index'])
  assert.equal(direct.calls.backs, 0)

  const stacked = loadPage({ pages: 2 })
  stacked.page.onLoad({})
  stacked.page.handleBack()
  assert.equal(stacked.calls.backs, 1)
  assert.deepEqual(stacked.calls.switchTabs, [])
})

test('the blocked view is its own branch: none of the chat markup renders', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  const blockedStart = template.indexOf('<view wx:if="{{entryBlocked}}" class="agent-page">')
  const chatStart = template.indexOf('<view wx:else class="agent-page">')
  assert.ok(blockedStart > 0, '没带邀请的说明页在最前面')
  assert.ok(chatStart > blockedStart, '对话页整页在 wx:else 里')
  const blocked = template.slice(blockedStart, chatStart)
  assert.match(blocked, /请从老师的邀请进入/)
  assert.match(blocked, /bindtap="handleEntryHome"/)
  assert.doesNotMatch(blocked, /agent-composer|agent-welcome|智能体|openHistory/)
})

test('the page is kept out of WeChat search', () => {
  const sitemap = JSON.parse(fs.readFileSync(path.join(__dirname, '../sitemap.json'), 'utf8'))
  const first = sitemap.rules.findIndex((rule) => rule.page === 'pages/diagnosis-room/index')
  assert.ok(first >= 0)
  assert.equal(sitemap.rules[first].action, 'disallow')
  const allowAll = sitemap.rules.findIndex((rule) => rule.page === '*' && rule.action === 'allow')
  assert.ok(allowAll < 0 || first < allowAll, 'disallow 要排在 allow * 前面才生效')
})
