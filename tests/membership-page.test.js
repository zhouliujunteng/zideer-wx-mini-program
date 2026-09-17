const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const tiers = [{ productVersionId: '50', name: '基础会员', amount: '49.90', creditAmount: '400' }, { productVersionId: '51', name: '黄金会员', amount: '99.00', creditAmount: '1000' }]
const gold = tiers[1]
const pending = { status: 'pending', eligible: false, tiers, tier: gold, order: { orderId: '21', amount: '99.00', description: '黄金会员', canPay: true, productVersionId: '51' } }
function setup(overrides = {}, storage = new Map()) {
  let definition
  const timers = new Map()
  const navigations = []
  let id = 0
  const api = { loadCurrentMembership: async () => pending, createMembershipOrder: async () => pending,
    payWechatOrder: async () => {}, isWechatPaymentCancelled: e => /cancel/.test(e.errMsg || ''), ...overrides }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../commerce/membership/index.js'), 'utf8'), {
    Page(p) { definition = p }, require(name) { return name.endsWith('/membership-view') ? require('../services/membership-view') : api },
    setTimeout(fn) { timers.set(++id, fn); return id }, clearTimeout(key) { timers.delete(key) },
    wx: { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k), navigateTo: o => navigations.push(o.url) }
  })
  const page = { ...definition, _visible: true, data: { ...definition.data, loading: false, membership: pending, selectedTierId: '51' },
    setData(patch) { Object.assign(this.data, patch) } }
  return { page, timers, storage, navigations }
}
test('WeChat success alone remains pending and can be resumed after restarting', async () => {
  const { page, storage } = setup()
  await page.purchase()
  assert.equal(page.data.membership.eligible, false)
  assert.equal(page.data.confirming, true)
  const resumed = setup({}, storage)
  await resumed.page.refresh()
  assert.equal(resumed.page.data.confirming, true)
  assert.equal(resumed.timers.size, 1)
})
test('cancellation leaves retry available and never opens membership', async () => {
  const { page, storage } = setup({ payWechatOrder: async () => { throw { errMsg: 'requestPayment:fail cancel' } } })
  await page.purchase()
  assert.equal(page.data.paying, false)
  assert.equal(page.data.confirming, false)
  assert.equal(storage.size, 0)
  assert.match(page.data.notice, /取消/)
})
test('repeated tap cannot create two orders or invoke two payments', async () => {
  let resolve
  let creates = 0
  let pays = 0
  const { page } = setup({ createMembershipOrder: () => { creates++; return new Promise(r => { resolve = r }) }, payWechatOrder: async () => { pays++ } })
  const first = page.purchase()
  await page.purchase()
  resolve(pending)
  await first
  assert.equal(creates, 1)
  assert.equal(pays, 1)
})
test('confirmed backend result displays expiry and stops polling', async () => {
  const active = { ...pending, tiers: [], status: 'active', eligible: true, permanent: true, activeAt: '2026-09-10T02:00:00Z', expiresAt: null }
  const { page, timers, storage } = setup({ loadCurrentMembership: async () => active })
  await page.purchase()
  assert.equal(page.data.membership.eligible, true)
  assert.equal(page.data.member.tierLabel, '黄金会员')
  assert.equal(page.data.member.validityText, '永久有效')
  assert.equal(timers.size, 0)
  assert.equal(storage.size, 0)
})
test('a hidden page cannot show a stale response or leave timers running', async () => {
  let resolve
  const { page, timers } = setup({ loadCurrentMembership: () => new Promise(r => { resolve = r }) })
  const refresh = page.refresh()
  page.onHide()
  resolve({ ...pending, eligible: true, status: 'active' })
  await refresh
  assert.equal(page.data.membership.eligible, false)
  assert.equal(timers.size, 0)
})
test('unknown payment errors require querying before another payment', async () => {
  const { page } = setup({ payWechatOrder: async () => { throw Error('network') } })
  await page.purchase()
  assert.equal(page.data.confirming, true)
  assert.equal(page.data.membership.eligible, false)
})

test('a prepayment failure allows retry without claiming payment confirmation', async () => {
  const { page, storage } = setup({ payWechatOrder: async () => { const e = Error('签名失败'); e.paymentNotStarted = true; throw e } })
  await page.purchase()
  assert.equal(storage.size, 0)
  assert.equal(page.data.confirming, false)
  assert.match(page.data.notice, /签名失败/)
})

test('confirmation polling is bounded and does not ask for a second payment', async () => {
  const { page, timers } = setup()
  await page.purchase()
  for (let i = 0; i < 9; i++) {
    const next = [...timers.values()][0]
    assert.ok(next)
    await next()
  }
  assert.equal(timers.size, 0)
  assert.equal(page.data.confirming, true)
  assert.match(page.data.notice, /勿重复支付/)
})

test('membership center opens its actual order, library and service destinations', () => {
  const { page, navigations } = setup()
  page.openOrder()
  page.openLibrary()
  page.openOrders()
  page.openService()
  assert.deepEqual(navigations, ['/commerce/order-detail/index?orderId=21', '/learning/library/index', '/commerce/orders/index', '/account/service-contact/index'])
  page.data.membership = null
  page.openOrder()
  assert.equal(navigations.length, 4)
})

test('returning to the membership center clears the earlier account display before loading', async () => {
  let resolve
  const { page } = setup({ loadCurrentMembership: () => new Promise(r => { resolve = r }) })
  const refresh = page.onShow()
  assert.equal(page.data.membership, null)
  assert.equal(page.data.member.tierLabel, '等级待确认')
  assert.equal(page.data.loading, true)
  resolve({ ...pending, status: 'inactive', order: null })
  await refresh
  assert.equal(page.data.member.tierLabel, '普通用户')
  assert.equal(page.data.loading, false)
})

test('tier cards and the primary action follow server tiers and the selected tier', async () => {
  const created = []
  const { page, navigations } = setup({ createMembershipOrder: async id => { created.push(id); return pending } })
  page.data.selectedTierId = ''
  page.applyMembership({ status: 'inactive', eligible: false, tiers, tier: null, order: null })
  assert.equal(JSON.stringify(page.data.plans.map(p => [p.name, p.price, p.note, p.isSelected])),
    JSON.stringify([['基础会员', '49.90', '赠送 400 积分', true], ['黄金会员', '99.00', '赠送 1000 积分', false]]))
  assert.equal(page.data.primaryLabel, '开通基础会员 ¥49.90')
  page.selectTier({ currentTarget: { dataset: { id: '51' } } })
  assert.equal(page.data.selectedTierId, '51')
  assert.equal(page.data.primaryLabel, '开通黄金会员 ¥99.00')
  await page.handlePrimaryAction()
  assert.equal(JSON.stringify(created), JSON.stringify(['51']))
  assert.equal(page.data.confirming, true)
  assert.equal(page.data.showPlan, false)

  const resumed = setup().page
  resumed.data.selectedTierId = ''
  resumed.applyMembership(pending)
  assert.equal(resumed.data.selectedTierId, '51')
  assert.equal(resumed.data.primaryLabel, '继续支付 ¥99.00')
  resumed.selectTier({ currentTarget: { dataset: { id: '50' } } })
  assert.equal(resumed.data.primaryLabel, '开通基础会员 ¥49.90')
  page.applyMembership({ status: 'inactive', eligible: false, tiers: [], tier: null, order: null })
  assert.equal(page.data.showPlan, false)
  assert.equal(page.data.primaryLabel, '')
  page.applyMembership({ status: 'active', eligible: true, permanent: true, expiresAt: null, tiers: [], tier: gold, order: null })
  assert.equal(page.data.showPlan, false)
  page.handlePrimaryAction()
  page.openProducts()
  assert.equal(JSON.stringify(navigations), JSON.stringify(['/learning/library/index', '/commerce/products/index']))
})

test('purchase needs a selected tier', async () => {
  let creates = 0
  const { page } = setup({ createMembershipOrder: async () => { creates++; return pending } })
  page.data.selectedTierId = ''
  await page.purchase()
  assert.equal(creates, 0)
})

test('switching tier plays a short press state that rapid taps cannot leave behind', async () => {
  const { page, timers } = setup()
  page.data.selectedTierId = ''
  page.applyMembership({ status: 'inactive', eligible: false, tiers, tier: null, order: null })
  page.selectTier({ currentTarget: { dataset: { id: '51' } } })
  page.selectTier({ currentTarget: { dataset: { id: '50' } } })
  assert.equal(page.data.planPressingId, '50')
  assert.equal(timers.size, 1)
  await [...timers.values()][0]()
  assert.equal(page.data.planPressingId, '')
  assert.equal(page.data.selectedTierId, '50')
})
