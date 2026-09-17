const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const active = { status: 'active', eligible: true, permanent: true, expiresAt: null, tiers: [],
  tier: { productVersionId: '51', name: '黄金会员', amount: '99.00', creditAmount: '1000' } }

function setup(loadCurrentMembership, contactResult = { status: 'no_active_contacts', contacts: [] }) {
  let definition
  const navigations = []
  const openedContacts = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/me/index.js'), 'utf8'), {
    Page(p) { definition = p }, getApp: () => ({}),
    wx: { showToast() {}, navigateTo: options => navigations.push(options.url) },
    require(name) {
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/identity')) return { loadCurrentMembership, loadCurrentServiceContacts: async () => contactResult }
      if (name.endsWith('/customer-service')) return { openCustomerServiceChat: async contact => { openedContacts.push(contact) } }
      if (name.endsWith('/mock-service')) return { getMeModel: () => ({ profile: {}, accountSummary: [] }) }
      if (name.endsWith('/live-tab-service')) return { getLiveMeModel: async () => ({ profile: { name: 'Current student' } }) }
      throw Error('Unexpected import')
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  return { page, navigations, openedContacts }
}

test('My page refreshes the real tier on returning and opens the membership center', async () => {
  let membership = active
  const { page, navigations } = setup(async () => membership)
  await page.onShow()
  assert.equal(page.data.member.tierLabel, '黄金会员')
  assert.equal(page.data.member.validityText, '永久有效')
  assert.equal(page.data.membershipLoading, false)
  page.openMembership()
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

test('enterprise service card opens the single preloaded WeChat customer-service chat directly', async () => {
  const contact = {
    id: 'service-1',
    corpId: 'ww1234567890abcdef',
    targetRef: 'https://work.weixin.qq.com/kfid/kfc1234567890abcdef'
  }
  const { page, navigations, openedContacts } = setup(async () => active, { status: 'ready', contacts: [contact] })

  await page.onShow()
  await page.openEnterpriseService()

  assert.deepEqual(openedContacts, [contact])
  assert.deepEqual(navigations, [])
})

test('enterprise service card tap is wired to the customer-service opener', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/me/index.wxml'), 'utf8')
  assert.match(template, /class="enterprise-service-card"[^>]*bindtap="openEnterpriseService"/)
})
