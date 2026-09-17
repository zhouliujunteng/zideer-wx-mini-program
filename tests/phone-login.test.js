const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const config = require('../config/index')
const tick = () => new Promise(setImmediate)
const source = fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8')
const code = 'wechat-phone-code-fixture'

function service(initial = '') {
  let token = initial
  const calls = [], writes = [], navigations = [], pending = []
  const app = { globalData: { user: null } }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, require: name => name.includes('config') ? config : require('../utils/course-state'),
    getApp: () => app, getCurrentPages: () => [{ route: 'pages/me/index' }],
    wx: {
      getStorageSync: () => token, removeStorageSync() { token = '' },
      setStorageSync(key, value) { token = value; writes.push(value) },
      login(options) { calls.push('wx.login'); options.success({ code: 'identity-code' }) },
      reLaunch(options) { navigations.push(options.url) },
      request(options) {
        // 课程入场券换取不属于手机号校验链路：直接失败，课程地址回落为不含凭证的地址
        if (/\/api\/learn\/device$/.test(options.url)) return options.fail({ errMsg: 'request:fail handoff unavailable' })
        pending.push(options); calls.push(options.data?.query || options.url)
      }
    }
  })
  return { api: module.exports, pending, writes, calls, navigations, token: () => token, setToken(value) { token = value },
    reply(value, isLogin = false) {
      const req = pending.shift(); assert.ok(req)
      req.success({ statusCode: 200, data: { data: isLogin ? { loginWithWechatMiniApp: { jwt: { token: value } } } : { result: value } } })
      return req
    }
  }
}

test('missing phone authorization never starts WeChat login', async () => {
  const s = service()
  await assert.rejects(s.api.signInWithWechat(), /授权手机号/)
  assert.equal(s.calls.length, 0)
  assert.equal(s.token(), '')
})

test('phone code, server binding and readback precede persisted login and profile initialization', async () => {
  const s = service()
  const login = s.api.signInWithWechat(code)
  await tick(); s.reply('provisional-token', true)
  await tick()
  assert.deepEqual(s.writes, [])
  assert.equal(s.pending[0].data.variables.args.phone_code, code)
  assert.equal(s.pending[0].header.Authorization, 'Bearer provisional-token')
  s.reply({ phoneVerified: true }); await tick()
  assert.deepEqual(s.writes, [])
  assert.match(s.pending[0].data.query, new RegExp(config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE.id))
  s.reply({ authenticated: true, phoneVerified: true }); await tick()
  assert.deepEqual(s.writes, ['provisional-token'])
  assert.match(s.pending[0].data.query, new RegExp(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id))
  s.reply(42); await tick(); s.reply({ id: 5, current_grade: 8 })
  const user = await login
  assert.equal(user.phoneVerified, true)
  assert.equal(user.userPrincipalId, 42)
})

test('public ID collision retries initialization and retains the assigned public ID in the profile', async () => {
  const s = service('bound-token')
  const loading = s.api.loadCurrentUser()
  s.reply({ authenticated: true, phoneVerified: true }); await tick()
  s.pending.shift().success({ statusCode: 200, data: { errors: [{ message: 'PUBLIC_ID_RETRY' }] } })
  await tick()
  assert.match(s.pending[0].data.query, new RegExp(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id))
  s.reply(42); await tick(); s.reply({ id: 5, public_id: '234567' })
  const user = await loading
  assert.equal(user.profile.id, 5)
  assert.equal(user.profile.public_id, '234567')
  assert.equal(s.navigations.length, 0)
})

test('public ID exhaustion stops after four attempts with a Chinese error', async () => {
  const s = service('bound-token')
  const loading = assert.rejects(s.api.loadCurrentUser(), /用户编号暂时分配失败/)
  s.reply({ authenticated: true, phoneVerified: true }); await tick()
  for (let attempt = 0; attempt < 4; attempt++) {
    s.pending.shift().success({ statusCode: 200, data: { errors: [{ message: 'PUBLIC_ID_RETRY' }] } })
    await tick()
  }
  await loading
  assert.equal(s.pending.length, 0)
  assert.equal(s.token(), 'bound-token')
})

for (const failure of ['bind-error', 'bind-false', 'readback-false']) {
  test(`${failure} cannot create a persisted session`, async () => {
    const s = service()
    const login = s.api.signInWithWechat(code)
    const rejected = assert.rejects(login)
    await tick(); s.reply('provisional-token', true); await tick()
    if (failure === 'bind-error') s.pending.shift().success({ statusCode: 200, data: { errors: [{ message: 'PHONE_CODE_EXPIRED' }] } })
    else { s.reply({ phoneVerified: failure !== 'bind-false' }); if (failure === 'readback-false') { await tick(); s.reply({ authenticated: true, phoneVerified: false }) } }
    await rejected
    assert.deepEqual(s.writes, [])
    assert.equal(s.token(), '')
    assert.equal(s.pending.length, 0)
  })
}

test('unbound old JWT is rejected before protected calls with a single redirect', async () => {
  const s = service('old-token')
  const first = assert.rejects(s.api.loadCurrentUser(), { code: 'PHONE_REQUIRED' })
  const second = assert.rejects(s.api.loadMemberCourseLibrary(), { code: 'PHONE_REQUIRED' })
  assert.equal(s.pending.length, 1)
  s.reply({ authenticated: true, phoneVerified: false })
  await Promise.all([first, second])
  assert.equal(s.token(), '')
  assert.equal(s.navigations.length, 1)
  assert.equal(s.pending.length, 0)
})

test('phone-state transport failure preserves old token but never sends protected request', async () => {
  const s = service('old-token')
  const result = assert.rejects(s.api.loadMemberCourseLibrary())
  s.pending.shift().fail({ errMsg: 'network unavailable' })
  await result
  assert.equal(s.token(), 'old-token')
  assert.equal(s.pending.length, 0)
  assert.equal(s.navigations.length, 0)
})

test('parallel requests share phone verification and foreground reset rechecks', async () => {
  const s = service('bound-token')
  const id = 'a'.repeat(32)
  const first = s.api.createLibraryCourseLaunchUrl(id)
  const second = s.api.createLibraryCourseLaunchUrl(id)
  assert.equal(s.pending.length, 1)
  s.reply({ authenticated: true, phoneVerified: true })
  await Promise.all([first, second])
  s.api.resetPhoneSessionVerification()
  const third = s.api.createLibraryCourseLaunchUrl(id)
  assert.equal(s.pending.length, 1)
  s.reply({ authenticated: true, phoneVerified: true }); await third
})

test('expired token renewal still rejects an unbound WeChat account', async () => {
  const s = service('expired-token')
  const result = assert.rejects(s.api.loadMemberCourseLibrary(), { code: 'PHONE_REQUIRED' })
  s.pending.shift().success({ statusCode: 200, data: { errors: [{ message: 'JWT expired' }] } })
  await tick(); s.reply('renewed-token', true); await tick()
  s.reply({ authenticated: true, phoneVerified: false }); await result
  assert.equal(s.token(), '')
  assert.deepEqual(s.writes, [])
})

test('late old-account verification cannot clear or verify a newer account', async () => {
  const s = service('old-token')
  const result = s.api.restoreAuthenticatedUser()
  s.setToken('new-token')
  s.reply({ authenticated: true, phoneVerified: false })
  assert.equal(await result, null)
  assert.equal(s.token(), 'new-token')
  const next = s.api.createLibraryCourseLaunchUrl('a'.repeat(32))
  assert.equal(s.pending.length, 1)
  s.reply({ authenticated: true, phoneVerified: true }); await next
})

test('sign-out during phone login prevents late session recreation', async () => {
  const s = service()
  const result = assert.rejects(s.api.signInWithWechat(code), { code: 'AUTH_REQUIRED' })
  await tick(); s.reply('provisional-token', true); await tick()
  s.reply({ phoneVerified: true }); await tick()
  s.api.signOut()
  s.reply({ authenticated: true, phoneVerified: true }); await result
  assert.equal(s.token(), '')
  assert.deepEqual(s.writes, [])
})

function loginPage(login, restore = async () => null) {
  let definition
  const navigations = [], calls = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/login/login.js'), 'utf8'), {
    Page: p => { definition = p }, getApp: () => ({ globalData: {} }),
    require: name => name.includes('identity') ? { restoreAuthenticatedUser: restore, signInWithWechat: value => { calls.push(value); return login(value) } } : { postAuthenticationUrl: () => '/pages/me/index' },
    wx: { reLaunch: o => navigations.push(o.url) }
  })
  return { page: { ...definition, data: { ...definition.data, checkingSession: false }, setData(patch) { Object.assign(this.data, patch) } }, navigations, calls }
}

test('denied or quota-failed authorization stays on login without calling login service', async () => {
  const { page, calls, navigations } = loginPage(async () => ({}))
  await page.handlePhoneLogin({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
  assert.match(page.data.errorMessage, /尚未授权/)
  await page.handlePhoneLogin({ detail: { errno: 1400001 } })
  assert.match(page.data.errorMessage, /暂不可用/)
  assert.deepEqual(calls, []); assert.deepEqual(navigations, [])
})

test('login double tap sends once and failed attempt can retry', async () => {
  let fail
  const { page, calls, navigations } = loginPage(() => new Promise((_, reject) => { fail = reject }))
  const first = page.handlePhoneLogin({ detail: { code } })
  await page.handlePhoneLogin({ detail: { code } })
  assert.equal(calls.length, 1)
  fail(new Error('retry')); await first
  assert.equal(page.data.authorizing, false)
  assert.equal(page.data.errorMessage, 'retry')
  const second = page.handlePhoneLogin({ detail: { code } })
  assert.equal(calls.length, 2)
  fail(new Error('retry')); await second
  assert.deepEqual(navigations, [])
})

test('unloaded login page never navigates on late completion; unverified results cannot navigate', async () => {
  let finish
  const { page, navigations } = loginPage(() => new Promise(resolve => { finish = resolve }))
  const pending = page.handlePhoneLogin({ detail: { code } })
  page.onUnload(); finish({ phoneVerified: true }); await pending
  assert.deepEqual(navigations, [])
  const other = loginPage(async () => ({ phoneVerified: false }))
  await other.page.handlePhoneLogin({ detail: { code } })
  assert.deepEqual(other.navigations, [])
})

test('login entry uses native phone authorization rather than tap login', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/login/login.wxml'), 'utf8')
  assert.match(template, /open-type="getPhoneNumber"/)
  assert.match(template, /bindgetphonenumber="handlePhoneLogin"/)
  assert.doesNotMatch(template, /bindtap="handle(?:Wechat|Phone)Login"/)
})

test('session restore timeout stays recoverable on the login page', async () => {
  const { page, navigations } = loginPage(async () => ({}), async () => { throw new Error('timeout') })
  await page.restoreSession()
  assert.equal(page.data.checkingSession, false)
  assert.match(page.data.errorMessage, /响应超时/)
  assert.deepEqual(navigations, [])
})
