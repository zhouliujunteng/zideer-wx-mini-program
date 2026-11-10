const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const view = require('../services/settlement-view')
const settlementPath = require.resolve('../agent/settlement/index.js')
const recordsPath = require.resolve('../agent/settlement-records/index.js')
const identityPath = require.resolve('../services/identity.js')

const NOW = Date.parse('2026-09-21T12:00:00+08:00')

function reward(overrides = {}) {
  return {
    id: 1,
    entry_no: 'TG-20260921-001',
    entry_type: 'reward',
    status: 'selectable',
    amount: '28.00',
    locked_until: '2026-09-20T12:00:00+08:00',
    available_at: '2026-09-20T12:00:00+08:00',
    occurred_at: '2026-09-21T09:00:00+08:00',
    ...overrides
  }
}

function client(overrides = {}) {
  return {
    id: 1,
    status: 'active',
    statusLabel: '有效',
    sourceLabel: '分享邀请',
    attributed_at: '2026-09-05T20:00:00+08:00',
    displayName: '林同学',
    stageLabel: 'junior',
    membershipActive: true,
    ...overrides
  }
}

function applyData(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!key.includes('.') && !key.includes('[')) {
      target[key] = value
      continue
    }
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (const part of parts.slice(0, -1)) cursor = cursor[part]
    cursor[parts[parts.length - 1]] = value
  }
}

function loadPage(pagePath, identityStub, { pageStack = [{}, {}] } = {}) {
  delete require.cache[pagePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: identityStub }
  let definition = null
  const calls = { navigate: [], toast: [], customerService: [] }
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pageStack
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    navigateTo: (opts) => calls.navigate.push(opts.url),
    navigateBack: () => calls.navigate.push('back'),
    showToast: (opts) => calls.toast.push(opts.title),
    openCustomerServiceChat: (opts) => { calls.customerService.push(opts); opts.success({}) },
    showModal: (opts) => { (calls.modal = calls.modal || []).push(opts); opts.success({ confirm: true }) },
    // 页面用 selectorQuery 量列表高度与顶栏渐变，这里给一个固定的位置。
    createSelectorQuery: () => ({
      select: () => ({
        boundingClientRect(callback) {
          callback({ top: 300, height: 120 })
          return this
        },
        exec() {}
      }),
      exec() {}
    })
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { applyData(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls }
}

test('reward statuses fall into the five settlement buckets', () => {
  assert.equal(view.rewardBucket('locked'), 'locked')
  assert.equal(view.rewardBucket('selectable'), 'selectable')
  assert.equal(view.rewardBucket('available'), 'selectable')
  assert.equal(view.rewardBucket('cash_available'), 'selectable', '提现被驳回退回来的现金还能再提现')
  assert.equal(view.rewardBucket('withdrawing'), 'cash')
  assert.equal(view.rewardBucketOf({ status: 'locked', locked_until: '2026-09-20T12:00:00+08:00' }, NOW), 'selectable', '锁定期满按可选择展示')
  assert.equal(view.rewardBucketOf({ status: 'locked', locked_until: '2026-09-28T12:00:00+08:00' }, NOW), 'locked')
  assert.equal(view.rewardBucket('elected_cash'), 'cash')
  assert.equal(view.rewardBucket('gift_credits_available'), 'credits')
  assert.equal(view.rewardBucket('reversed'), 'reversed')
  assert.equal(view.rewardBucket('brand_new_status'), 'other')
})

test('the reward card totals real amounts and skips reversed entries', () => {
  const summary = view.buildSettlementSummary([
    reward({ id: 1, status: 'selectable', amount: '28', occurred_at: '2026-09-21T09:00:00+08:00' }),
    reward({ id: 2, status: 'locked', amount: '30', locked_until: '2026-09-27T09:00:00+08:00', occurred_at: '2026-09-20T09:00:00+08:00' }),
    reward({ id: 3, status: 'elected_cash', amount: '36', occurred_at: '2026-09-10T09:00:00+08:00' }),
    reward({ id: 4, status: 'elected_credits', amount: '22', occurred_at: '2026-08-28T09:00:00+08:00' }),
    reward({ id: 5, status: 'reversed', amount: '8', occurred_at: '2026-08-24T09:00:00+08:00' })
  ], NOW)
  assert.equal(summary.balanceValue, '116.00')
  assert.deepEqual(summary.dailySummary.map((item) => item.value), ['¥28.00', '¥30.00'])
  assert.equal(summary.selectable.value, '28.00')
  assert.deepEqual(summary.selectable.metrics.map((item) => item.value), ['30.00', '36.00', '22.00'])
})

test('records merge the reward ledger with recoveries, newest first', () => {
  const records = view.buildRecords(
    [reward({ id: 1, entry_no: 'TG-1', amount: '28', occurred_at: '2026-09-21T09:00:00+08:00' })],
    [{ id: 9, recovery_no: 'TH-1', source_amount: '12', status: 'pending', created_at_business: '2026-09-18T10:00:00+08:00' }]
  )
  assert.deepEqual(records.map((item) => item.recordNo), ['TG-1', 'TH-1'])
  assert.deepEqual(records.map((item) => item.amount), ['+28.00', '-12.00'])
  assert.deepEqual(records.map((item) => item.statusKey), ['selectable', 'recovering'])
  assert.equal(records[0].monthLabel, '2026年09月')
  assert.equal(records[0].detail, '2026-09-21 09:00')
})

test('the detail tabs split pending from settled records', () => {
  const records = view.buildRecords([
    reward({ id: 1, status: 'locked', locked_until: '2026-09-28T09:00:00+08:00', occurred_at: '2026-09-21T09:00:00+08:00' }),
    reward({ id: 2, status: 'selectable', occurred_at: '2026-09-20T09:00:00+08:00' }),
    reward({ id: 3, status: 'elected_cash', occurred_at: '2026-09-19T09:00:00+08:00' }),
    reward({ id: 4, status: 'reversed', occurred_at: '2026-09-18T09:00:00+08:00' })
  ], [], NOW)
  assert.equal(view.filterRecords(records, 'all').length, 4)
  assert.deepEqual(view.filterRecords(records, 'pending').map((item) => item.statusKey), ['locked', 'selectable'])
  assert.deepEqual(view.filterRecords(records, 'settled').map((item) => item.statusKey), ['cash', 'reversed'])
  assert.deepEqual(view.groupRecordsByMonth(records).map((group) => group.monthLabel), ['2026年09月'])
})

const CONTACT = { id: '7', contactType: 'enterprise_wechat_link', title: '知鹿课程顾问', corpId: 'ww1234567890abcdef', targetRef: 'https://work.weixin.qq.com/kfid/kfc0123456789' }

function settlementStub(growth = {}, overrides = {}) {
  return {
    loadCurrentGrowthCenter: async () => ({
      promoter: { id: 1, status: 'active' }, student: {}, rewards: [], recoveries: [], clients: [], ...growth
    }),
    loadMeDashboard: async () => ({ profile: { displayName: '知鹿学生', initial: '知', avatarUrl: 'https://assets.example/avatar.png' } }),
    loadCurrentServiceContacts: async () => ({ status: 'ready', contacts: [CONTACT] }),
    ...overrides
  }
}

test('the settlement centre shows the five newest records and links to the full list', async () => {
  const rewards = Array.from({ length: 8 }, (item, index) => reward({
    id: index + 1,
    entry_no: `TG-${index + 1}`,
    occurred_at: `2026-09-${String(20 - index).padStart(2, '0')}T09:00:00+08:00`
  }))
  const { page, calls } = loadPage(settlementPath, settlementStub({
    promoter: { id: 1, status: 'active', display_name: '知鹿推广' },
    student: { id: 1, nickname: '测试学生' },
    rewards,
    giftAccount: { available_credits: '120', gifted_credits: '30', reversed_credits: '0', status: 'active' }
  }))
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.profile.name, '知鹿推广')
  assert.equal(page.data.statusNotice.visible, false)
  assert.equal(page.data.giftAccount.value, '120.00')
  const listed = page.data.recordGroups.reduce((total, group) => total + group.records.length, 0)
  assert.equal(listed, 5)
  page.handleViewAll()
  assert.deepEqual(calls.navigate, ['/agent/settlement-records/index'])
})

test('整笔转现金 opens the reward settlement page and the records entry opens my settlement records', async () => {
  const { page, calls } = loadPage(settlementPath, settlementStub())
  page.onLoad()
  await page.loadPage()
  page.handleElection()
  page.handleApplications()
  assert.deepEqual(calls.navigate, ['/agent/withdraw/index', '/agent/settlement-applications/index'])
  assert.equal(calls.toast.length, 0)
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../agent/settlement/index.wxml'), 'utf8')
  assert.match(wxml, /我的结算记录/)
  assert.match(wxml, /bindtap="handleApplications"/)
})

// 2026-09-29 起推广伙伴在小程序申请：提示条进「申请成为推广伙伴」页，不再先查实名再拉起客服
test('an account without a promoter profile sees the notice and taps into the partner application page', async () => {
  const { page, calls } = loadPage(settlementPath, settlementStub({ promoter: null, student: { nickname: '测试学生' } }))
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.summary.balanceValue, '0.00')
  assert.equal(page.data.giftAccount.visible, false)
  assert.equal(page.data.statusNotice.visible, true)
  assert.equal(page.data.statusNotice.title, '提现需开通推广伙伴')
  await page.handleStatusNotice()
  assert.deepEqual(calls.navigate, ['/agent/partner-apply/index'])
  assert.equal(calls.customerService.length, 0)
})

test('a failed growth center read keeps the settlement centre in a retryable state', async () => {
  const { page } = loadPage(settlementPath, settlementStub({}, {
    loadCurrentGrowthCenter: async () => { throw new Error('推广与金币中心暂时不可读取，请稍后重试。') }
  }))
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /稍后重试/)
})

test('the settlement centre shows the real avatar and opens the enterprise WeChat service', async () => {
  const { page, calls } = loadPage(settlementPath, settlementStub())
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.profile.avatarUrl, 'https://assets.example/avatar.png')
  assert.equal(page.data.profile.initial, '知')
  assert.equal(page.data.serviceMeta, '企业微信 · 知鹿课程顾问')
  await page.handleService()
  assert.deepEqual(calls.customerService.map((item) => item.corpId), ['ww1234567890abcdef'])
  assert.equal(calls.customerService[0].extInfo.url, CONTACT.targetRef)
  assert.equal(page.data.serviceOpening, false)
  assert.deepEqual(calls.navigate, [])
})

test('a missing avatar or service entry degrades instead of breaking the settlement data', async () => {
  const { page, calls } = loadPage(settlementPath, settlementStub({ rewards: [reward({ amount: '12' })] }, {
    loadMeDashboard: async () => { throw new Error('资料读取失败') },
    loadCurrentServiceContacts: async () => { throw new Error('服务入口读取失败') }
  }))
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.summary.balanceValue, '12.00')
  assert.equal(page.data.profile.avatarUrl, '')
  assert.equal(page.data.serviceContact, null)
  assert.match(page.data.serviceMeta, /真人服务/)
  await page.handleService()
  assert.deepEqual(calls.customerService, [])
  assert.deepEqual(calls.navigate, ['/account/service-contact/index'])
})

test('the settlement records page filters the real ledger by tab', async () => {
  const { page } = loadPage(recordsPath, {
    loadCurrentGrowthCenter: async () => ({
      promoter: { status: 'active' },
      rewards: [
        reward({ id: 1, status: 'locked', entry_no: 'TG-1', occurred_at: '2026-09-21T09:00:00+08:00' }),
        reward({ id: 2, status: 'elected_credits', entry_no: 'TG-2', occurred_at: '2026-08-21T09:00:00+08:00' })
      ],
      recoveries: [],
      clients: []
    })
  })
  page.onLoad()
  await page.loadPage()
  assert.deepEqual(page.data.recordGroups.map((group) => group.monthLabel), ['2026年09月', '2026年08月'])
  page.handleRecordTab({ currentTarget: { dataset: { id: 'settled' } } })
  assert.deepEqual(page.data.recordGroups.map((group) => group.monthLabel), ['2026年08月'])
  assert.equal(page.data.recordTabs.find((tab) => tab.isSelected).id, 'settled')
  page.handleRecordTab({ currentTarget: { dataset: { id: 'pending' } } })
  assert.deepEqual(page.data.recordGroups[0].records.map((item) => item.recordNo), ['TG-1'])
})

test('my promotion counts members from the server membership flag', () => {
  const summary = view.buildInviteSummary([
    client({ id: 1, membershipActive: true }),
    client({ id: 2, membershipActive: false }),
    client({ id: 3, membershipActive: true })
  ])
  assert.equal(summary.invitedValue, '3')
  assert.equal(summary.memberValue, '2')
  assert.equal(summary.note, '已有 2 人加入课程会员')
})

test('invite records show the desensitised summary with a readable school stage', () => {
  const [record] = view.buildInviteRecords([client()])
  assert.equal(record.name, '林同学')
  assert.equal(record.stageLabel, '初中')
  assert.equal(record.attributedLabel, '绑定日期 2026.09.05')
  assert.equal(record.membershipKey, 'member')
})

test('a suspended partner still reaches customer service from the notice', async () => {
  const { page, calls } = loadPage(settlementPath, settlementStub({ promoter: { id: 1, status: 'suspended' } }))
  page.onLoad()
  await page.loadPage()
  assert.equal(page.data.statusNotice.title, '推广资格暂不可用')
  await page.handleStatusNotice()
  assert.equal(calls.customerService.length, 1)
  assert.deepEqual(calls.navigate, [])
})
