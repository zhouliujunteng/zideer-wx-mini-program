const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 测试快捷方式「标记学完，去验收」（2026-10-03 用户要求）：课程详情页上，只给输入过「重置测试账号」开启码的手机。
const config = require('../config/index')
const { normalizeAgentCourse } = require('../utils/agent-course-view')

const STAGE = 'stage-abcDEF1234'
const FINISH_URL = `${config.COURSE_PORTAL_ORIGIN}/api/learn/agent-courses/${STAGE}/test-finish`
const storage = new Map()
const requests = []
let reply = { statusCode: 200, data: { course: { stageId: STAGE, title: '一次函数' }, learning: { completed: 3, total: 3 } } }

global.wx = {
  getStorageSync: (key) => storage.has(key) ? storage.get(key) : '',
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
  request(options) {
    if (require('./helpers/verified-phone-session')(options)) return
    requests.push(options)
    options.success(reply)
  }
}
const identity = require('../services/identity')

function reset(code = '123456AS') {
  storage.clear()
  storage.set('zion_runtime_token', `token-${Math.random()}`)
  if (code) storage.set('zhilu_dev_reset_code', code)
  requests.length = 0
  reply = { statusCode: 200, data: { course: { stageId: STAGE, title: '一次函数' }, learning: { completed: 3, total: 3 } } }
}

test('sends the remembered unlock code to the course service with the learner login', async () => {
  reset()
  const result = await identity.finishAgentCourseForTest(STAGE)
  assert.deepEqual(result.learning, { completed: 3, total: 3 })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, FINISH_URL)
  assert.equal(requests[0].method, 'POST')
  assert.deepEqual(requests[0].data, { code: '123456AS' })
  assert.equal(requests[0].header.authorization, `Bearer ${storage.get('zion_runtime_token')}`)
})

test('does not call the course service from a phone without the unlock code', async () => {
  reset('')
  await assert.rejects(identity.finishAgentCourseForTest(STAGE), /兑换码/)
  await assert.rejects(identity.finishAgentCourseForTest('not-a-stage'), /课程链接无效/)
  assert.equal(requests.length, 0)
})

test('forgets a retired unlock code so the test buttons disappear', async () => {
  reset()
  reply = { statusCode: 403, data: { code: 'DEV_RESET_FORBIDDEN' } }
  await assert.rejects(identity.finishAgentCourseForTest(STAGE), /开启码已失效/)
  assert.equal(storage.has('zhilu_dev_reset_code'), false)
})

function setupPage({ code = '123456AS', finish = async () => ({}) } = {}) {
  let definition
  let devResetListener = null
  const navigations = []
  const toasts = []
  const finishCalls = []
  const modal = { confirm: true }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.js'), 'utf8'), {
    Page: (value) => { definition = value },
    require: (name) => {
      if (name.endsWith('payment-switch')) return { attachPaymentSwitch() {}, openPaymentPage() {} }
      if (name.endsWith('agent-course-view')) return require('../utils/agent-course-view')
      if (name.endsWith('practice-view')) return require('../utils/practice-view')
      if (name.endsWith('utils/screen')) return require('../utils/screen')
      if (name.endsWith('ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('utils/dev-reset')) {
        return {
          readDevResetCode: () => code,
          onDevResetChange: (listener) => { devResetListener = listener; return () => { devResetListener = null } }
        }
      }
      return {
        getStoredToken: () => 'token',
        loadAgentCourse: async () => normalizeAgentCourse({ stageId: STAGE, title: '一次函数', status: 'completed', canLearn: true, progress: { total: 3, done: 3, percent: 100 }, pages: [] }),
        loadAgentCourseAcceptance: async () => ({ acceptance: { learning: null } }),
        loadCourseCovers: async () => ({}),
        finishAgentCourseForTest: async (stageId) => { finishCalls.push(stageId); return finish(stageId) }
      }
    },
    wx: {
      navigateTo: ({ url }) => navigations.push(url),
      switchTab: ({ url }) => navigations.push(url),
      showToast: ({ title }) => toasts.push(title),
      showLoading() {},
      hideLoading() {},
      showModal: (options) => options.success({ confirm: modal.confirm }),
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32 })
    },
    setTimeout: () => 0,
    clearTimeout() {}
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  return {
    page,
    navigations,
    toasts,
    finishCalls,
    modal,
    setCode(value) { code = value; if (devResetListener) devResetListener() }
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('shows the button only on an unlocked phone, and as soon as the code is entered', async () => {
  const locked = setupPage({ code: '' })
  locked.page.onLoad({ stageId: STAGE })
  await locked.page.onShow()
  assert.equal(locked.page.data.testFinishVisible, false)
  locked.setCode('123456AS')
  assert.equal(locked.page.data.testFinishVisible, true)

  const template = fs.readFileSync(path.join(__dirname, '../learning/agent-course/index.wxml'), 'utf8')
  // 课程做好、能学的时候才出现，点了走 finishForTest
  assert.match(template, /wx:if="\{\{testFinishVisible && course\.canLearn\}\}"[^>]*bindtap="finishForTest"/)
  assert.match(template, /标记学完，去验收/)
})

test('marks the course learned after confirming, then opens the explain-back acceptance', async () => {
  const { page, navigations, finishCalls, modal } = setupPage()
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  modal.confirm = false
  page.finishForTest()
  await settle()
  assert.deepEqual(finishCalls, [])

  modal.confirm = true
  page.finishForTest()
  await settle()
  assert.deepEqual(finishCalls, [STAGE])
  assert.deepEqual(navigations, [`/learning/agent-acceptance/index?stageId=${STAGE}`])
  assert.equal(page.data.testFinishing, false)
})

test('stays on the course page and explains a page that could not be marked', async () => {
  const error = Object.assign(new Error('这门课还没学完，学完全部内容后再来验收。'), { code: 'COURSE_NOT_FINISHED' })
  const { page, navigations, toasts } = setupPage({ finish: async () => { throw error } })
  page.onLoad({ stageId: STAGE })
  await page.onShow()
  page.finishForTest()
  await settle()
  assert.deepEqual(navigations, [])
  assert.deepEqual(toasts, ['有几页没能标记成学完，请从课程里学完这几页。'])
})
