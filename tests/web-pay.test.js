'use strict'

// 安卓网页付款：services/web-pay.js 与等待页 commerce/web-pay。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const LINK = 'https://zideer.cn/pay/?t=31.1790900000.' + 'A'.repeat(43)

function loadService(wx, requestCourseApi = async () => ({ statusCode: 500, data: {} })) {
  const module = { exports: {} }
  vm.runInNewContext(read('services/web-pay.js'), {
    module, wx,
    require(name) {
      if (name === './identity') return { requestCourseApi }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  return module.exports
}

test('only Android pays on the web; unknown platforms keep in-app payment', () => {
  assert.equal(loadService({ getDeviceInfo: () => ({ platform: 'android' }) }).shouldPayOnWeb(), true)
  assert.equal(loadService({ getDeviceInfo: () => ({ platform: 'ios' }) }).shouldPayOnWeb(), false)
  assert.equal(loadService({ getDeviceInfo: () => ({ platform: 'devtools' }) }).shouldPayOnWeb(), false)
  assert.equal(loadService({ getSystemInfoSync: () => ({ platform: 'Android' }) }).shouldPayOnWeb(), true)
  assert.equal(loadService({ getDeviceInfo: () => { throw new Error('old base library') } }).shouldPayOnWeb(), false)
  assert.equal(loadService({}).shouldPayOnWeb(), false)
})

test('asks the course service for a link and reads the order status', async () => {
  const calls = []
  const service = loadService({}, async (url, options = {}) => {
    calls.push([url, options.method || 'GET', options.data])
    if (options.method === 'POST') return { statusCode: 200, data: { success: true, status: 'pending', url: LINK, order: { title: '积分包', amountFen: 1990 } } }
    return { statusCode: 200, data: { success: true, order: { status: 'paid' } } }
  })
  const link = await service.createWebPayLink(31, { push: true })
  assert.equal(link.url, LINK)
  assert.equal((await service.loadWebPayStatus('31')).status, 'paid')
  await service.createWebPayLink('31', { push: true, resend: true })
  // 服务在 VM 里跑，对象来自另一个 realm：按 JSON 比较
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['/api/learn/web-pay', 'POST', { orderId: '31', push: true, resend: false }],
    ['/api/learn/web-pay?orderId=31', 'GET', null],
    ['/api/learn/web-pay', 'POST', { orderId: '31', push: true, resend: true }]
  ])
})

test('turns service error codes into readable messages and refuses a strange link', async () => {
  const failing = loadService({}, async () => ({ statusCode: 409, data: { success: false, code: 'PAYMENT_DISABLED' } }))
  await assert.rejects(failing.createWebPayLink('31'), (error) => error.code === 'PAYMENT_DISABLED' && /准备中/.test(error.message))
  const strange = loadService({}, async () => ({ statusCode: 200, data: { success: true, status: 'pending', url: 'https://evil.example/?t=1' } }))
  await assert.rejects(strange.createWebPayLink('31'), /暂时不可用/)
  const unknown = loadService({}, async () => ({ statusCode: 503, data: {} }))
  await assert.rejects(unknown.loadWebPayStatus('31'), (error) => error.code === 'PAY_UNAVAILABLE')
})

test('opens the waiting page by navigate or redirect', () => {
  const urls = []
  const service = loadService({ navigateTo: (o) => urls.push(['navigate', o.url]), redirectTo: (o) => urls.push(['redirect', o.url]) })
  service.openWebPay(31, 'membership')
  service.openWebPay('32', 'credit', { redirect: true })
  service.openWebPay('33', 'something')
  assert.deepEqual(urls, [
    ['navigate', '/commerce/web-pay/index?orderId=31&kind=membership'],
    ['redirect', '/commerce/web-pay/index?orderId=32&kind=credit'],
    ['navigate', '/commerce/web-pay/index?orderId=33&kind=credit'],
  ])
})

// ---------------------------------------------------------------- 等待页

function loadPage(webPay, { enabled = true, pages = 2 } = {}) {
  let definition
  const timers = new Map()
  let timerId = 0
  const calls = { clipboard: [], switchTab: [], navigateBack: 0, toasts: [] }
  const wx = {
    setClipboardData(options) { calls.clipboard.push(options.data); options.success && options.success() },
    showToast(options) { calls.toasts.push(options.title) },
    switchTab(options) { calls.switchTab.push(options.url); options.success && options.success() },
    navigateBack() { calls.navigateBack += 1 },
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 })
  }
  const paymentSwitch = paymentSwitchStub(wx, { enabled })
  vm.runInNewContext(read('commerce/web-pay/index.js'), {
    Page(page) { definition = page }, wx,
    getCurrentPages: () => new Array(pages).fill({}),
    setTimeout(fn) { timers.set(++timerId, fn); return timerId }, clearTimeout(key) { timers.delete(key) },
    require(name) {
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      if (name.endsWith('/web-pay')) return webPay
      if (name.endsWith('/payment-switch')) return paymentSwitch
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/payment-done')) {
        const module = { exports: {} }
        vm.runInNewContext(read('commerce/payment-done.js'), { module, wx })
        return module.exports
      }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  // 跑掉排队的定时器（一轮）
  const tick = async () => {
    const pending = [...timers.entries()]
    timers.clear()
    for (const [, fn] of pending) await fn()
  }
  return { page, calls, timers, tick, paymentSwitch }
}

test('waiting page: skeleton first, then the link; polling shows success and returns home for credits', async () => {
  const statuses = ['pending', 'paid']
  const { page, calls, timers, tick } = loadPage({
    createWebPayLink: async (orderId) => ({ status: 'pending', url: LINK, order: { title: '积分包 300', amountFen: 1990, accountHint: '12**56' }, orderId }),
    loadWebPayStatus: async () => ({ status: statuses.shift() })
  })
  page.onLoad({ orderId: '31', kind: 'credit' })
  assert.equal(page.data.loaded, false)
  page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.link, LINK)
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.order)), { title: '积分包 300', amount: '19.90', accountHint: '12**56' })
  page.copyLink()
  assert.deepEqual(calls.clipboard, [LINK])
  assert.equal(page.data.copied, true)
  await tick()
  assert.equal(page.data.paid, false)
  assert.equal(timers.size, 1)
  await tick()
  assert.equal(page.data.paid, true)
  assert.equal(timers.size, 0)
  page.finish()
  assert.deepEqual(calls.switchTab, ['/pages/home/index'])
})

test('waiting page: stops asking while hidden and asks again on return', async () => {
  let asked = 0
  const { page, timers, tick } = loadPage({
    createWebPayLink: async () => ({ status: 'pending', url: LINK, order: { title: '黄金会员', amountFen: 9900 } }),
    loadWebPayStatus: async () => { asked += 1; return { status: 'pending' } }
  })
  page.onLoad({ orderId: '21', kind: 'membership' })
  page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  page.onHide()
  assert.equal(timers.size, 0)
  page.onShow()
  assert.equal(timers.size, 1)
  await tick()
  assert.equal(asked, 1)
})

test('waiting page: a membership paid before the link goes straight to success and back to the membership center', async () => {
  const { page, calls } = loadPage({
    createWebPayLink: async () => ({ status: 'paid', url: '', order: { title: '黄金会员', amountFen: 9900 } }),
    loadWebPayStatus: async () => { throw new Error('should not poll') }
  })
  page.onLoad({ orderId: '21', kind: 'membership' })
  page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.paid, true)
  page.finish()
  assert.equal(calls.navigateBack, 1)
})

test('waiting page: shows the reason when no link can be issued, and a closed order stops waiting', async () => {
  const failing = loadPage({
    createWebPayLink: async () => { throw Object.assign(new Error('这笔订单已付款或已关闭，请到订单记录查看。'), { code: 'ORDER_NOT_PENDING' }) },
    loadWebPayStatus: async () => ({ status: 'pending' })
  })
  failing.page.onLoad({ orderId: '31', kind: 'credit' })
  failing.page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(failing.page.data.failed, true)
  assert.match(failing.page.data.errorText, /已付款或已关闭/)

  const closing = loadPage({
    createWebPayLink: async () => ({ status: 'pending', url: LINK, order: { title: '积分包', amountFen: 100 } }),
    loadWebPayStatus: async () => ({ status: 'closed' })
  })
  closing.page.onLoad({ orderId: '31', kind: 'credit' })
  closing.page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  await closing.tick()
  assert.equal(closing.page.data.closed, true)
  assert.equal(closing.timers.size, 0)
})

test('waiting page: respects the payment switch before asking for a link', async () => {
  let asked = 0
  const { page, paymentSwitch } = loadPage({ createWebPayLink: async () => { asked += 1 }, loadWebPayStatus: async () => ({}) }, { enabled: false })
  page.onLoad({ orderId: '21', kind: 'membership' })
  page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(asked, 0)
  assert.deepEqual(paymentSwitch.closed, ['membership'])
})

test('waiting page is registered and styled like the other commerce pages', () => {
  const app = JSON.parse(read('app.json'))
  const commerce = app.subpackages.find((pkg) => pkg.root === 'commerce')
  assert.ok(commerce.pages.includes('web-pay/index'))
  assert.equal(JSON.parse(read('commerce/web-pay/index.json')).navigationStyle, 'custom')
  const wxml = read('commerce/web-pay/index.wxml')
  assert.match(wxml, /复制付款链接/)
  assert.match(wxml, /user-select="\{\{true\}\}"/)
  assert.match(read('commerce/web-pay/index.wxss'), /^@import "\.\.\/\.\.\/styles\/skeleton\.wxss";/)
})

test('waiting page: asks for a push, tells the user where the link went, and resends on request', async () => {
  const asked = []
  const replies = [
    { status: 'pending', url: LINK, order: { title: '积分包', amountFen: 100 }, push: 'not_following', mpName: '知鹿学习' },
    { status: 'pending', url: LINK, order: { title: '积分包', amountFen: 100 }, push: 'sent', mpName: '知鹿学习' }
  ]
  const { page } = loadPage({
    createWebPayLink: async (orderId, options) => { asked.push(JSON.parse(JSON.stringify(options))); return replies.shift() },
    loadWebPayStatus: async () => ({ status: 'pending' })
  })
  page.onLoad({ orderId: '31', kind: 'credit' })
  page.onShow()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.push, 'not_following')
  assert.equal(page.data.mpName, '知鹿学习')
  await page.resend()
  assert.deepEqual(asked, [{ push: true }, { push: true, resend: true }])
  assert.equal(page.data.push, 'sent')
  assert.equal(page.data.resending, false)
})

test('waiting page shows the push card only when the service account pushed or needs a follow', () => {
  const wxml = read('commerce/web-pay/index.wxml')
  assert.match(wxml, /push === 'sent'/)
  assert.match(wxml, /push === 'not_following'/)
  assert.match(wxml, /我已关注，重新发送/)
  assert.doesNotMatch(wxml, /微信里无法付款/)
})


test('payment tutorial comes first on every visit; acknowledging it does not change payment state', () => {
  const { page } = loadPage({})
  page.onLoad({ orderId: '31', kind: 'credit' })
  assert.equal(page.data.guideVisible, true)
  page.dismissGuide()
  assert.equal(page.data.guideVisible, false)
  assert.equal(page.data.paid, false)
  assert.equal(page.data.loaded, false)
  page.showGuide()
  assert.equal(page.data.guideVisible, true)
  assert.equal(loadPage({}).page.data.guideVisible, true)
})

test('payment received while reading the tutorial still completes without waiting for acknowledgement', async () => {
  const { page, tick } = loadPage({
    createWebPayLink: async () => ({ status: 'pending', url: LINK, push: 'sent', order: { title: '积分包', amountFen: 100 } }),
    loadWebPayStatus: async () => ({ status: 'paid' })
  })
  page.onLoad({ orderId: '31' })
  await page.prepare()
  await tick()
  assert.equal(page.data.guideVisible, true)
  assert.equal(page.data.paid, true)
})
