// 2026-09-25 用户要求：积分包付款成功直接回首页；订单状态页（取消支付后）按积分包页那套样式；
// 登录按钮用主题橙；「我的」页积分、金币位数多时按卡内宽度缩小字号。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const paymentSwitchStub = require('./helpers/payment-switch-stub')
const webPayStub = require('./helpers/web-pay-stub')
const miniPayStub = require('./helpers/mini-pay-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

function loadPage(file, identity, { android = false } = {}) {
  let definition
  const calls = { switchTab: [], redirectTo: [], navigateTo: [], toasts: [] }
  const wx = {
    showToast(options) { calls.toasts.push(options.title) },
    redirectTo(options) { calls.redirectTo.push(options.url) },
    navigateTo(options) { calls.navigateTo.push(options.url) },
    switchTab(options) { calls.switchTab.push(options.url); if (options.success) options.success() },
    navigateBack() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 })
  }
  const context = {
    Page(page) { definition = page },
    getCurrentPages: () => [{}, {}],
    setTimeout, wx,
    require(name) {
      if (name.endsWith('/identity')) return identity
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/payment-done')) {
        // 共用模块在同一个 wx 桩下运行
        const module = { exports: {} }
        vm.runInNewContext(read('commerce/payment-done.js'), { module, wx })
        return module.exports
      }
      if (name.endsWith('/payment-switch')) return paymentSwitchStub(wx)
      if (name.endsWith('/web-pay')) return webPayStub(wx, { android })
      if (name.endsWith('/mini-pay')) return miniPayStub(() => identity, webPayStub(wx, { android }))
      throw new Error(`Unexpected import ${name}`)
    }
  }
  vm.runInNewContext(read(file), context)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, calls }
}

const product = { id: 9, name: '积分包', credits: 100, amount: 1, payableAmount: 1, memberPriceApplied: false }
const user = { profileCompleted: true, profile: { id: 5, nickname: '小鹿' } }
const order = { orderId: 31, orderNo: 'CL31', amount: 1, description: '积分包' }

test('order status page: continuing payment goes home; closed orders cannot be paid', async () => {
  let paid = 0
  const identity = (status) => ({
    loadOrderDetail: async () => ({ id: 31, status, statusLabel: status === '已取消' ? '已关闭' : status, order_no: 'CL31', amount: 1, amountDisplay: '1', title: '积分包' }),
    payWechatOrder: async () => { paid += 1 }, isWechatPaymentCancelled: () => false
  })

  const pending = loadPage('commerce/payment-result/index.js', identity('待支付'))
  pending.page.onLoad({ orderId: '31' })
  await pending.page.loadPage()
  assert.equal(pending.page.data.view.kind, 'pending')
  await pending.page.continuePayment()
  assert.equal(paid, 1)
  assert.deepEqual(pending.calls.switchTab, ['/pages/home/index'])

  const closed = loadPage('commerce/payment-result/index.js', identity('已取消'))
  closed.page.onLoad({ orderId: '31' })
  await closed.page.loadPage()
  assert.equal(closed.page.data.view.kind, 'closed')
  assert.equal(closed.page.data.view.title, '订单已关闭')
  await closed.page.continuePayment()
  assert.equal(paid, 1)

  const done = loadPage('commerce/payment-result/index.js', identity('已支付'))
  done.page.onLoad({ orderId: '31' })
  await done.page.loadPage()
  assert.equal(done.page.data.view.kind, 'paid')
})

test('Android: continuing a pending order from the status page opens web payment', async () => {
  let paid = 0
  const { page, calls } = loadPage('commerce/payment-result/index.js', {
    loadOrderDetail: async () => ({ id: 31, status: '待支付', statusLabel: '待支付', order_no: 'CL31', amount: 1, amountDisplay: '1', title: '积分包' }),
    payWechatOrder: async () => { paid += 1 }, isWechatPaymentCancelled: () => false
  }, { android: true })
  page.onLoad({ orderId: '31' })
  await page.loadPage()
  await page.continuePayment()
  assert.equal(paid, 0)
  assert.deepEqual(calls.navigateTo, ['/commerce/web-pay/index?orderId=31&kind=credit'])
})

test('order status page follows the commerce page style instead of the old placeholder', () => {
  assert.equal(JSON.parse(read('commerce/payment-result/index.json')).navigationStyle, 'custom')
  const wxml = read('commerce/payment-result/index.wxml')
  const wxss = read('commerce/payment-result/index.wxss')
  assert.doesNotMatch(wxml, /服务端支付回调|surface/)
  assert.match(wxml, /class="result-topbar"/)
  assert.match(wxss, /\.result-card \{[^}]*border-radius: 32rpx[^}]*background: #fff/)
  assert.match(wxss, /\.result-button\.is-primary \{[^}]*linear-gradient\(90deg, #FF9F43 0%, #FD7C02 100%\)/)
})

test('login button uses the theme orange', () => {
  const rule = read('pages/login/login.wxss').match(/\.login-button \{[^}]*\}/)[0]
  assert.match(rule, /background: #FD7C02/)
})

test('wallet numbers shrink to fit the card and go back to the stylesheet size when they get shorter', () => {
  const { fitFontSize, correctFontSize, estimateTextWidth } = require('../utils/fit-font')
  // 375 宽手机：原字号 18px，卡内可用约 72px；0 表示不写行内字号、沿用样式
  assert.equal(fitFontSize('120', 72, 18, 10), 0)
  const size = fitFontSize('2000000', 72, 18, 10)
  assert.ok(size > 0 && size < 18 && estimateTextWidth('2000000', size) <= 72, String(size))
  assert.equal(fitFontSize('99999999999999999', 72, 18, 10), 10)
  assert.equal(fitFontSize('2000000', undefined, 18, 10), 0)
  // 实测比估算宽：按实际字号再缩一点；数字变短：回到样式里的原字号
  assert.equal(correctFontSize(16, 80, 72, 18, 10), 14.4)
  assert.equal(correctFontSize(12, 30, 72, 18, 10), 0)
})

test('me page sizes wallet numbers from the measured card width', () => {
  let definition
  vm.runInNewContext(read('pages/me/index.js'), {
    Page(page) { definition = page },
    wx: {},
    require(name) {
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/fit-font')) return require('../utils/fit-font')
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      return {}
    }
  })
  const page = { ...definition, _walletBoxWidths: [72, 72] }
  const sizes = page.estimateWalletValueSizes({ accountSummary: [{ value: '200000000' }, { value: '30' }] })
  assert.ok(sizes[0] > 0 && sizes[0] < 18, JSON.stringify(sizes))
  assert.equal(sizes[1], 0)
  assert.match(read('pages/me/index.wxml'), /class="wallet-value" style="\{\{walletValueSizes\[index\]/)
})
