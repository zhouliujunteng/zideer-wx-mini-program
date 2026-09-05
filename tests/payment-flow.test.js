const assert = require('node:assert/strict')
const test = require('node:test')
const config = require('../config/index')

const requests = []
let paymentOptions = null

global.wx = {
  getStorageSync(key) {
    return key === 'zion_runtime_token' ? 'test-runtime-token' : ''
  },
  request(options) {
    requests.push(options)
    if (String(options.data && options.data.query).includes(config.ACTION_FLOWS.CREATE_WECHAT_PAYMENT_TEST_ORDER.id)) {
      options.success({
        statusCode: 200,
        data: { data: { result: { orderId: 43, amount: '0.01', description: '微信支付测试订单' } } }
      })
      return
    }
    options.success({
      statusCode: 200,
      data: {
        data: {
          createWechatPayment: {
            status: 'SUCCESS',
            message: JSON.stringify({
              timeStamp: '123',
              nonceStr: 'nonce',
              package: 'prepay_id=mock',
              signType: 'RSA',
              paySign: 'signature'
            })
          }
        }
      }
    })
  },
  requestPayment(options) {
    paymentOptions = options
    options.success({ errMsg: 'requestPayment:ok' })
  }
}

const { payWechatOrder, startWechatPaymentTest, isWechatPaymentCancelled } = require('../services/identity')

test('payWechatOrder uses server-provided order details and invokes WeChat payment', async () => {
  const result = await payWechatOrder({ orderId: 42, amount: '19.90', description: '课程积分包' })

  assert.deepEqual(result, { orderId: 42 })
  assert.equal(requests.length, 1)
  assert.match(requests[0].data.query, /createWechatPayment/)
  assert.deepEqual(requests[0].data.variables, { orderId: 42, description: '课程积分包', amount: 19.9 })
  assert.equal(paymentOptions.package, 'prepay_id=mock')
})

test('payWechatOrder rejects incomplete order data before any network request', async () => {
  await assert.rejects(payWechatOrder({ orderId: 0, amount: 0, description: '' }), /支付信息不完整/)
  assert.equal(requests.length, 1)
})

test('startWechatPaymentTest creates its test order on the server before asking WeChat to pay', async () => {
  const before = requests.length
  const result = await startWechatPaymentTest()

  assert.deepEqual(result, { orderId: 43 })
  assert.equal(requests.length, before + 2)
  assert.match(requests[before].data.query, /fz_invoke_action_flow_default_by_latest_version/)
  assert.match(requests[before].data.query, new RegExp(config.ACTION_FLOWS.CREATE_WECHAT_PAYMENT_TEST_ORDER.id))
  assert.match(requests[before + 1].data.query, /createWechatPayment/)
  assert.deepEqual(requests[before + 1].data.variables, {
    orderId: 43, description: '微信支付测试订单', amount: 0.01
  })
})

test('isWechatPaymentCancelled recognizes WeChat cancellation responses', () => {
  assert.equal(isWechatPaymentCancelled({ errMsg: 'requestPayment:fail cancel' }), true)
  assert.equal(isWechatPaymentCancelled(new Error('network error')), false)
})
