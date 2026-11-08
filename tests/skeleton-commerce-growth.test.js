// 商城、订单、积分、金币页第一次读到真实数据前只显示骨架：不显示默认值、"正在读取"文案或空状态；
// 读到过一次后回到页面保留旧数据静默刷新；首次读取失败给重试，不落到空状态或表单。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const paymentSwitchStub = require('./helpers/payment-switch-stub')
const webPayStub = require('./helpers/web-pay-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadPage(file, modules, options = {}) {
  let definition
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({}),
    getCurrentPages: () => [],
    setTimeout, clearTimeout,
    wx: {
      showToast() {}, navigateTo() {}, redirectTo() {}, stopPullDownRefresh() {}, nextTick(fn) { fn() },
      getStorageSync() { return '' }, setStorageSync() {}, removeStorageSync() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) })
    },
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/payment-done')) return { goHomeAfterCreditPayment() {} }
      if (name.endsWith('/order-view')) return require('../commerce/order-view')
      if (name.endsWith('/ui-assets') && !key) return { attachUiAssets() {} }
      if (name.endsWith('/utils/referral-context')) return { clearPendingReferral() {} }
      if (name.endsWith('/payment-switch') && !key) return paymentSwitchStub({ navigateTo() {}, redirectTo() {} })
      if (name.endsWith('/web-pay') && !key) return webPayStub({ navigateTo() {}, redirectTo() {} })
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
  if (page.onLoad) page.onLoad(options.query || {})
  return page
}

// 可控的服务：pending() 返回挂起的 Promise，由测试决定何时成功或失败
function controllable() {
  const calls = []
  const fn = () => new Promise((resolve, reject) => calls.push({ resolve, reject }))
  return { fn, calls, last: () => calls[calls.length - 1] }
}
// 积分包相关页面先核支付开关（异步一拍）再读数据：等第 count 次读取真正发出再往下断言
async function untilCalled(service, count) {
  for (let i = 0; i < 10 && service.calls.length < count; i += 1) await Promise.resolve()
}

const PAGES = ['membership', 'agent-gate', 'assignment-request', 'products', 'product-detail', 'order-confirm', 'payment-result', 'orders', 'order-detail', 'entitlements']

test('commerce and coin pages use shape-matched skeletons instead of the flat grey block or loading copy', () => {
  for (const name of PAGES) {
    assert.match(read(`commerce/${name}/index.wxss`), /@import "..\/..\/styles\/skeleton.wxss";/, name)
    const wxml = read(`commerce/${name}/index.wxml`)
    assert.match(wxml, /class="sk[ "]/, name)
    assert.doesNotMatch(wxml, /commerce-skeleton|class="([^"]*\s)?skeleton[\s"]/, name)
    assert.doesNotMatch(wxml, /正在读取/, name)
  }
  // 金币页 @import 课程积分页样式，骨架样式随之带入
  assert.match(read('growth/coins/index.wxss'), /@import "..\/..\/commerce\/entitlements\/index.wxss";/)
  assert.doesNotMatch(read('growth/coins/index.wxml'), /正在读取/)
})

test('empty-state copy is only reachable after the loaded branch', () => {
  const products = read('commerce/products/index.wxml')
  assert.ok(products.indexOf('wx:if="{{!loaded && !failed}}"') < products.indexOf('积分包还没有上架'))
  const orders = read('commerce/orders/index.wxml')
  assert.ok(orders.indexOf('wx:if="{{!loaded && !failed}}"') < orders.indexOf('暂时没有订单记录'))
  for (const file of ['commerce/entitlements/index.wxml', 'growth/coins/index.wxml']) {
    const wxml = read(file)
    assert.ok(wxml.indexOf('wx:if="{{!loaded}}" class="record-list"') < wxml.indexOf('暂无记录'), file)
  }
  // 申请页首次读取失败给重试，不直接给出申请表单
  const request = read('commerce/assignment-request/index.wxml')
  assert.ok(request.indexOf('wx:elif="{{!loaded}}"') < request.indexOf('提交申请'))
})

const ORDERS = [{ id: 1, title: '体验积分包', order_kind: 'course_credit', status: '已支付', statusLabel: '已支付', amountDisplay: '9.90', beneficiaryName: '小鹿', created_at: '2026-09-25T10:00:00+08:00' }]
const simplePages = [
  { file: 'commerce/agent-gate/index.js', service: 'loadPurchaseEligibility', value: { eligible: true, promoter: { name: '伙伴' } }, key: 'eligibility' },
  { file: 'commerce/orders/index.js', service: 'loadOrders', value: ORDERS, key: 'recordGroups', expected: require('../commerce/order-view').groupOrdersByMonth(ORDERS, 'all') },
  { file: 'commerce/order-detail/index.js', service: 'loadOrderDetail', value: { id: 1, title: '积分包' }, key: 'order', query: { orderId: '1' } },
  { file: 'commerce/product-detail/index.js', service: 'loadCreditProduct', value: { id: 9, name: '积分包' }, key: 'product', query: { productVersionId: '9' } },
  { file: 'commerce/assignment-request/index.js', service: 'loadPromoterAssignmentRequest', value: { request: null, attribution: { promoter: {} } }, key: 'attribution', expected: { promoter: {} } },
  { file: 'commerce/payment-result/index.js', service: 'loadOrderDetail', value: { id: 3, status: '已支付', order_no: 'N3' }, key: 'order', query: { orderId: '3', orderNo: 'N3', amount: '9.90' } }
]

for (const spec of simplePages) {
  test(`${spec.file}: skeleton first, silent refresh after, retry on first failure`, async () => {
    const service = controllable()
    const page = loadPage(spec.file, { '/identity': { [spec.service]: service.fn } }, { query: spec.query })
    assert.equal(page.data.loaded, false)
    assert.equal('loading' in page.data, false)

    const first = page.loadPage()
    await untilCalled(service, 1)
    assert.equal(page.data.loaded, false)
    assert.equal(page.data.failed, false)
    service.last().reject(new Error('offline'))
    await first
    assert.equal(page.data.loaded, false)
    assert.equal(page.data.failed, true)

    const retry = page.loadPage()
    await untilCalled(service, 2)
    assert.equal(page.data.failed, false)
    service.last().resolve(spec.value)
    await retry
    assert.equal(page.data.loaded, true)
    const expected = spec.expected || spec.value
    assert.deepEqual(page.data[spec.key], expected)

    // 回到页面：刷新期间和刷新失败都保留旧数据，不回到骨架或错误页
    const again = page.loadPage()
    await untilCalled(service, 3)
    assert.equal(page.data.loaded, true)
    service.last().reject(new Error('offline'))
    await again
    assert.equal(page.data.loaded, true)
    assert.equal(page.data.failed, false)
    assert.deepEqual(page.data[spec.key], expected)
  })
}

test('products: loaded only once products arrive; refresh keeps the list', async () => {
  const eligibility = controllable()
  const products = controllable()
  const page = loadPage('commerce/products/index.js', { '/identity': { loadPurchaseEligibility: eligibility.fn, loadCreditProducts: products.fn },
    '/ui-assets': { attachUiAssets() {} }, '/membership-view': require('../services/membership-view') })
  const first = page.loadPage()
  await untilCalled(eligibility, 1)
  eligibility.last().resolve({ eligible: true })
  for (let i = 0; i < 5 && !products.calls.length; i += 1) await Promise.resolve()
  assert.equal(page.data.loaded, false)
  products.last().resolve({ products: [{ id: 1 }] })
  await first
  assert.equal(page.data.loaded, true)
  const again = page.loadPage()
  await untilCalled(eligibility, 2)
  assert.equal(page.data.products.length, 1)
  eligibility.last().reject(new Error('offline'))
  await again
  assert.equal(page.data.products.length, 1)
  assert.equal(page.data.failed, false)
})

test('order confirm keeps the create-order button hidden until product and beneficiary are loaded', async () => {
  const product = controllable()
  const user = controllable()
  const page = loadPage('commerce/order-confirm/index.js', { '/identity': { loadCreditProduct: product.fn, loadCurrentUser: user.fn },
    '/membership-view': require('../services/membership-view') }, { query: { productVersionId: '9' } })
  assert.match(read('commerce/order-confirm/index.wxml'), /<button wx:if="\{\{loaded\}\}" class="confirm-button/)
  const first = page.loadPage()
  await untilCalled(product, 1)
  product.last().resolve({ id: 9, name: '积分包' })
  user.last().resolve({ profileCompleted: true, profile: { id: 5, nickname: '小鹿' } })
  await first
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.beneficiary.name, '小鹿')
})

test('payment result without an order id has nothing to load and shows its state immediately', async () => {
  const page = loadPage('commerce/payment-result/index.js', { '/identity': { loadOrderDetail() { throw new Error('should not load') } } }, { query: {} })
  await page.loadPage()
  assert.equal(page.data.loaded, true)
})

for (const spec of [
  { file: 'commerce/entitlements/index.js', service: 'loadCurrentCreditAccount', value: { account: { available: 120, frozen: 0 }, ledger: [], batches: [] } },
  { file: 'growth/coins/index.js', service: 'loadCurrentGrowthCenter', value: { coinAccount: { available: 30, frozen: 0 }, coinLedger: [] },
    extra: { '/coin-exchange': { loadCoinExchange: () => new Promise(() => {}) } } }
]) {
  test(`${spec.file}: no "—" balance before the account arrives; refresh keeps the balance`, async () => {
    const service = controllable()
    const page = loadPage(spec.file, { '/identity': { [spec.service]: service.fn }, '/ui-assets': { attachUiAssets() {} }, ...(spec.extra || {}) })
    assert.equal(page.data.model, null)
    assert.deepEqual(page.data.recordTabs.map(tab => tab.isSelected), [true, false])

    const first = page.loadPage()
    // 读到前切页签只换选中态，不拼出空账户
    page.handleRecordTab({ currentTarget: { dataset: { id: 'spent' } } })
    assert.equal(page.data.model, null)
    assert.equal(page.data.activeTab, 'spent')
    service.last().resolve(spec.value)
    await first
    assert.equal(page.data.loaded, true)
    assert.notEqual(page.data.model.balance.available, '—')
    assert.deepEqual([...page.data.recordTabs.map(tab => tab.isSelected)], [false, true])

    const again = page.loadPage()
    service.last().reject(new Error('offline'))
    await again
    assert.equal(page.data.failed, false)
    assert.equal(page.data.model.balance.available, String(spec.value.account ? spec.value.account.available : spec.value.coinAccount.available))
  })
}

test('entitlements title shows a skeleton for a parent viewing a child until the name arrives', () => {
  const page = loadPage('commerce/entitlements/index.js', { '/identity': { loadCurrentCreditAccount: controllable().fn }, '/ui-assets': { attachUiAssets() {} } }, { query: { studentId: '7' } })
  assert.equal(page.data.forStudent, true)
  assert.match(read('commerce/entitlements/index.wxml'), /wx:if="\{\{!model && forStudent\}\}" class="sk points-title-skeleton"/)
})

test('membership hero shows skeletons instead of the neutral name until the profile arrives', async () => {
  const dashboard = controllable()
  const page = loadPage('commerce/membership/index.js', {
    '/identity': { loadCurrentMembership: () => new Promise(() => {}), loadMeDashboard: dashboard.fn },
    '/membership-view': require('../services/membership-view'),
    '/referral-context': { clearPendingReferral() {} },
    '/ui-assets': { attachUiAssets() {} }
  })
  assert.equal(page.data.profileLoaded, false)
  assert.equal(page.data.profile.name, '')
  const first = page.loadProfile()
  dashboard.last().reject(new Error('offline'))
  await first
  assert.equal(page.data.profileLoaded, true)
  assert.equal(page.data.profile.name, '知鹿学员')
  const wxml = read('commerce/membership/index.wxml')
  assert.match(wxml, /wx:if="\{\{!profileLoaded\}\}" class="sk sk-round member-avatar-skeleton"/)
  assert.match(wxml, /wx:if="\{\{loading\}\}" class="membership-skeleton"/)
})

// 积分包页（2026-09-24 重做）：上面选积分包、下面看购买须知、底部购买直接进确认订单；会员价与余额只来自服务端。
test('credit packs: select a pack, see its rules, and buy straight into order confirm', async () => {
  const packs = [
    { id: 11, name: '入门积分包', credits: '1000', amount: '49.00', payableAmount: '39.00', memberAmount: '39.00', memberPriceApplied: true, estimatedCourseCount: 5, validityRule: { description: '永久有效' } },
    { id: 12, name: '进阶积分包', credits: '5000', amount: '199.00', payableAmount: '199.00', memberAmount: '', memberPriceApplied: false, estimatedCourseCount: 0 }
  ]
  const page = loadPage('commerce/products/index.js', {
    '/identity': { loadPurchaseEligibility: async () => ({ eligible: true, balance: { available: '286', frozen: '0' } }), loadCreditProducts: async () => ({ buyerIsMember: true, products: packs }) },
    '/ui-assets': { attachUiAssets() {} }, '/membership-view': require('../services/membership-view')
  }, { query: { productVersionId: '12' } })
  page.onLoad({ productVersionId: '12' })
  await page.loadPage()
  assert.equal(page.data.balance.available, '286')
  assert.equal(page.data.selected.id, '12')
  page.selectPack({ currentTarget: { dataset: { id: '11' } } })
  assert.equal(JSON.stringify(page.data.packs.map((p) => [p.price, p.listPrice, p.memberTag, p.isSelected])), JSON.stringify([['39', '49', '会员价', true], ['199', '', '', false]]))
  assert.equal(page.data.selected.savedText, '已享会员价，省 ¥10')
  assert.equal(JSON.stringify(page.data.selected.rows.map((r) => r.value).slice(0, 2)), JSON.stringify(['约 5 节', '永久有效']))
  assert.equal(page.data.memberOffer, false)
  // 购买须知已在本页，购买直接进确认订单，不再经过商品详情页
  assert.match(read('commerce/products/index.js'), /order-confirm\/index\?productVersionId=/)
  assert.doesNotMatch(read('commerce/products/index.js'), /product-detail\/index/)
})

// 2026-09-25 用户规则：买积分包只要有推荐人（与开通会员同一口径），推荐人不必是已开通的推广伙伴
test('credit-pack eligibility only needs a referrer, whatever the referrer\'s partner status', async () => {
  const identityPath = require.resolve('../services/identity.js')
  const account = (status) => ({ account: { available_credits: 0 }, attribution: { id: 5, status: 'active', source_type: 'code', promoter_profile: { id: 21, status, display_name: '' } }, orders: [], batches: [], ledger: [] })
  for (const [payload, eligible] of [[account('inactive'), true], [account('active'), true], [{ ...account('active'), attribution: null }, false]]) {
    delete require.cache[identityPath]
    global.wx = {
      getStorageSync: () => 'token', setStorageSync() {}, removeStorageSync() {},
      request(options) {
        if (JSON.stringify(options.data || {}).includes('PhoneAuthentication')) return options.success({ statusCode: 200, data: { data: { result: { authenticated: true, phoneVerified: true } } } })
        options.success({ statusCode: 200, data: { data: { result: JSON.stringify(payload) } } })
      }
    }
    global.getCurrentPages = () => []
    const result = await require(identityPath).loadPurchaseEligibility()
    assert.equal(result.eligible, eligible, JSON.stringify(payload.attribution))
  }
  delete require.cache[identityPath]
  const wxml = read('commerce/products/index.wxml')
  assert.match(wxml, /填写邀请码后即可购买/)
  assert.doesNotMatch(wxml, /绑定推广伙伴后即可购买/)
})

test('without a referrer the packs page offers the invite-code prompt and reloads after binding', async () => {
  let definition
  let eligible = false
  const bound = []
  const toasts = []
  vm.runInNewContext(read('commerce/products/index.js'), {
    Page(value) { definition = value },
    getCurrentPages: () => [],
    wx: {
      showToast(options) { toasts.push(options.title) },
      showModal(options) { options.success({ confirm: true, content: ' zlabc123 ' }) },
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 })
    },
    require(name) {
      if (name.endsWith('/identity')) return {
        loadPurchaseEligibility: async () => ({ eligible, balance: { available: '0', frozen: '0' } }),
        loadCreditProducts: async () => ({ buyerIsMember: false, products: [{ id: 7, name: '小包', credits: 100, amount: '9.90', payableAmount: '9.90' }] }),
        bindCurrentPromotionCode: async (code) => { bound.push(code); eligible = true; return { rewardCredits: 0 } }
      }
      if (name.endsWith('/referral-context')) return { clearPendingReferral() {} }
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/payment-done')) return { goHomeAfterCreditPayment() {} }
      if (name.endsWith('/order-view')) return require('../commerce/order-view')
      if (name.endsWith('/payment-switch')) return paymentSwitchStub({ navigateTo() {}, redirectTo() {} })
      throw new Error('Unexpected import ' + name)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  await page.loadPage()
  assert.equal(page.data.eligible, false)
  page.openInviteCode()
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bound, ['zlabc123'])
  assert.equal(toasts[0], '已绑定推荐人，可以购买积分包了')
  assert.equal(page.data.eligible, true)
  assert.equal(page.data.packs.length, 1)
})
