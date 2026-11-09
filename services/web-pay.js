// 安卓网页付款（2026-09-30 用户要求：安卓选好商品后，到手机浏览器里付这笔订单，不在小程序里调起支付）。
// 订单照常在小程序里建（会员中心 / 确认订单），之后：
//   课程服务 /api/learn/web-pay 换付款链接（zideer.cn/pay/?t=…，24 小时有效），同时由服务号把链接推给用户
//   （2026-10-03：「订单创建成功通知」模板消息，点开在微信里用公众号支付）；没关注服务号就让用户复制链接
//   发到「文件传输助手」点开，或粘贴到手机浏览器 → 等待页每 3 秒问一次课程服务，付好了就显示已到账。
// 服务端：OpenMAIC-sync lib/web-pay/service.ts（微信 H5 支付）+ Zion「网页付款记账」（登记到账并发货）。
// iOS 与开发者工具照旧走小程序内支付（wx.requestPayment）。
const { requestCourseApi } = require('./identity')

const PATH = '/api/learn/web-pay'

// 服务端错误码 → 给用户看的话
const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录后再付款。',
  PROFILE_REQUIRED: '请先完成学习资料，再来付款。',
  ORDER_INVALID: '订单信息不完整，请返回重新下单。',
  ORDER_NOT_FOUND: '没有找到这笔订单，请返回重新下单。',
  ORDER_NOT_PENDING: '这笔订单已付款或已关闭，请到订单记录查看。',
  ORDER_NOT_PAYABLE: '这笔订单暂时不能付款，请联系客服。',
  MEMBERSHIP_TIER_NOT_HIGHER: '你已开通同级或更高等级的会员，无需再付款。',
  PAYMENT_DISABLED: '会员与积分包功能准备中，敬请期待。',
  PAY_UNAVAILABLE: '付款服务暂时不可用，请稍后再试。',
  TRY_LATER: '操作太频繁了，请稍后再试。'
}

function webPayError(response) {
  const code = response && response.data && response.data.code || ''
  const error = new Error(MESSAGES[code] || MESSAGES.PAY_UNAVAILABLE)
  error.code = code || 'PAY_UNAVAILABLE'
  return error
}

// 安卓手机走网页付款。读不到平台（旧基础库、测试环境）一律按「不是安卓」处理，照旧小程序内支付。
function shouldPayOnWeb() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
    return !!info && String(info.platform || '').toLowerCase() === 'android'
  } catch (error) {
    return false
  }
}

// 为本人一笔待支付订单换付款链接：{ status: 'pending' | 'paid', url, expiresAt, order, push, mpName }
// push：让服务号把链接推给本人；resend：用户点了「我已关注，重新发送」。
// 回包 push：sent 已推送 / not_following 没关注服务号 / no_unionid、unavailable、throttled、skipped 没推。
async function createWebPayLink(orderId, { push = false, resend = false } = {}) {
  const response = await requestCourseApi(PATH, { method: 'POST', data: { orderId: String(orderId), push, resend } })
  if (response.statusCode !== 200 || !response.data || response.data.success !== true) throw webPayError(response)
  const data = response.data
  if (data.status === 'pending' && !/^https:\/\/[^\s]+\?t=[1-9][0-9]*\.[0-9]{10}\.[A-Za-z0-9_-]{43}$/.test(String(data.url || ''))) {
    throw new Error(MESSAGES.PAY_UNAVAILABLE)
  }
  return data
}

// 订单现在的状态（课程服务顺带向微信查单）：{ order: { status: 'pending' | 'paid' | 'closed' | 'refunded', … } }
async function loadWebPayStatus(orderId) {
  const response = await requestCourseApi(`${PATH}?orderId=${encodeURIComponent(String(orderId))}`)
  if (response.statusCode !== 200 || !response.data || response.data.success !== true || !response.data.order) throw webPayError(response)
  return response.data.order
}

// 打开网页付款等待页。kind：membership | credit（付好后回会员中心 / 首页）。
function openWebPay(orderId, kind, { redirect = false } = {}) {
  const url = `/commerce/web-pay/index?orderId=${encodeURIComponent(String(orderId))}&kind=${kind === 'membership' ? 'membership' : 'credit'}`
  return redirect ? wx.redirectTo({ url }) : wx.navigateTo({ url })
}

module.exports = {
  shouldPayOnWeb,
  createWebPayLink,
  loadWebPayStatus,
  openWebPay
}
