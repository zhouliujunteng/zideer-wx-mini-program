const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

// services/mini-pay.js：按平台与课程服务的答复选付款方式（2026-11-11）
function load({ platform = 'android', plan, planError, statuses = ['paid'], virtual = 'ok', paymentOpen = true, guardians = [] } = {}) {
  const calls = { requests: [], merchant: 0, opened: [], virtual: [], logins: 0 }
  const module = { exports: {} }
  const wx = {
    getDeviceInfo: () => ({ platform }),
    login({ success }) { calls.logins++; success({ code: 'code-123456' }) },
    requestVirtualPayment(options) {
      calls.virtual.push(options)
      if (virtual === 'ok') options.success({})
      else if (virtual === 'cancel') options.fail({ errCode: -2, errMsg: 'requestVirtualPayment:fail cancel' })
      else options.fail({ errCode: -15001, errMsg: 'requestVirtualPayment:fail' })
    }
  }
  let statusIndex = 0
  const identity = {
    async requestCourseApi(url, options = {}) {
      calls.requests.push({ url, ...options })
      if (options.method === 'POST') {
        if (planError) throw planError
        return { statusCode: plan.statusCode || 200, data: plan.statusCode ? { success: false, code: plan.code } : { success: true, ...plan } }
      }
      const status = statuses[Math.min(statusIndex++, statuses.length - 1)]
      return { statusCode: 200, data: { success: true, status } }
    },
    async payWechatOrder() { calls.merchant++ }
  }
  // services/guardian-pay.js 读家庭关系：默认没有绑定家长
  require.cache[require.resolve('../services/identity')] = { id: 'identity-stub', filename: 'identity-stub', loaded: true, exports: { loadCurrentFamilyRelations: async () => ({ guardians }) } }
  delete require.cache[require.resolve('../services/guardian-pay')]
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/mini-pay.js'), 'utf8'), {
    module, wx, setTimeout: (fn) => fn(),
    require(name) {
      if (name.endsWith('/identity')) return identity
      if (name.endsWith('/guardian-pay')) return require('../services/guardian-pay')
      if (name.endsWith('/payment-switch')) return {
        async assertPaymentOpen() { if (!paymentOpen) throw Object.assign(new Error('closed'), { code: 'PAYMENT_DISABLED', paymentNotStarted: true }) }
      }
      throw new Error('unexpected ' + name)
    }
  })
  return { service: module.exports, calls }
}

const order = { orderId: '88', amount: '9800.00', description: '会员' }
const payment = { mode: 'short_series_goods', signData: '{"a":1}', paySig: 'p', signature: 's' }

test('android pays with virtual payment and confirms with the course service', async () => {
  const { service, calls } = load({ plan: { method: 'xpay', payment } })
  let started = 0
  assert.equal(await service.payOrder(order, 'membership', { onStart: () => started++ }), 'xpay')
  assert.equal(started, 1)
  assert.deepEqual(calls.virtual.map((v) => [v.mode, v.signData, v.paySig, v.signature]), [['short_series_goods', '{"a":1}', 'p', 's']])
  const post = calls.requests[0]
  assert.equal(post.url, '/api/learn/mini-pay')
  assert.deepEqual(JSON.parse(JSON.stringify(post.data)), { orderId: '88', platform: 'android', code: 'code-123456' })
  assert.equal(calls.requests[1].url, '/api/learn/mini-pay?orderId=88')
  assert.equal(calls.merchant, 0)
})

test('ios follows the plan: merchant when the switch says so', async () => {
  const { service, calls } = load({ platform: 'ios', plan: { method: 'merchant' } })
  assert.equal(await service.payOrder(order, 'membership'), 'merchant')
  assert.equal(calls.merchant, 1)
  assert.equal(calls.virtual.length, 0)
})

test('devtools and desktop skip the course service and use merchant pay', async () => {
  const { service, calls } = load({ platform: 'devtools' })
  assert.equal(await service.payOrder(order, 'credit'), 'merchant')
  assert.equal(calls.requests.length, 0)
  assert.equal(calls.logins, 0)
})

test('2026-11-13: no link payment in the mini program — an old course service answering link pays by merchant', async () => {
  const { service, calls } = load({ plan: { method: 'link' } })
  assert.equal(await service.payOrder(order, 'membership'), 'merchant')
  assert.equal(calls.merchant, 1)
  assert.equal(service.payByLink, undefined)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../services/mini-pay.js'), 'utf8'), /require\('\.\/web-pay'\)|用链接付款/)
})

test('course service unreachable: both platforms fall back to merchant pay', async () => {
  const down = new Error('network')
  for (const platform of ['android', 'ios']) {
    const { service, calls } = load({ platform, planError: down })
    assert.equal(await service.payOrder(order, 'membership'), 'merchant')
    assert.equal(calls.merchant, 1)
  }
})

test('definite refusals are shown, not bypassed', async () => {
  const { service, calls } = load({ plan: { statusCode: 409, code: 'ORDER_NOT_PENDING' } })
  await assert.rejects(service.payOrder(order, 'membership'), (error) => error.code === 'ORDER_NOT_PENDING' && error.paymentNotStarted === true)
  assert.equal(calls.opened.length, 0)
})

test('cancelling the virtual payment reads as a cancel', async () => {
  const { service } = load({ plan: { method: 'xpay', payment }, virtual: 'cancel' })
  await assert.rejects(service.payOrder(order, 'membership'), (error) => /cancel/.test(error.errMsg))
})

test('payment switch closed stops before anything', async () => {
  const { service, calls } = load({ plan: { method: 'xpay', payment }, paymentOpen: false })
  await assert.rejects(service.payOrder(order, 'membership'), (error) => error.code === 'PAYMENT_DISABLED')
  assert.equal(calls.requests.length, 0)
})

test('already paid orders are not charged again', async () => {
  const { service, calls } = load({ plan: { method: 'paid' } })
  assert.equal(await service.payOrder(order, 'membership'), 'paid')
  assert.equal(calls.virtual.length + calls.merchant + calls.opened.length, 0)
})

// 2026-11-12：iOS 实测没弹出付款框就失败，页面一直停在「正在确认支付结果」
test('a virtual payment that fails without paying is reported as not started, with the WeChat error code', async () => {
  const { service, calls } = load({ platform: 'ios', plan: { method: 'xpay', payment }, virtual: 'fail', statuses: ['pending'] })
  await assert.rejects(service.payOrder(order, 'membership'), (error) =>
    error.code === 'XPAY_FAILED' && error.paymentNotStarted === true && /-15001/.test(error.message))
  assert.equal(calls.requests.filter((r) => r.url === '/api/learn/mini-pay?orderId=88').length, 1)
})
test('a failed callback whose order turns out paid still counts as paid', async () => {
  const { service } = load({ plan: { method: 'xpay', payment }, virtual: 'fail', statuses: ['paid'] })
  assert.equal(await service.payOrder(order, 'membership'), 'xpay')
})

test('a child bound to a guardian cannot pay: nothing is requested and the error says the guardian pays', async () => {
  const { service, calls } = load({ plan: { method: 'xpay', payment }, guardians: [{ id: 1 }] })
  await assert.rejects(() => service.payOrder(order, 'membership'), (error) => error.code === 'GUARDIAN_PAYS' && error.paymentNotStarted === true && /家长/.test(error.message))
  assert.equal(calls.requests.length, 0)
  assert.equal(calls.virtual.length, 0)
  assert.equal(calls.merchant, 0)
})
