const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const paymentSwitchStub = require('./helpers/payment-switch-stub')
const webPayStub = require('./helpers/web-pay-stub')
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
  const paymentSwitch = paymentSwitchStub({ navigateTo: o => navigations.push(o.url) }, { enabled: overrides.paymentEnabled !== false })
  const webPay = webPayStub({ navigateTo: o => navigations.push(o.url) }, { android: overrides.android === true })
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../commerce/membership/index.js'), 'utf8'), {
    Page(p) { definition = p },
    require(name) {
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/payment-switch')) return paymentSwitch
      if (name.endsWith('/web-pay')) return webPay
      return api
    },
    setTimeout(fn) { timers.set(++id, fn); return id }, clearTimeout(key) { timers.delete(key) },
    wx: { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k), navigateTo: o => navigations.push(o.url),
      showToast() {}, ...(overrides.wx || {}) }
  })
  const page = { ...definition, _visible: true, data: { ...definition.data, loading: false, membership: pending, selectedTierId: '51' },
    setData(patch) { Object.assign(this.data, patch) } }
  return { page, timers, storage, navigations, paymentSwitch, webPay }
}
// 页面先核支付开关再读会员状态：等开关核对这一拍过去，读取才真正发出
const flush = () => new Promise(resolve => setImmediate(resolve))
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
  await flush()
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

test('first visit shows the skeleton until the membership status arrives', async () => {
  let resolve
  const { page } = setup({ loadCurrentMembership: () => new Promise(r => { resolve = r }) })
  page.data.membership = null
  page.data.loading = true
  const refresh = page.onShow()
  await flush()
  assert.equal(page.data.loading, true)
  assert.equal(page.data.loaded, false)
  resolve({ ...pending, status: 'inactive', order: null })
  await refresh
  assert.equal(page.data.member.tierLabel, '普通用户')
  assert.equal(page.data.loading, false)
  assert.equal(page.data.loaded, true)
})

test('returning to the membership center keeps the earlier status while refreshing silently', async () => {
  let resolve
  const { page } = setup({ loadCurrentMembership: () => new Promise(r => { resolve = r }) })
  const refresh = page.onShow()
  await flush()
  assert.equal(page.data.membership, pending)
  assert.equal(page.data.loading, false)
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
    JSON.stringify([['基础会员', '49.9', '赠送 400 积分', true], ['黄金会员', '99', '赠送 1000 积分', false]]))
  assert.equal(page.data.primaryLabel, '开通基础会员 ¥49.9')
  page.selectTier({ currentTarget: { dataset: { id: '51' } } })
  assert.equal(page.data.selectedTierId, '51')
  assert.equal(page.data.primaryLabel, '开通黄金会员 ¥99')
  await page.handlePrimaryAction()
  assert.equal(JSON.stringify(created), JSON.stringify(['51']))
  assert.equal(page.data.confirming, true)
  assert.equal(page.data.showPlan, false)

  const resumed = setup().page
  resumed.data.selectedTierId = ''
  resumed.applyMembership(pending)
  assert.equal(resumed.data.selectedTierId, '51')
  assert.equal(resumed.data.primaryLabel, '继续支付 ¥99')
  resumed.selectTier({ currentTarget: { dataset: { id: '50' } } })
  assert.equal(resumed.data.primaryLabel, '开通基础会员 ¥49.9')
  page.applyMembership({ status: 'inactive', eligible: false, tiers: [], tier: null, order: null })
  assert.equal(page.data.showPlan, false)
  assert.equal(page.data.primaryLabel, '')
  page.applyMembership({ status: 'active', eligible: true, permanent: true, expiresAt: null, tiers: [], tier: gold, order: null })
  assert.equal(page.data.showPlan, false)
  page.handlePrimaryAction()
  await page.openProducts()
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

// 2026-09-24 用户规则：等级按价格往上走。买了低级可以再买高级（原价），买了高级不能再买低级；
// 选中哪个等级，下面的权益区就显示哪个等级的权益。
const silverMember = {
  status: 'active', eligible: true, permanent: true, expiresAt: null, tier: { ...tiers[0], benefits: [] },
  tiers: [{ ...tiers[0], purchasable: false, current: true }, { ...gold, purchasable: true, current: false }],
  order: { orderId: '20', amount: '49.90', canPay: false, productVersionId: '50' }, pendingOrder: null
}

test('a member sees only higher tiers, upgrades at full price, and the benefits follow the selected tier', async () => {
  const paid = []
  const upgraded = { ...silverMember, tier: { ...gold, benefits: [] }, tiers: silverMember.tiers.map(t => ({ ...t, purchasable: false, current: t.productVersionId === '51' })),
    order: { orderId: '22', amount: '99.00', canPay: false, productVersionId: '51' } }
  let current = silverMember
  const { page, storage } = setup({
    loadCurrentMembership: async () => current,
    // 付款后、回调确认前，后端仍把 22 号订单作为待支付的升级订单返回
    createMembershipOrder: async () => (current = { ...silverMember, pendingOrder: { orderId: '22', amount: '99.00', canPay: true, productVersionId: '51' } }),
    payWechatOrder: async order => { paid.push(order.orderId) }
  })
  page.data.selectedTierId = ''
  page.applyMembership(silverMember)
  assert.equal(JSON.stringify(page.data.plans.map(p => p.name)), JSON.stringify(['黄金会员']))
  assert.equal(page.data.primaryLabel, '升级为黄金会员 ¥99')
  assert.equal(page.data.benefitsHeading, '黄金会员权益')
  assert.equal(JSON.stringify(page.data.benefits.map(b => [b.title, b.state])),
    JSON.stringify([['会员课程库', '永久可用'], ['课程积分', '赠送 1000 积分'], ['积分包', '享会员价']]))
  await page.purchase()
  assert.equal(JSON.stringify(paid), JSON.stringify(['22']))
  assert.equal(page.data.confirming, true)
  assert.equal(page.data.primaryLabel, '正在确认支付结果')
  assert.equal(storage.get('library_membership_confirming_order'), '22')
  // 回调确认后：当前等级是黄金会员，没有更高的可选，权益区回到「我的会员权益」
  current = upgraded
  await page.refresh()
  assert.equal(page.data.confirming, false)
  assert.equal(storage.size, 0)
  assert.equal(page.data.member.tierLabel, '黄金会员')
  assert.equal(page.data.showPlan, false)
  assert.equal(page.data.primaryLabel, '进入会员课程库')
  assert.equal(page.data.benefitsHeading, '我的会员权益')
  assert.equal(JSON.stringify(page.data.benefits.map(b => [b.state, b.action])),
    JSON.stringify([['永久可用 ›', 'openLibrary'], ['开通赠送 1000 积分', ''], ['去购买 ›', 'openProducts']]))
})

test('an unpaid upgrade order is resumed instead of creating a new one', () => {
  const { page } = setup()
  page.data.selectedTierId = ''
  page.applyMembership({ ...silverMember, pendingOrder: { orderId: '22', amount: '99.00', canPay: true, productVersionId: '51' } })
  assert.equal(page.data.selectedTierId, '51')
  assert.equal(page.data.primaryLabel, '继续支付 ¥99')
  assert.equal(page.data.confirming, false)
})

test('benefit cards: custom per-tier benefits from the backend replace the default three', () => {
  const { benefitCards } = require('../services/membership-view')
  const custom = benefitCards({ ...gold, benefits: [{ title: '专属老师答疑', description: '每月 2 次' }] }, 'preview')
  assert.equal(JSON.stringify(custom.map(b => [b.title, b.subtitle, b.state])), JSON.stringify([['专属老师答疑', '每月 2 次', '']]))
  assert.equal(benefitCards(null, 'none').map(b => b.state).join('|'), '未开通|按等级赠送|开通会员享会员价')
  assert.equal(benefitCards({ ...gold, creditAmount: '0' }, 'preview')[1].state, '不赠送积分')
  const { priceText } = require('../services/membership-view')
  assert.equal(['28.80', '298.00', '1080.00', '9800.00', '0.01'].map(priceText).join('|'), '28.8|298|1080|9800|0.01')
})

// 2026-09-24 用户规则：没填邀请码不能付款成为会员。按钮先引导填码，绑定后刷新回到「开通」。
test('without an invite code the membership center asks for one before any payment', async () => {
  const bound = []
  let current = { status: 'inactive', eligible: false, tiers, tier: null, order: null, inviteRequired: true }
  let creates = 0
  let modal
  const { page } = setup({
    loadCurrentMembership: async () => current,
    createMembershipOrder: async () => { creates++; return pending },
    bindCurrentPromotionCode: async code => { bound.push(code); current = { ...current, inviteRequired: false }; return { alreadyBound: false, rewardCredits: 0 } },
    clearPendingReferral() {},
    wx: { showModal: options => { modal = options } }
  })
  page.data.selectedTierId = ''
  page.applyMembership(current)
  assert.equal(page.data.primaryLabel, '填写邀请码后开通')
  assert.equal(page.data.primaryAction, 'invite')
  assert.equal(page.data.showPlan, true)
  page.handlePrimaryAction()
  assert.equal(creates, 0)
  // 可输入弹窗的 content 会成为输入框初始文字：不传，说明放在占位文字里
  assert.equal(modal.content, undefined)
  assert.equal(modal.editable, true)
  assert.equal(modal.placeholderText, '输入邀请人的邀请码')
  await modal.success({ confirm: true, content: ' ABC123 ' })
  assert.equal(JSON.stringify(bound), JSON.stringify(['ABC123']))
  assert.equal(page.data.primaryAction, 'purchase')
  assert.equal(page.data.primaryLabel, '开通基础会员 ¥49.9')
})

test('a server-side invite refusal refreshes the page into the invite prompt', async () => {
  let current = { status: 'inactive', eligible: false, tiers, tier: null, order: null }
  let modal
  const { page } = setup({
    loadCurrentMembership: async () => current,
    createMembershipOrder: async () => { current = { ...current, inviteRequired: true }; throw Object.assign(new Error('开通会员需要先填写邀请码。'), { code: 'MEMBERSHIP_INVITE_REQUIRED' }) },
    wx: { showModal: options => { modal = options } }
  })
  page.data.selectedTierId = ''
  page.applyMembership(current)
  assert.equal(page.data.primaryAction, 'purchase')
  await page.purchase()
  assert.equal(page.data.primaryAction, 'invite')
  assert.equal(page.data.membership.inviteRequired, true)
  assert.equal(modal.title, '填写邀请码后开通')
  // 取消填码：不绑定、不下单，按钮保持「填写邀请码后开通」
  await modal.success({ confirm: false })
  assert.equal(page.data.primaryLabel, '填写邀请码后开通')
})

// 2026-09-30 用户规则：支付开关关着时会员中心进不去——弹「会员功能准备中，敬请期待。」后离开，
// 不读会员状态，弹窗后面仍是骨架，不显示等级与价格
test('with the payment switch closed the membership center shows the notice and never reads membership', async () => {
  let reads = 0
  const { page, paymentSwitch } = setup({ paymentEnabled: false, loadCurrentMembership: async () => { reads++; return pending } })
  page.data.membership = null
  page.data.loading = true
  page.data.selectedTierId = ''
  await page.onShow()
  assert.equal(reads, 0)
  assert.deepEqual(paymentSwitch.closed, ['membership'])
  assert.equal(page.data.loading, true)
  assert.equal(page.data.showPlan, false)
  assert.equal(page.data.primaryLabel, '')
})

test('a backend payment refusal while on the page shows the notice instead of a payment error', async () => {
  let pays = 0
  const refused = Object.assign(new Error('会员功能准备中，敬请期待。'), { code: 'PAYMENT_DISABLED' })
  const { page, paymentSwitch, storage } = setup({ createMembershipOrder: async () => { throw refused }, payWechatOrder: async () => { pays++ } })
  await page.purchase()
  assert.equal(pays, 0)
  assert.equal(storage.size, 0)
  assert.equal(page.data.confirming, false)
  assert.deepEqual(paymentSwitch.closed, ['membership'])
})

test('Android opens the web payment page instead of paying inside the mini program', async () => {
  const paid = []
  const { page, storage, navigations, webPay, timers } = setup({ android: true, payWechatOrder: async (order) => { paid.push(order.orderId) } })
  await page.purchase()
  assert.deepEqual(paid, [])
  assert.deepEqual(webPay.opened, [{ orderId: '21', kind: 'membership', redirect: false }])
  assert.deepEqual(navigations, ['/commerce/web-pay/index?orderId=21&kind=membership'])
  // 等待页负责确认结果：会员中心不进入「正在确认」、不轮询
  assert.equal(storage.has('library_membership_confirming_order'), false)
  assert.notEqual(page.data.confirming, true)
  assert.equal(timers.size, 0)
  assert.equal(page.data.paying, false)
})
