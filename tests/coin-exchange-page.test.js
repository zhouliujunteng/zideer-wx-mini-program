// 我的金币 · 兑换现金（2026-09-26）：兑换卡、兑换弹层、拉起微信确认收款页后按结果推进。
// 服务端流程在 OpenMAIC-sync lib/coin-exchange/service.ts，这里只测小程序这一侧。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadCoinsPage({ growth, exchange, calls = [], transfer = 'confirmed', syncStatus = 'paid', startError = null }) {
  const shown = { toasts: [], modals: [] }
  const exchangeService = {
    loadCoinExchange: async () => { calls.push('load'); if (exchange instanceof Error) throw exchange; return exchange },
    startCoinExchange: async (coins) => { calls.push(`start:${coins}`); if (startError) throw startError; return { exchange: { requestNo: 'CX20260926AAAA', status: 'wait_user_confirm', amountFen: coins }, confirm: { mchId: '1900000001', appId: 'wxd8ebfbf19b9a5895', package: 'PKG==' } } },
    resumeCoinExchange: async (no) => { calls.push(`resume:${no}`); return { exchange: { requestNo: no, status: 'wait_user_confirm', amountFen: 500 }, confirm: { mchId: '1900000001', appId: 'wxd8ebfbf19b9a5895', package: 'PKG2==' } } },
    syncCoinExchange: async (no) => { calls.push(`sync:${no}`); return { exchange: { requestNo: no, status: syncStatus, amountFen: 500 } } },
    cancelCoinExchange: async (no) => { calls.push(`cancel:${no}`); return { exchange: { requestNo: no, status: 'processing', amountFen: 500 } } },
    confirmTransfer: async (confirm) => { calls.push(`confirm:${confirm.package}`); if (transfer instanceof Error) throw transfer; return transfer }
  }
  let definition
  vm.runInNewContext(read('growth/coins/index.js'), {
    Page(page) { definition = page },
    getCurrentPages: () => [],
    setTimeout: (fn) => fn(),
    wx: {
      showToast(options) { shown.toasts.push(options.title) },
      showModal(options) { shown.modals.push(options) },
      navigateTo() {}, navigateBack() {}, switchTab() {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
      createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) })
    },
    require(name) {
      if (name.endsWith('/services/identity')) return { loadCurrentGrowthCenter: async () => growth }
      if (name.endsWith('/services/coin-exchange')) return exchangeService
      if (name.endsWith('/services/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) {
    Object.assign(this.data, JSON.parse(JSON.stringify(patch)))
    if (callback) callback()
  } }
  page.onLoad({})
  return { page, calls, shown }
}

const growth = (available = 1286) => ({ coinAccount: { available, frozen: 0 }, coinLedger: [] })
const overview = (extra = {}) => ({ success: true, enabled: true, coinsPerYuan: 100, minYuan: 1, maxYuan: 200, dailyLimit: 3, todayCount: 0, available: 1286, frozen: 0, pending: null, ...extra })

test('the exchange card shows whole yuan, the backend rate, and skeletons until each part arrives', async () => {
  const { page } = loadCoinsPage({ growth: growth(1286), exchange: overview({ coinsPerYuan: 50 }) })
  assert.equal(page.data.exchangeLoaded, false)
  const wxml = read('growth/coins/index.wxml')
  assert.match(wxml, /wx:if="\{\{loaded\}\}" class="exchange-value">¥\{\{exchangeCard.yuan\}\}/)
  assert.match(wxml, /wx:if="\{\{exchangeLoaded\}\}" class="exchange-rate">\{\{exchangeCard.rateLabel\}\}<\/text><view wx:else class="sk/)
  assert.doesNotMatch(wxml, /兑换码/, '金币页不再放兑换码入口')
  await Promise.all([page.loadPage(), page.loadExchange()])
  assert.equal(page.data.exchangeCard.yuan, '25', '1286 金币按 50 金币 = 1 元，整元 25')
  assert.equal(page.data.exchangeCard.rateLabel, '50 金币 = 1 元，直接转到微信零钱')
  assert.deepEqual(page.data.serviceEntries.map(entry => entry.label), ['金币任务', '兑换记录'])
})

test('a closed exchange explains the rule instead of opening the sheet', async () => {
  const { page, shown } = loadCoinsPage({ growth: growth(), exchange: overview({ enabled: false }) })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  assert.equal(page.data.exchangeSheetVisible, false)
  assert.match(shown.modals[0].content, /每 100 金币可兑换 1 元.*即将开放/)
})

test('not enough coins or no exchanges left today stop before the sheet', async () => {
  const poor = loadCoinsPage({ growth: growth(99), exchange: overview() })
  await Promise.all([poor.page.loadPage(), poor.page.loadExchange()])
  await poor.page.handleExchange()
  assert.equal(poor.page.data.exchangeSheetVisible, false)
  assert.match(poor.shown.modals[0].content, /满 100 金币就能兑换 1 元/)
  const done = loadCoinsPage({ growth: growth(), exchange: overview({ todayCount: 3 }) })
  await Promise.all([done.page.loadPage(), done.page.loadExchange()])
  await done.page.handleExchange()
  assert.equal(done.page.data.exchangeSheetVisible, false)
  assert.match(done.shown.toasts[0], /次数用完/)
})

test('the sheet starts at the most the balance allows and steps by whole yuan within the limits', async () => {
  const { page } = loadCoinsPage({ growth: growth(1286), exchange: overview({ todayCount: 1 }) })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  assert.equal(page.data.exchangeSheetVisible, true)
  assert.deepEqual(page.data.exchangeSheet, { rate: 100, minYuan: 1, maxYuan: 12, remaining: 2, yuan: 12, coins: 1200, canDecrease: true, canIncrease: false })
  page.changeExchangeYuan({ currentTarget: { dataset: { step: '-1' } } })
  assert.equal(page.data.exchangeSheet.coins, 1100)
  for (let i = 0; i < 20; i++) page.changeExchangeYuan({ currentTarget: { dataset: { step: '-1' } } })
  assert.equal(page.data.exchangeSheet.yuan, 1)
  assert.equal(page.data.exchangeSheet.canDecrease, false)
  page.exchangeAll()
  assert.equal(page.data.exchangeSheet.yuan, 12)
})

test('confirming in WeChat syncs the exchange and celebrates when it has arrived', async () => {
  const { page, calls, shown } = loadCoinsPage({ growth: growth(1286), exchange: overview() })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  page.changeExchangeYuan({ currentTarget: { dataset: { step: '-1' } } })
  calls.length = 0
  await page.submitExchange()
  assert.deepEqual(calls.slice(0, 3), ['start:1100', 'confirm:PKG==', 'sync:CX20260926AAAA'])
  assert.ok(calls.includes('load'), '结束后重新读取')
  assert.equal(page.data.exchangeSheetVisible, false)
  assert.equal(page.data.exchanging, false)
  assert.match(shown.modals[0].content, /¥11.00 已转到你的微信零钱/)
})

test('backing out of the WeChat receipt page cancels the transfer so the coins come back', async () => {
  const { page, calls, shown } = loadCoinsPage({ growth: growth(), exchange: overview(), transfer: 'cancelled' })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  calls.length = 0
  await page.submitExchange()
  assert.deepEqual(calls.slice(0, 3), ['start:1200', 'confirm:PKG==', 'cancel:CX20260926AAAA'])
  assert.match(shown.toasts[0], /已取消兑换，金币会退回/)
})

test('an old WeChat cancels the transfer and says to upgrade', async () => {
  const old = Object.assign(new Error('当前微信版本太低，请升级微信后再兑换。'), { code: 'UNSUPPORTED' })
  const { page, calls, shown } = loadCoinsPage({ growth: growth(), exchange: overview(), transfer: old })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  await page.submitExchange()
  assert.ok(calls.includes('cancel:CX20260926AAAA'))
  assert.match(shown.modals[0].content, /升级微信/)
})

test('an exchange waiting for confirmation turns the button into 去确认收款 and resumes that one', async () => {
  const pending = { requestNo: 'CX20260926BBBB', status: 'wait_user_confirm', coins: 500, amountFen: 500 }
  const { page, calls } = loadCoinsPage({ growth: growth(), exchange: overview({ pending }) })
  await Promise.all([page.loadPage(), page.loadExchange()])
  assert.deepEqual(page.data.exchangeCard.pending, { requestNo: 'CX20260926BBBB', waiting: true, amount: '5.00' })
  assert.match(read('growth/coins/index.wxml'), /去确认收款/)
  calls.length = 0
  await page.handleExchange()
  assert.deepEqual(calls.slice(0, 3), ['resume:CX20260926BBBB', 'confirm:PKG2==', 'sync:CX20260926BBBB'])
  assert.equal(page.data.exchangeSheetVisible, false, '在途的一笔不打开金额弹层')
})

test('a paused exchange (operating account ran dry) says it is under maintenance and the coins are safe', async () => {
  const { page, shown, calls } = loadCoinsPage({ growth: growth(), exchange: overview({ paused: true }) })
  await Promise.all([page.loadPage(), page.loadExchange()])
  calls.length = 0
  await page.handleExchange()
  assert.equal(page.data.exchangeSheetVisible, false)
  assert.equal(shown.modals[0].title, '兑换维护中')
  assert.match(shown.modals[0].content, /金币都在/)
  assert.deepEqual(calls, [], '暂停中不发起兑换')
})

test('running into the pause while exchanging closes the sheet and shows the maintenance note', async () => {
  const paused = Object.assign(new Error('兑换现金暂时维护中，你的金币都在，请稍后再来。'), { code: 'EXCHANGE_PAUSED' })
  const { page, shown } = loadCoinsPage({ growth: growth(), exchange: overview(), startError: paused })
  await Promise.all([page.loadPage(), page.loadExchange()])
  await page.handleExchange()
  await page.submitExchange()
  assert.equal(page.data.exchangeSheetVisible, false)
  assert.equal(shown.modals[0].title, '兑换维护中')
  assert.equal(shown.toasts.length, 0)
})

test('a failed exchange overview does not block the page and is explained on tap', async () => {
  const { page, shown } = loadCoinsPage({ growth: growth(), exchange: new Error('兑换服务暂时不可用，请稍后再试。') })
  await Promise.all([page.loadPage(), page.loadExchange()])
  assert.equal(page.data.exchangeLoaded, true, '读取失败也不一直停在骨架')
  assert.equal(page.data.exchangeCard.rateLabel, '100 金币 = 1 元，直接转到微信零钱')
  await page.handleExchange()
  assert.match(shown.toasts[0], /暂时不可用/)
})

test('the coin exchange service maps server codes to plain words and calls WeChat with the package', async () => {
  const requests = []
  let response = { statusCode: 429, data: { success: false, code: 'DAILY_LIMIT' } }
  const sandbox = {
    module: { exports: {} },
    wx: {
      canIUse: (name) => name === 'requestMerchantTransfer',
      requestMerchantTransfer(options) { requests.push(options); options.fail({ errMsg: 'requestMerchantTransfer:fail cancel' }) }
    },
    require: (name) => {
      if (name === './identity') return { requestCourseApi: async (url, options) => { requests.push({ url, ...options }); return response } }
      throw new Error(name)
    }
  }
  vm.runInNewContext(read('services/coin-exchange.js'), sandbox)
  const service = sandbox.module.exports
  await assert.rejects(service.startCoinExchange(500), /今天的兑换次数用完了/)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), { url: '/api/learn/coin-exchange', method: 'POST', data: { operation: 'start', coins: 500 } })
  response = { statusCode: 200, data: { success: true, enabled: true } }
  assert.equal((await service.loadCoinExchange()).enabled, true)
  response = { statusCode: 503, data: {} }
  await assert.rejects(service.syncCoinExchange('CX1'), /暂时不可用/)
  assert.equal(await service.confirmTransfer({ mchId: '1900000001', appId: 'wxd8ebfbf19b9a5895', package: 'PKG==' }), 'cancelled')
  assert.equal(requests.at(-1).package, 'PKG==')
  sandbox.wx.canIUse = () => false
  await assert.rejects(service.confirmTransfer({ package: 'PKG==' }), /升级微信/)
})
