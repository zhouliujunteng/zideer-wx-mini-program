// 「重置测试账号」（2026-09-28 用户规则）：在「我的 → 兑换码」输入开启码、后端核对通过后才在本机打开，
// 没开过的手机不显示按钮；打开后本机登录的任何账号都能重置自己。开启码只在后端核对，不进小程序包。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const config = require('../config/index')
const RESET_FLOW = config.ACTION_FLOWS.RESET_DEVELOPMENT_ACCOUNT.id
const PHONE_FLOW = config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE.id
const TOKEN_KEY = 'zion_runtime_token'
const CODE_KEY = 'zhilu_dev_reset_code'

const flowIdOf = (options) => (String(options.data && options.data.query || '').match(/actionFlowId:\s*"([^"]+)"/) || [])[1] || ''

// 内存版 wx：记下每个请求；登录态核对一律通过，其余请求交给 respond（返回响应体，或 { fail: errMsg }）
function installWx(respond = () => ({ data: { result: null } })) {
  const storage = new Map()
  const requests = []
  global.wx = {
    getStorageSync: (key) => (storage.has(key) ? storage.get(key) : ''),
    setStorageSync: (key, value) => { storage.set(key, value) },
    removeStorageSync: (key) => { storage.delete(key) },
    clearStorageSync: () => { storage.clear() },
    reLaunch() {},
    request(options) {
      requests.push(options)
      if (flowIdOf(options) === PHONE_FLOW) {
        options.success({ statusCode: 200, data: { data: { result: { authenticated: true, phoneVerified: true } } } })
        return
      }
      const body = respond(options)
      if (body && body.fail) options.fail({ errMsg: body.fail })
      else options.success({ statusCode: 200, data: body })
    }
  }
  global.getApp = () => ({ globalData: { user: { id: 'old' } } })
  global.getCurrentPages = () => []
  return { storage, requests }
}

const identity = require('../services/identity')
const devReset = require('../utils/dev-reset')

test('the button is registered on every page but no longer shown just because this is a development build', () => {
  const app = JSON.parse(read('app.json'))
  assert.equal(app.usingComponents['dev-reset-fab'], '/components/dev-reset-fab/index')

  const pages = [...(app.pages || [])]
  for (const subpackage of app.subpackages || []) {
    for (const page of subpackage.pages || []) pages.push(`${subpackage.root}/${page}`)
  }
  for (const page of pages) assert.match(read(`${page}.wxml`), /<dev-reset-fab\s*\/>/, page)

  const component = read('components/dev-reset-fab/index.js')
  assert.doesNotMatch(component, /envVersion/)
  assert.match(component, /readDevResetCode\(\)/)
  assert.match(component, /onDevResetChange\(/)
  assert.match(component, /wx\.showModal/)
  assert.match(component, /resetDevelopmentAccount\(\)/)
  assert.match(component, /wx\.reLaunch\(\{ url: '\/pages\/login\/login' \}\)/)
  assert.match(component, /DEV_RESET_FORBIDDEN/)
  assert.doesNotMatch(component, /title: error\.message \|\| '重置失败/)
  assert.match(read('config/index.js'), /RESET_DEVELOPMENT_ACCOUNT[\s\S]*2849f6c0-520f-edff-e4dc-176919ba296b/)
})

test('the unlock code itself never ships in the mini program package', () => {
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|wxml|wxss|wxs|json)$/.test(entry.name) && /123456as/i.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full))
    }
  }
  walk(root)
  assert.deepEqual(offenders, [])
})

test('unlocking asks the backend as a guest and remembers the code only when it says unlocked', async () => {
  const { storage, requests } = installWx(() => ({ data: { result: { status: 'unlocked' } } }))
  storage.set(TOKEN_KEY, 'test-runtime-token')

  assert.equal(await identity.unlockDevelopmentReset(' 123456as '), true)
  assert.equal(requests.length, 1)
  assert.equal(flowIdOf(requests[0]), RESET_FLOW)
  // 不带登录凭证：后端还是旧版本时，旧代码对游客只会报 DEV_RESET_FORBIDDEN，不会重开当前账号
  assert.equal((requests[0].header || {}).Authorization, undefined)
  assert.deepEqual(requests[0].data.variables.args, { payload: { operation: 'check', code: '123456AS' } })
  assert.equal(storage.get(CODE_KEY), '123456AS')
})

test('anything but an explicit unlocked answer leaves the switch off and lets the code be redeemed normally', async () => {
  for (const respond of [
    () => ({ data: { result: { status: 'locked' } } }),
    () => ({ data: { result: JSON.stringify({ status: 'locked' }) } }),
    () => ({ data: { result: { status: 'reopened' } } }),
    () => ({ errors: [{ message: 'org.graalvm.polyglot.PolyglotException: Error: DEV_RESET_FORBIDDEN' }] }),
    () => ({ fail: 'request:fail timeout' })
  ]) {
    const { storage } = installWx(respond)
    assert.equal(await identity.unlockDevelopmentReset('ZL-AAAAA-BBBBB'), false)
    assert.equal(storage.has(CODE_KEY), false)
  }
  const { requests } = installWx(() => { throw new Error('should not be called') })
  for (const code of ['', '  ', 'ab', '兑换码']) assert.equal(await identity.unlockDevelopmentReset(code), false)
  assert.equal(requests.length, 0)
})

test('reset carries the stored code, clears the local session and keeps the switch for the next login', async () => {
  const { storage, requests } = installWx(() => ({ data: { result: { status: 'reopened' } } }))
  storage.set(TOKEN_KEY, 'test-runtime-token')
  storage.set(CODE_KEY, '123456AS')
  storage.set('zhilu_account_type', 'guardian')
  identity.resetPhoneSessionVerification()

  await identity.resetDevelopmentAccount()

  assert.deepEqual(requests.map(flowIdOf), [PHONE_FLOW, RESET_FLOW])
  assert.equal(requests[1].header.Authorization, 'Bearer test-runtime-token')
  assert.deepEqual(requests[1].data.variables.args, { payload: { operation: 'reset', code: '123456AS' } })
  assert.equal(storage.has(TOKEN_KEY), false)
  assert.equal(storage.has('zhilu_account_type'), false)
  assert.equal(storage.get(CODE_KEY), '123456AS')
})

test('reset without the switch never reaches the backend', async () => {
  const { storage, requests } = installWx(() => ({ data: { result: { status: 'reopened' } } }))
  storage.set(TOKEN_KEY, 'test-runtime-token')
  identity.resetPhoneSessionVerification()
  await assert.rejects(identity.resetDevelopmentAccount(), /DEV_RESET_LOCKED/)
  assert.equal(requests.length, 0)
  assert.equal(storage.get(TOKEN_KEY), 'test-runtime-token')
})

test('a code the backend no longer accepts turns the switch off and keeps the session', async () => {
  const { storage } = installWx(() => ({ errors: [{ message: 'org.graalvm.polyglot.PolyglotException: Error: DEV_RESET_FORBIDDEN' }] }))
  storage.set(TOKEN_KEY, 'test-runtime-token')
  storage.set(CODE_KEY, 'OLD-CODE')
  identity.resetPhoneSessionVerification()
  await assert.rejects(identity.resetDevelopmentAccount(), /DEV_RESET_FORBIDDEN/)
  assert.equal(storage.has(CODE_KEY), false)
  assert.equal(storage.get(TOKEN_KEY), 'test-runtime-token')
})

test('an unexpected answer is not treated as a finished reset', async () => {
  const { storage } = installWx(() => ({ data: { result: { status: 'locked' } } }))
  storage.set(TOKEN_KEY, 'test-runtime-token')
  storage.set(CODE_KEY, '123456AS')
  identity.resetPhoneSessionVerification()
  await assert.rejects(identity.resetDevelopmentAccount(), /重开未完成/)
  assert.equal(storage.get(TOKEN_KEY), 'test-runtime-token')
})

function loadButton(token) {
  let definition
  vm.runInNewContext(read('components/dev-reset-fab/index.js'), {
    Component(value) { definition = value },
    wx: { showModal() {}, showLoading() {}, hideLoading() {}, showToast() {}, reLaunch() {} },
    setTimeout,
    require(name) {
      if (name.endsWith('/services/identity')) return { getStoredToken: () => token(), resetDevelopmentAccount: async () => ({}) }
      if (name.endsWith('/utils/dev-reset')) return devReset
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const instance = { data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) }, ...definition.methods }
  return { definition, instance }
}

test('the button appears as soon as this phone is unlocked, only while logged in', () => {
  const { storage } = installWx()
  let token = 'test-runtime-token'
  const { definition, instance } = loadButton(() => token)

  definition.lifetimes.attached.call(instance)
  assert.equal(instance.data.visible, false)

  devReset.rememberDevResetCode('123456AS')
  assert.equal(storage.get(CODE_KEY), '123456AS')
  assert.equal(instance.data.visible, true)

  token = ''
  definition.pageLifetimes.show.call(instance)
  assert.equal(instance.data.visible, false)

  token = 'test-runtime-token'
  definition.pageLifetimes.show.call(instance)
  assert.equal(instance.data.visible, true)

  definition.lifetimes.detached.call(instance)
  devReset.forgetDevResetCode()
  assert.equal(instance.data.visible, true)
})

function loadRedemptionPage({ unlock, redeem, studentId }) {
  let definition
  const toasts = []
  vm.runInNewContext(read('pages/redemption/index.js'), {
    Page(value) { definition = value },
    getCurrentPages: () => [],
    setTimeout, clearTimeout,
    wx: { showToast(options) { toasts.push(options.title) }, switchTab() {}, navigateBack() {} },
    require(name) {
      if (name.endsWith('/services/identity')) return { loadCurrentGrowthCenter: async () => ({ student: studentId ? { id: studentId } : null, redemptionRecords: [] }), redeemCurrentStudentCode: redeem, unlockDevelopmentReset: unlock }
      if (name.endsWith('/services/ui-assets')) return { attachUiAssets() {} }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.data.currentStudentId = studentId || null
  return { page, toasts }
}

test('redemption page: the unlock code opens the switch instead of being redeemed, even without a student profile', async () => {
  const redeemed = []
  const { page } = loadRedemptionPage({ unlock: async (code) => code === '123456AS', redeem: async (...args) => { redeemed.push(args); return {} }, studentId: null })
  page.handleInput({ detail: { value: '123456as' } })
  await page.handleRedeem()
  assert.deepEqual(redeemed, [])
  assert.equal(page.data.resultSheetVisible, true)
  assert.equal(page.data.resultState.title, '已开启重置测试账号')
  assert.equal(page.data.model.inputValue, '')
  assert.equal(page.data.redeeming, false)
})

test('redemption page: an ordinary code still goes through redemption with the current student', async () => {
  const redeemed = []
  const { page } = loadRedemptionPage({ unlock: async () => false, redeem: async (...args) => { redeemed.push(args); return { benefits: { coin: 50 } } }, studentId: 55 })
  page.loadPage = async () => {}
  page.handleInput({ detail: { value: 'zl-aaaaa-bbbbb' } })
  await page.handleRedeem()
  assert.deepEqual(redeemed, [['ZL-AAAAA-BBBBB', 55]])
  assert.equal(page.data.resultState.title, '兑换成功')
})

test('redemption page: an ordinary code without a student profile keeps the old hint', async () => {
  const redeemed = []
  const { page, toasts } = loadRedemptionPage({ unlock: async () => false, redeem: async (...args) => { redeemed.push(args); return {} }, studentId: null })
  page.handleInput({ detail: { value: 'zl-aaaaa-bbbbb' } })
  await page.handleRedeem()
  assert.deepEqual(redeemed, [])
  assert.deepEqual(toasts, ['当前学生资料尚未准备好，请稍后重试。'])
  assert.equal(page.data.redeeming, false)
})

test('the coin-centre redemption form checks the unlock code first too', () => {
  const component = read('components/growth-page/index.js')
  const submit = component.slice(component.indexOf('async submitRedemption()'))
  assert.ok(submit.indexOf('unlockDevelopmentReset(code)') > 0)
  assert.ok(submit.indexOf('unlockDevelopmentReset(code)') < submit.indexOf('Number.isSafeInteger(studentId)'))
  assert.ok(submit.indexOf('unlockDevelopmentReset(code)') < submit.indexOf('redeemCurrentStudentCode(code, studentId)'))
  assert.match(read('components/growth-page/index.wxml'), /\{\{redemptionResult\.title \|\| '兑换已提交'\}\}/)
})
