// 定制课程按节扣积分（2026-10-05）：诊断室把会话登记到当前学生名下，课程服务建课时据此扣积分。
// 登记成功一次即可；失败了下次发话再试，不挡对话。
const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/allow-diagnosis-room-entry')
require('./helpers/stub-ui-assets')

const pagePath = require.resolve('../pages/diagnosis-room/index.js')
const servicePath = require.resolve('../services/course-agent-service.js')

function loadPage(requests, replies) {
  delete require.cache[pagePath]
  delete require.cache[servicePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo() {
      return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }
    },
    getMenuButtonBoundingClientRect() { return { left: 276, top: 26, width: 87, height: 32 } },
    getStorageSync(key) {
      if (key === 'zion_runtime_token') return 'jwt-1'
      if (key === 'course-agent-anonymous-cookie') return 'anonymous_id=11111111-2222-4333-8444-555555555555'
      return ''
    },
    setStorageSync() {},
    showToast() {},
    request(options) {
      requests.push(options)
      const reply = replies.shift() || { statusCode: 200, data: { success: true } }
      setTimeout(() => (reply.fail ? options.fail({ errMsg: 'request:fail' }) : options.success({ header: {}, ...reply })), 0)
    },
    nextTick(callback) { callback() },
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

test('binds the session to the logged-in student once, with the login token and device cookie', async () => {
  const requests = []
  const page = loadPage(requests, [])
  page.bindSessionLearner('session-9')
  page.bindSessionLearner('session-9') // 正在登记：不重复发
  await settle()
  assert.equal(requests.length, 1)
  const request = requests[0]
  assert.match(request.url, /\/api\/learn\/agent-session\/learner$/)
  assert.equal(request.method, 'POST')
  assert.deepEqual(request.data, { sessionId: 'session-9' })
  assert.equal(request.header.Authorization, 'Bearer jwt-1')
  assert.match(request.header.Cookie, /anonymous_id=11111111-2222-4333-8444-555555555555/)
  page.bindSessionLearner('session-9')
  await settle()
  assert.equal(requests.length, 1, '登记成功后同一会话不再登记')
  page.bindSessionLearner('session-10')
  await settle()
  assert.equal(requests.length, 2, '换了会话要重新登记')
})

test('a failed binding is retried the next time, without throwing into the conversation', async () => {
  const requests = []
  const page = loadPage(requests, [{ statusCode: 503, data: { code: 'UNAVAILABLE' } }, { fail: true }])
  page.bindSessionLearner('session-9')
  await settle()
  page.bindSessionLearner('session-9')
  await settle()
  page.bindSessionLearner('session-9')
  await settle()
  assert.equal(requests.length, 3)
  assert.equal(page._learnerBoundSessionId, 'session-9')
})

test('mock sessions are never bound', async () => {
  const requests = []
  const page = loadPage(requests, [])
  page._agentMock = true
  page.bindSessionLearner('mock-session')
  await settle()
  assert.equal(requests.length, 0)
})

// 2026-10-06：建会话、发话的请求本身就带学生凭证，课程服务在同一个请求里登记（不再只靠第二个请求的 cookie 对上）。
test('creating a session and sending a line both carry the learner token for same-request binding', async () => {
  const requests = []
  loadPage(requests, [])
  const service = require(servicePath)
  global.wx.request = (options) => {
    requests.push(options)
    setTimeout(() => options.success({ header: {}, statusCode: 202, data: { id: 'session-9' } }), 0)
  }
  await service.createCourseAgentSession({ prompt: '开场' })
  await service.sendCourseAgentMessage('session-9', '我想学分数')
  await service.cancelCourseAgentSession('session-9').catch(() => {})
  assert.equal(requests[0].header['X-Zhilu-Learner'], 'Bearer jwt-1')
  assert.equal(requests[1].header['X-Zhilu-Learner'], 'Bearer jwt-1')
  assert.equal(requests[2].header['X-Zhilu-Learner'], undefined, '其余请求不带登录凭证')
})
