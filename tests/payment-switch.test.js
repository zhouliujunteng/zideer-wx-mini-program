const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const config = require('../config/index')

// 支付开关（2026-09-30 用户规则）：后端关着时会员中心进不去、积分包买不了，入口直接弹「会员功能准备中，敬请期待。」。
// 这里用真实的 services/payment-switch.js，wx 换成记账的桩。

const FLOW = 'payment-switch-test-flow'
const state = { enabled: true, fail: false, requests: [], navigate: [], redirect: [], back: 0, switchTab: [], modals: [], toasts: [], loading: 0, pages: 2, storage: new Map() }

global.getCurrentPages = () => Array.from({ length: state.pages }, () => ({}))
global.wx = {
  request(options) {
    state.requests.push(options)
    if (state.fail) return options.fail({ errMsg: 'request:fail timeout' })
    options.success({ statusCode: 200, data: { data: { result: JSON.stringify({ status: 'ready', paymentEnabled: state.enabled }) } } })
  },
  navigateTo: (options) => state.navigate.push(options.url),
  redirectTo: (options) => state.redirect.push(options.url),
  navigateBack: () => { state.back += 1 },
  switchTab: (options) => state.switchTab.push(options.url),
  showModal: (options) => { state.modals.push(options); if (options.complete) options.complete({ confirm: true }) },
  showToast: (options) => state.toasts.push(options.title),
  showLoading: () => { state.loading += 1 },
  getStorageSync: (key) => state.storage.get(key),
  setStorageSync: (key, value) => state.storage.set(key, value),
  hideLoading: () => { state.loading -= 1 }
}

const paymentSwitch = require('../services/payment-switch')

function reset({ enabled = true, fail = false, pages = 2, id = FLOW, storage = new Map() } = {}) {
  Object.assign(state, { enabled, fail, pages, storage, requests: [], navigate: [], redirect: [], back: 0, switchTab: [], modals: [], toasts: [], loading: 0 })
  config.ACTION_FLOWS.GET_PAYMENT_SWITCH.id = id
  paymentSwitch.resetPaymentSwitchCache()
}

test('the switch is read as a guest through its own action flow and reused for a minute', async () => {
  reset()
  const [first, second] = await Promise.all([paymentSwitch.loadPaymentSwitch(), paymentSwitch.loadPaymentSwitch()])
  assert.equal(first, true)
  assert.equal(second, true)
  assert.equal(state.requests.length, 1)
  const request = state.requests[0]
  assert.equal(request.url, config.GRAPHQL_URL)
  assert.equal(request.header.authorization, undefined)
  assert.match(request.data.query, new RegExp(`actionFlowId: "${FLOW}"`))
  await paymentSwitch.loadPaymentSwitch()
  assert.equal(state.requests.length, 1)
  // 发起支付前的核对不用缓存
  await paymentSwitch.assertPaymentOpen()
  assert.equal(state.requests.length, 2)
})

test('an entry opens the membership center only while payment is open', async () => {
  reset()
  assert.equal(await paymentSwitch.openPaymentPage('/commerce/membership/index', 'membership'), true)
  assert.deepEqual(state.navigate, ['/commerce/membership/index'])
  assert.deepEqual(state.modals, [])
  assert.equal(state.loading, 0)

  reset({ enabled: false })
  assert.equal(await paymentSwitch.openPaymentPage('/commerce/membership/index', 'membership'), false)
  assert.deepEqual(state.navigate, [])
  assert.equal(state.modals.length, 1)
  assert.equal(state.modals[0].content, '会员功能准备中，敬请期待。')
  assert.equal(state.modals[0].showCancel, false)
  assert.equal(state.loading, 0)
})

test('credit pack entries use their own wording and redirects stay redirects', async () => {
  reset({ enabled: false })
  await paymentSwitch.openPaymentPage('/commerce/products/index', 'credits', { redirect: true })
  assert.equal(state.modals[0].content, '积分包购买准备中，敬请期待。')
  assert.deepEqual(state.redirect, [])
  reset()
  await paymentSwitch.openPaymentPage('/commerce/products/index', 'credits', { redirect: true })
  assert.deepEqual(state.redirect, ['/commerce/products/index'])
  assert.deepEqual(state.navigate, [])
})

test('an unreadable switch neither opens the page nor claims the feature is in preparation', async () => {
  reset({ fail: true })
  assert.equal(await paymentSwitch.confirmPaymentOpen('membership'), false)
  assert.deepEqual(state.navigate, [])
  assert.deepEqual(state.modals, [])
  assert.deepEqual(state.toasts, ['网络不太稳定，请稍后再试。'])
  assert.equal(state.loading, 0)
  assert.equal(await paymentSwitch.checkPaymentPage('membership'), 'failed')
  await assert.rejects(paymentSwitch.assertPaymentOpen(), (error) => error.paymentNotStarted === true && error.code !== 'PAYMENT_DISABLED')
})

test('a payment page opened directly while closed shows the notice and leaves', async () => {
  reset({ enabled: false })
  assert.equal(await paymentSwitch.checkPaymentPage('membership'), 'closed')
  assert.equal(state.modals[0].content, '会员功能准备中，敬请期待。')
  assert.equal(state.back, 1)
  // 按路径直接打开、没有上一页：回「我的」
  reset({ enabled: false, pages: 1 })
  assert.equal(await paymentSwitch.checkPaymentPage('credits'), 'closed')
  assert.equal(state.modals[0].content, '积分包购买准备中，敬请期待。')
  assert.deepEqual(state.switchTab, ['/pages/me/index'])
  reset()
  assert.equal(await paymentSwitch.checkPaymentPage('membership'), 'open')
  assert.deepEqual(state.modals, [])
})

test('payment is refused before WeChat is asked while the switch is closed', async () => {
  reset({ enabled: false })
  await assert.rejects(paymentSwitch.assertPaymentOpen(), (error) => {
    assert.equal(error.code, 'PAYMENT_DISABLED')
    assert.equal(error.paymentNotStarted, true)
    assert.equal(paymentSwitch.isPaymentDisabled(error), true)
    return true
  })
  assert.equal(paymentSwitch.isPaymentDisabled(new Error('PAYMENT_DISABLED')), true)
  assert.equal(paymentSwitch.isPaymentDisabled(new Error('network')), false)
})

test('before the switch flow is deployed (no id in config) payment behaves as before', async () => {
  reset({ enabled: false, id: '' })
  assert.equal(await paymentSwitch.openPaymentPage('/commerce/membership/index'), true)
  assert.deepEqual(state.navigate, ['/commerce/membership/index'])
  assert.equal(state.requests.length, 0)
  await paymentSwitch.assertPaymentOpen()
})

test('every entry to the membership center and credit packs goes through the switch', () => {
  const root = path.join(__dirname, '..')
  // .qa 是验收证据（旧版源码快照），和 tests、scripts 一样不进上传包（project.config.json packOptions）
  const skip = new Set(['node_modules', 'tests', 'scripts', '.qa'])
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|wxml)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        // 直接 navigateTo / redirectTo 到支付页面（或 wxml 里的 navigator）会绕过开关
        const pattern = /(navigateTo|redirectTo|reLaunch)\(\{\s*url:\s*[`'"]\/commerce\/(membership|products|order-confirm|product-detail)\/index|url="\/commerce\/(membership|products|order-confirm|product-detail)\/index/g
        for (const match of text.matchAll(pattern)) offenders.push(`${path.relative(root, full)}: ${match[0]}`)
      }
    }
  }
  walk(root)
  // 唯一例外：「我的」先核开关、再按访问状态分流（游客去登录），最后才 navigateTo
  const allowed = offenders.filter((line) => !line.startsWith('pages/me/index.js:') && !line.startsWith('commerce/order-confirm/index.js:'))
  assert.deepEqual(allowed, [])
  assert.match(fs.readFileSync(path.join(root, 'pages/me/index.js'), 'utf8'), /await confirmPaymentOpen\('membership'\)\)\) return\s+if \(guardAccess/)
  // 确认订单页没有上一页时回积分包页：积分包页自己会核开关
  assert.match(fs.readFileSync(path.join(root, 'commerce/products/index.js'), 'utf8'), /checkPaymentPage\('credits'\)/)
})

test('payment pages check the switch before reading anything', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const membership = read('commerce/membership/index.js')
  assert.ok(membership.indexOf("checkPaymentPage('membership')") < membership.indexOf('await loadCurrentMembership()'))
  for (const file of ['commerce/products/index.js', 'commerce/order-confirm/index.js', 'commerce/product-detail/index.js']) {
    const source = read(file)
    const check = source.indexOf("checkPaymentPage('credits')")
    assert.ok(check > 0, file)
    assert.ok(check < source.indexOf('try {', check), file)
  }
})

// 2026-09-30 用户改规则：关着时入口直接不显示，而不是点了再弹窗
function fakePage() {
  return { data: { paymentOpen: false }, updates: [], setData(patch) { this.updates.push(patch); Object.assign(this.data, patch) } }
}

test('entries stay hidden until the switch has been read open, and the result is remembered on this phone', async () => {
  reset()
  assert.equal(paymentSwitch.knownPaymentOpen(), false)
  const page = fakePage()
  const refresh = paymentSwitch.attachPaymentSwitch(page)
  assert.equal(page.data.paymentOpen, false)
  await refresh
  assert.equal(page.data.paymentOpen, true)
  assert.deepEqual(state.storage.get('payment_switch_v1'), { enabled: true })

  // 下次启动：先按记住的结果显示，读到关着后立刻收起
  const remembered = state.storage
  reset({ enabled: false, storage: remembered })
  const next = fakePage()
  const again = paymentSwitch.attachPaymentSwitch(next)
  assert.equal(next.data.paymentOpen, true)
  await again
  assert.equal(next.data.paymentOpen, false)
  assert.deepEqual(state.storage.get('payment_switch_v1'), { enabled: false })
})

test('an unreadable switch keeps whatever the page showed last', async () => {
  reset({ fail: true, storage: new Map([['payment_switch_v1', { enabled: true }]]) })
  const page = fakePage()
  await paymentSwitch.attachPaymentSwitch(page)
  assert.equal(page.data.paymentOpen, true)
  reset({ fail: true })
  const fresh = fakePage()
  await paymentSwitch.attachPaymentSwitch(fresh)
  assert.equal(fresh.data.paymentOpen, false)
  assert.deepEqual(fresh.updates, [])
})

test('every visible entry to membership, credit packs and payment is hidden while the switch is closed', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const guarded = [
    ['pages/me/index.wxml', /<view wx:if="\{\{paymentOpen\}\}" class="membership-card /],
    ['learning/library/index.wxml', /wx:if="\{\{membershipRequired && paymentOpen\}\}"[^>]*bindtap="openMembership"/],
    ['learning/custom-course-intro/index.wxml', /wx:if="\{\{cta === 'join' && !paymentOpen\}\}"/],
    ['learning/custom-course-intro/index.wxml', /wx:if="\{\{cta !== 'member' && paymentOpen\}\}" class="custom-intro-member"/],
    ['commerce/order-detail/index.wxml', /wx:if="\{\{loaded && view\.action && paymentOpen\}\}" class="detail-bar"/],
    ['commerce/payment-result/index.wxml', /view\.kind === 'closed' && paymentOpen/],
    ['commerce/payment-result/index.wxml', /view\.kind === 'pending' && paymentOpen/],
    ['commerce/agent-gate/index.wxml', /<button wx:if="\{\{paymentOpen\}\}" class="gate-primary pressable" bindtap="goProducts">/],
    ['pages/product-intro/index.wxml', /<button wx:if="\{\{paymentOpen\}\}" class="intro-action surface pressable" bindtap="openProducts">/]
  ]
  for (const [file, pattern] of guarded) assert.match(read(file), pattern, file)
  // 这些页面都在 onShow 里读开关，且 paymentOpen 初始为关（没读到过不显示入口）
  for (const file of ['pages/me/index.js', 'learning/library/index.js', 'learning/custom-course-intro/index.js', 'commerce/order-detail/index.js',
    'commerce/payment-result/index.js', 'commerce/agent-gate/index.js', 'pages/product-intro/index.js']) {
    const source = read(file)
    assert.match(source, /attachPaymentSwitch\(this\)/, file)
    assert.match(source, /paymentOpen: false/, file)
  }
})

