const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const paymentSwitchStub = require('./helpers/payment-switch-stub')
const active = { status: 'active', eligible: true, permanent: true, expiresAt: null, tiers: [],
  tier: { productVersionId: '51', name: '黄金会员', amount: '99.00', creditAmount: '1000' } }

function setup(loadCurrentMembership, { paymentEnabled = true } = {}) {
  let definition
  const navigations = []
  const paymentSwitch = paymentSwitchStub({ navigateTo: options => navigations.push(options.url) }, { enabled: paymentEnabled })
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/me/index.js'), 'utf8'), {
    Page(p) { definition = p }, getApp: () => ({}),
    wx: { showToast() {}, navigateTo: options => navigations.push(options.url) },
    require(name) {
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/identity')) return { loadCurrentMembership, loadCurrentTeacherWorkspace: async () => ({ status: 'not_teacher', teacher: null, students: [] }), hasSession: () => true }
      if (name.endsWith('/utils/access-gate')) return require('../utils/access-gate')
      if (name.endsWith('/mock-service')) return { getMeModel: () => ({ profile: {}, accountSummary: [] }) }
      if (name.endsWith('/live-tab-service')) return { getLiveMeModel: async () => ({ profile: { name: 'Current student' } }), withGuardianQuickActions: (actions) => actions }
      if (name.endsWith('/utils/account-role')) return require('../utils/account-role')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/fit-font')) return require('../utils/fit-font')
      if (name.endsWith('/utils/mini-program-version')) return require('../utils/mini-program-version')
      if (name.endsWith('/payment-switch')) return paymentSwitch
      throw Error('Unexpected import')
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  return { page, navigations, paymentSwitch }
}

test('My page refreshes the real tier on returning and opens the membership center', async () => {
  let membership = active
  const { page, navigations } = setup(async () => membership)
  await page.onShow()
  assert.equal(page.data.member.tierLabel, '黄金会员')
  assert.equal(page.data.member.validityText, '永久有效')
  assert.equal(page.data.membershipLoading, false)
  await page.openMembership()
  assert.equal(navigations[0], '/commerce/membership/index')
  page.onHide()
  membership = { status: 'expired', eligible: false }
  await page.onShow()
  assert.equal(page.data.member.tierLabel, '普通用户')
  assert.equal(page.data.member.statusLabel, '会员已到期')
})
test('a membership error clears the old tier without hiding the profile', async () => {
  let failing = false
  const { page } = setup(async () => { if (failing) throw Error('暂不可用'); return active })
  await page.onShow()
  failing = true
  await page.onShow()
  assert.equal(page.data.member.tierLabel, '等级待确认')
  assert.equal(page.data.model.profile.name, 'Current student')
  assert.equal(page.data.membershipError, '暂不可用')
})
test('late membership replies cannot restore an earlier session tier after returning', async () => {
  let resolve
  let calls = 0
  const { page } = setup(() => ++calls === 1 ? new Promise(r => { resolve = r }) : Promise.resolve({ status: 'inactive', eligible: false }))
  const first = page.onShow()
  page.onHide()
  await page.onShow()
  resolve(active)
  await first
  assert.equal(page.data.member.tierLabel, '普通用户')
  assert.equal(page.data.member.active, false)
})

// 2026-09-30 用户规则：支付开关关着时会员卡直接不显示；刚关掉、页面还没刷新时点到了也只弹提示，不进会员中心
test('with the payment switch closed the membership card is hidden', async () => {
  const { page, navigations, paymentSwitch } = setup(async () => active, { paymentEnabled: false })
  assert.equal(page.data.paymentOpen, false)
  await page.onShow()
  assert.equal(page.data.paymentOpen, false)
  assert.match(fs.readFileSync(path.join(__dirname, '../pages/me/index.wxml'), 'utf8'), /<view wx:if="\{\{paymentOpen\}\}" class="membership-card /)
  await page.openMembership()
  assert.deepEqual(navigations, [])
  assert.deepEqual(paymentSwitch.closed, ['membership'])
  const open = setup(async () => active)
  await open.page.onShow()
  assert.equal(open.page.data.paymentOpen, true)
})
