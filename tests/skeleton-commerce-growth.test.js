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
      if (name.endsWith('/mini-pay') && !key) return { payOrder: async () => 'merchant', payByLink: async () => {}, platform: () => 'ios' }
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

// 2026-11-10 起没有积分包：products / product-detail / order-confirm / agent-gate 四页已删
const PAGES = ['membership', 'assignment-request', 'payment-result', 'orders', 'order-detail', 'entitlements']

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
  { file: 'commerce/orders/index.js', service: 'loadOrders', value: ORDERS, key: 'recordGroups', expected: require('../commerce/order-view').groupOrdersByMonth(ORDERS, 'all') },
  { file: 'commerce/order-detail/index.js', service: 'loadOrderDetail', value: { id: 1, title: '积分包' }, key: 'order', query: { orderId: '1' } },
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
// 2026-09-25 用户规则：买积分包只要有推荐人（与开通会员同一口径），推荐人不必是已开通的推广伙伴
