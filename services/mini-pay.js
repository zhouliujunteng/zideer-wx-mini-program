// 小程序付款方式（2026-11-11 用户规则：微信要求虚拟商品走虚拟支付）。
//   安卓   → 微信虚拟支付（wx.requestVirtualPayment）；课程服务没配好虚拟支付时退回链接付款。
//   iOS    → 管理端「活动开关 → 小程序付款方式」选：虚拟支付 / 商户号支付（wx.requestPayment，Zion 自带支付），默认商户号。
//   其他（开发者工具、电脑版微信）→ 商户号支付。
//   付款处另有「用链接付款」（services/web-pay.js，zideer.cn/pay），任何手机都能用。
// 选哪种由课程服务 /api/learn/mini-pay 现判（lib/mini-pay/service.ts），每次付款前都问一次，后台一改立即生效。
// 虚拟支付到账靠微信发货推送 → 课程服务 → Zion「网页付款记账」登记发货；付完这里再问几次，顺带让课程服务查单补登记。
const { requestCourseApi, payWechatOrder } = require('./identity')
const { openWebPay } = require('./web-pay')
const { assertPaymentOpen } = require('./payment-switch')

const PATH = '/api/learn/mini-pay'
const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录后再付款。',
  LOGIN_CODE_INVALID: '微信登录状态已变化，请再点一次付款。',
  ORDER_INVALID: '订单信息不完整，请返回重新下单。',
  ORDER_NOT_FOUND: '没有找到这笔订单，请返回重新下单。',
  ORDER_NOT_PENDING: '这笔订单已付款或已关闭，请到订单记录查看。',
  ORDER_NOT_PAYABLE: '这笔订单暂时不能付款，请联系客服。',
  PAYMENT_DISABLED: '支付功能准备中，敬请期待。',
  TRY_LATER: '付款服务有点忙，请稍后再试。',
  PAY_UNAVAILABLE: '付款服务暂时不可用，请稍后再试。'
}
// 这些是课程服务明确的答复（订单不能付等），照实告诉用户；其余（网络不通、服务出错）按平台兜底
const DEFINITE = ['LOGIN_REQUIRED', 'LOGIN_CODE_INVALID', 'ORDER_INVALID', 'ORDER_NOT_FOUND', 'ORDER_NOT_PENDING', 'ORDER_NOT_PAYABLE', 'PAYMENT_DISABLED']

function platform() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
    const value = String(info && info.platform || '').toLowerCase()
    return value === 'android' || value === 'ios' ? value : 'other'
  } catch (error) {
    return 'other'
  }
}

function payError(code) {
  const error = new Error(MESSAGES[code] || MESSAGES.PAY_UNAVAILABLE)
  error.code = code || 'PAY_UNAVAILABLE'
  error.paymentNotStarted = true
  return error
}

function loginCode() {
  return new Promise((resolve, reject) => wx.login({
    success: (res) => (res && res.code ? resolve(res.code) : reject(payError('LOGIN_CODE_INVALID'))),
    fail: () => reject(payError('LOGIN_CODE_INVALID'))
  }))
}

async function planPayment(orderId, plat) {
  // 只有虚拟支付要用户态签名；商户号支付不必调 wx.login，但先拿着也不影响（code 五分钟内有效、只用一次）
  const code = plat === 'other' ? '' : await loginCode()
  const response = await requestCourseApi(PATH, { method: 'POST', data: { orderId: String(orderId), platform: plat, code } })
  const data = response && response.data
  if (response.statusCode !== 200 || !data || data.success !== true) throw payError(data && data.code)
  return data
}

function requestVirtualPayment(payment) {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestVirtualPayment !== 'function') {
      reject(Object.assign(new Error('当前微信版本不支持这种付款方式，请升级微信或用链接付款。'), { paymentNotStarted: true }))
      return
    }
    wx.requestVirtualPayment({
      mode: payment.mode,
      signData: payment.signData,
      paySig: payment.paySig,
      signature: payment.signature,
      success: resolve,
      fail(error) {
        // 用户取消（errCode -2）统一成 errMsg 带 cancel，页面按「已取消支付」处理
        if (error && (error.errCode === -2 || /cancel/i.test(error.errMsg || ''))) {
          reject({ errMsg: 'requestVirtualPayment:fail cancel', errCode: -2 })
          return
        }
        // 没弹出付款框就失败（2026-11-12 iOS 实测）：把微信给的错误码带给用户，方便对照微信文档查原因
        const code = error && (error.errCode !== undefined ? error.errCode : '')
        const text = code !== '' ? `付款没有完成（微信返回 ${code}），可以再试一次或用链接付款。` : '付款没有完成，可以再试一次或用链接付款。'
        reject(Object.assign(new Error(text), { code: 'XPAY_FAILED', xpayErrCode: code, detail: error }))
      }
    })
  })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 虚拟支付付完：问几次课程服务（它会查单、补登记），一般推送已经先到了。问不到也不报错，页面自己会刷新会员状态。
async function confirmPaid(orderId, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await requestCourseApi(`${PATH}?orderId=${encodeURIComponent(String(orderId))}`)
      if (response.statusCode === 200 && response.data && response.data.status === 'paid') return true
    } catch (error) { /* 网络不稳：交给页面刷新 */ }
    if (i < tries - 1) await wait(1500)
  }
  return false
}

// 付一笔待支付订单。order: { orderId, amount, description }；kind: membership | credit（链接付款付完回哪）。
// onStart：真正调起微信付款前调用（会员中心借它记下「等待确认」的订单）。
// 返回 'merchant' | 'xpay'（在小程序里付完）、'web'（打开了链接付款等待页）、'paid'（这单之前已付过）。
async function payOrder(order, kind, { onStart } = {}) {
  await assertPaymentOpen()
  const plat = platform()
  let plan
  try {
    plan = plat === 'other' ? { method: 'merchant' } : await planPayment(order.orderId, plat)
  } catch (error) {
    if (DEFINITE.indexOf(error.code) >= 0) throw error
    // 课程服务不通：iOS 照旧商户号支付（与上线前一样）；安卓去链接付款
    plan = { method: plat === 'ios' ? 'merchant' : 'link' }
  }
  if (plan.method === 'paid') return 'paid'
  if (plan.method === 'link') {
    openWebPay(order.orderId, kind)
    return 'web'
  }
  if (typeof onStart === 'function') onStart()
  if (plan.method === 'xpay') {
    try {
      await requestVirtualPayment(plan.payment)
    } catch (error) {
      if (error && error.code === 'XPAY_FAILED') {
        // 微信明确说付款失败：再问一次课程服务（极少数情况下钱已扣、回调先到）；没付就当没开始付款，
        // 页面据此清掉「等待确认」，不会一直停在「正在确认支付结果」（2026-11-12 修复）。
        if (await confirmPaid(order.orderId, 1)) return 'xpay'
        error.paymentNotStarted = true
      }
      throw error
    }
    await confirmPaid(order.orderId)
    return 'xpay'
  }
  await payWechatOrder(order)
  return 'merchant'
}

// 「用链接付款」：任何平台都能用，打开付款链接等待页（services/web-pay.js）。
async function payByLink(orderId, kind, options) {
  await assertPaymentOpen()
  return openWebPay(orderId, kind, options)
}

module.exports = { payOrder, payByLink, platform }
