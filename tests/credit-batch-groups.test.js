// 课程积分页的「积分批次」按来源合并：后端一次发放一个批次，页面一个来源一行，逐笔明细留给下方积分记录。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadPage(account) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../commerce/entitlements/index.js'), 'utf8'), {
    Page(page) { definition = page },
    getCurrentPages: () => [],
    setTimeout, clearTimeout,
    wx: {
      showToast() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) })
    },
    require(name) {
      if (name.endsWith('/services/identity')) return { loadCurrentCreditAccount: async () => account }
      if (name.endsWith('/services/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  page.onLoad({})
  return page
}

const DAY = 86400000
const iso = offsetDays => new Date(Date.now() + offsetDays * DAY).toISOString()
const batch = (sourceLabel, remaining, extra = {}) => ({ sourceLabel, remaining_credits: remaining, status: 'active', active_at: iso(-1), expires_at: null, ...extra })

test('ten invite rewards collapse into one batch row; records keep every grant', async () => {
  const INVITE = '好友填写你的邀请码获得（限时活动）'
  const invites = Array.from({ length: 10 }, (_, i) => batch(INVITE, '30.00', { active_at: iso(-10 + i) }))
  const page = loadPage({
    account: { available: 300, frozen: 0 },
    batches: invites,
    ledger: invites.map((_, i) => ({ id: i + 1, credits: 30, businessLabel: INVITE, occurred_at: iso(-10 + i) }))
  })
  await page.loadPage()
  const rows = page.data.model.batches
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sourceLabel, INVITE)
  assert.equal(rows[0].remainingCreditsDisplay, '300')
  assert.match(rows[0].metaLabel, /^共 10 笔 · 最近获得于 /)
  const records = page.data.model.activeRecordGroups.reduce((sum, group) => sum + group.records.length, 0)
  assert.equal(records, 10)
})

test('used-up, expired and inactive batches do not count; sources left with nothing are hidden', async () => {
  const page = loadPage({
    account: { available: 0, frozen: 0 },
    batches: [
      batch('兑换码兑换', '0'),
      batch('兑换码兑换', '50', { expires_at: iso(-1) }),
      batch('后台发放', '20', { status: 'revoked' }),
      batch('购买获得', '12.5'),
      batch('购买获得', '0.4', { status: 'exhausted' })
    ],
    ledger: []
  })
  await page.loadPage()
  const rows = page.data.model.batches
  assert.deepEqual([...rows.map(row => row.sourceLabel)], ['购买获得'])
  assert.equal(rows[0].remainingCreditsDisplay, '13')
  assert.match(rows[0].metaLabel, /^获得于 \d{4}年\d{1,2}月\d{1,2}日$/)
})

test('sources with an expiry come first, earliest expiry first, and show when they start to expire', async () => {
  const page = loadPage({
    account: { available: 0, frozen: 0 },
    batches: [
      batch('购买获得', '100'),
      batch('通过绑定邀请码获得（限时活动）', '10', { expires_at: iso(20) }),
      batch('后台发放', '5', { expires_at: iso(40) }),
      batch('后台发放', '5', { expires_at: iso(5) })
    ],
    ledger: []
  })
  await page.loadPage()
  const rows = page.data.model.batches
  assert.deepEqual([...rows.map(row => row.sourceLabel)], ['后台发放', '通过绑定邀请码获得（限时活动）', '购买获得'])
  assert.match(rows[0].metaLabel, /^共 2 笔 · 最早 .+ 到期$/)
  assert.match(rows[1].metaLabel, /^\d{4}年\d{1,2}月\d{1,2}日 到期$/)
  assert.equal(rows[0].remainingCreditsDisplay, '10')
})
