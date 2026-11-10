// 推广伙伴与成长中心页面第一次读到真实数据前只显示骨架：不渲染默认值、占位文案或空状态，
// 读到过一次后刷新保留旧数据，首次失败给重试。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const AGENT_PAGES = ['promotion', 'poster-detail', 'settlement', 'settlement-records']

function stubWx(extra = {}) {
  return {
    showToast() {}, navigateTo() {}, navigateBack() {}, redirectTo() {}, switchTab() {}, showShareMenu() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }),
    ...extra
  }
}

function makeRequire(modules) {
  return (name) => {
    const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
    if (key) return modules[key]
    if (name.endsWith('/utils/screen')) return require('../utils/screen')
    if (name.endsWith('/utils/referral-context')) return require('../utils/referral-context')
    if (name.endsWith('/utils/timeline-single-page')) return require('../utils/timeline-single-page')
    // 纯视图整理模块直接用真实实现
    if (/services\/(promotion-view|settlement-view|share-cover)$/.test(name)) return require(path.join(root, name.replace(/^(\.\.\/)+/, '')))
    throw new Error(`Unexpected import ${name}`)
  }
}

function withSetData(definition, extra = {}) {
  return {
    ...definition,
    ...extra,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (callback) callback()
    }
  }
}

function loadPage(file, modules) {
  let definition
  vm.runInNewContext(read(file), {
    Page(page) { definition = page },
    getApp: () => ({}),
    getCurrentPages: () => [{}, {}],
    wx: stubWx(),
    require: makeRequire(modules)
  })
  return withSetData(definition)
}

function loadGrowthPage(mode, identity) {
  let definition
  const toasts = []
  vm.runInNewContext(read('components/growth-page/index.js'), {
    Component(component) { definition = component },
    getCurrentPages: () => [{ options: {} }],
    wx: stubWx({ showToast: (opts) => toasts.push(opts.title) }),
    require: makeRequire({ '/identity': identity, '/ui-assets': { attachUiAssets() {} } })
  })
  const component = withSetData({ data: definition.data }, definition.methods)
  component.data.mode = mode
  component.attached = definition.lifetimes.attached
  component.toasts = toasts
  return component
}

const growth = (overrides = {}) => ({
  promoter: { status: 'active', display_name: '知鹿推广' },
  rewards: [], clients: [], invitations: [], coinLedger: [], withdrawals: [], redemptionRecords: [],
  ...overrides
})

test('every agent page and the growth component import the shared skeleton styles and drop the flat grey block', () => {
  const files = AGENT_PAGES.map((name) => `agent/${name}/index`).concat('components/growth-page/index')
  for (const base of files) {
    assert.match(read(`${base}.wxss`), /@import "..\/..\/styles\/skeleton.wxss";/, base)
    assert.match(read(`${base}.wxml`), /class="sk[ "]/, base)
    assert.doesNotMatch(read(`${base}.wxml`), /class="[^"]*skeleton[^"]*"/, base)
  }
})

test('agent pages keep the empty copy behind a successful load', () => {
  const emptyCopy = {
    promotion: '<view wx:elif="{{posterState !== \'ready\'}}" class="promotion-poster-empty">',
    settlement: '<view wx:elif="{{recordGroups.length}}" class="settlement-record-list">',
    'settlement-records': '<scroll-view wx:else class="settlement-records-list-card"'
  }
  for (const [name, marker] of Object.entries(emptyCopy)) {
    const wxml = read(`agent/${name}/index.wxml`)
    const skeleton = wxml.indexOf("wx:if=\"{{loadState !== 'ready'}}\"")
    assert.ok(skeleton > 0, `${name} has a skeleton branch before first load`)
    assert.ok(wxml.indexOf(marker) > skeleton, `${name} empty/real branch follows the skeleton`)
  }
})

test('promotion balance card starts with fixed labels only, no 0.00 amounts', () => {
  const page = loadPage('agent/promotion/index.js', { '/identity': {}, '/ui-assets': { attachUiAssets() {} } })
  assert.equal(page.data.balance.availableLabel, '可用奖励')
  assert.equal(page.data.balance.availableValue, undefined)
  assert.equal(page.data.balance.lockedValue, undefined)
  assert.match(read('agent/promotion/index.wxml'), /wx:if="\{\{loadState === 'ready'\}\}" class="promotion-balance-metric-value"/)
})

test('settlement centre shows no default name, avatar initial or service placeholder before the first load', () => {
  const page = loadPage('agent/settlement/index.js', {
    '/identity': {}, '/ui-assets': { attachUiAssets() {} },
    '/customer-service': { openCustomerServiceChat() {}, customerServiceErrorMessage: () => '' }
  })
  assert.equal(page.data.profile.name, '')
  assert.equal(page.data.profile.initial, '')
  assert.equal(page.data.serviceMeta, '')
  page.onLoad()
  // 固定标题在 onLoad 就有，金额位由 loadState 挡住
  assert.equal(page.data.summary.balanceLabel, '累计奖励（元）')
  const wxml = read('agent/settlement/index.wxml')
  assert.match(wxml, /<block wx:if="\{\{loadState === 'ready'\}\}">\s*<view class="settlement-profile-avatar">/)
  assert.match(wxml, /wx:if="\{\{loadState === 'ready'\}\}" class="settlement-wallet-value"/)
  assert.match(wxml, /wx:if="\{\{loadState === 'ready'\}\}" class="settlement-service-meta"/)
})

test('poster detail sizes its skeleton like a default 3:4 poster preview', () => {
  const page = loadPage('agent/poster-detail/index.js', {
    '/identity': { loadPublishedPromotionAssets: () => new Promise(() => {}), loadCurrentGrowthCenter: () => new Promise(() => {}) },
    '/ui-assets': { attachUiAssets() {} }
  })
  page.onLoad({ id: '1' })
  assert.equal(page.data.loadState, 'loading')
  assert.match(page.data.skeletonPosterStyle, /^width: \d+px; height: \d+px;$/)
  assert.match(read('agent/poster-detail/index.wxml'), /class="sk poster-detail-sk-poster" style="\{\{skeletonPosterStyle\}\}"/)
})

test('growth page renders its title at once and shape-matched skeletons until the first load', async () => {
  let resolve
  const page = loadGrowthPage('dashboard', { loadCurrentGrowthCenter: () => new Promise((done) => { resolve = done }) })
  page.attached()
  assert.equal(page.data.title, '推广伙伴工作台')
  assert.equal(page.data.isPartnerPage, true)
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.failed, false)
  resolve(growth())
  await new Promise((done) => setImmediate(done))
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.center.promoter.display_name, '知鹿推广')

  const wxml = read('components/growth-page/index.wxml')
  // 标题不在任何数据条件里
  assert.match(wxml, /<view class="growth-page">\s*<view class="growth-head">/)
  for (const mode of ['application', 'dashboard', 'clients', 'client-detail', 'ai-poster', 'material-library']) {
    assert.ok(wxml.includes(`mode === '${mode}'`), mode)
  }
  assert.doesNotMatch(wxml, /正在读取已发布素材/)
  // 空状态文案都排在「未加载」骨架分支之后
  for (const copy of ['暂无金币流水', '暂无兑换申请', '暂无兑换记录']) {
    const at = wxml.indexOf(copy)
    const skeleton = wxml.lastIndexOf('="{{!loaded}}"', at)
    assert.ok(skeleton > 0 && skeleton < at, copy)
  }
})

test('growth page keeps old data on a failed refresh and only shows retry when the first load fails', async () => {
  let fail = false
  const page = loadGrowthPage('coin-withdrawal', {
    loadCurrentGrowthCenter: async () => {
      if (fail) throw new Error('offline')
      return growth({ withdrawals: [{ id: 1, request_no: 'W1', requested_at: '2026-09-20T00:00:00Z' }] })
    }
  })
  page.attached()
  await new Promise((done) => setImmediate(done))
  assert.equal(page.data.loaded, true)
  fail = true
  await page.loadPage()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.failed, false)
  assert.equal(page.data.center.withdrawals.length, 1)

  const first = loadGrowthPage('material-library', {
    loadCurrentGrowthCenter: async () => growth(),
    loadPublishedPromotionAssets: async () => { throw new Error('offline') }
  })
  await first.loadPage()
  assert.equal(first.data.loaded, false)
  assert.equal(first.data.failed, true)
  assert.deepEqual(first.toasts, ['offline'])
})

test('growth page refresh after redeeming stays on screen instead of going back to a skeleton', async () => {
  const states = []
  const page = loadGrowthPage('redemption', {
    loadCurrentGrowthCenter: async () => growth({ student: { id: 7 } }),
    redeemCurrentStudentCode: async () => ({ record_no: 'R1', benefits: {} })
  })
  page.attached()
  await new Promise((done) => setImmediate(done))
  const setData = page.setData
  page.setData = function (patch, cb) { if ('loaded' in patch || 'failed' in patch) states.push({ ...patch }); return setData.call(this, patch, cb) }
  page.data.redemptionCode = 'ABC'
  await page.submitRedemption()
  assert.ok(states.every((patch) => patch.loaded !== false && patch.failed !== true))
  assert.equal(page.data.loaded, true)
})
