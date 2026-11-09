const config = require('../config/index')

// 支付开关（2026-09-30 用户规则）：后端 growth_campaign 表 payment_switch 一行，
// 管理端「市场运营 → 活动开关 → 会员与积分包支付」里开关。
// 关着时：会员中心、积分包、继续支付这些入口**直接不显示**（页面 onShow 调 attachPaymentSwitch，模板按 paymentOpen 显示）；
// 按路径直接打开会员中心、积分包等页面（审核能这样打开 app.json 里的任何页面）弹「会员功能准备中，敬请期待。」后退出；
// 后端「创建当前会员等级订单」「创建安全课程积分订单」同样拒绝下单（PAYMENT_DISABLED），发起微信支付前也再核一次。
// 入口点击时仍会再核一次开关（openPaymentPage）：只在刚关掉、页面还没刷新的一瞬间兜底弹提示。
//
// 开关由动作流「读取支付开关」以游客身份读（对游客、已登录用户开放，只返回开 / 关）。
// 读到的结果记在本机，页面先按上次的结果显示入口，再现读刷新；从没读到过就先按关着处理（入口不显示）。
// 读不到开关时不猜：入口保持上次的结果，页面显示读取失败，既不放出支付界面，也不误报「准备中」。

const MESSAGES = {
  membership: '会员功能准备中，敬请期待。',
  credits: '积分包购买准备中，敬请期待。'
}
const NETWORK_MESSAGE = '网络不太稳定，请稍后再试。'
// 入口刚读过的结果在这段时间内直接用，进页面时不再等一次网络
const FRESH_MS = 60 * 1000
const STORAGE_KEY = 'payment_switch_v1'

let cached = null
let inFlight = null
let opening = false

function flowId() {
  const flow = config.ACTION_FLOWS && config.ACTION_FLOWS.GET_PAYMENT_SWITCH
  return flow && flow.id ? String(flow.id) : ''
}

function parseResult(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (error) { return null }
}

function requestSwitch(id) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.GRAPHQL_URL,
      method: 'POST',
      // 不带登录凭证：游客和已登录用户读到的是同一个开关，也不会因为凭证过期读不到
      header: { 'content-type': 'application/json' },
      data: {
        query: `mutation ReadPaymentSwitch($args: Json!) { result: fz_invoke_action_flow_default_by_latest_version(actionFlowId: "${id}", args: $args) }`,
        variables: { args: { payload: {} } }
      },
      timeout: 8000,
      success(response) {
        const body = response && response.data
        const result = body && !(body.errors && body.errors.length) && body.data ? parseResult(body.data.result) : null
        if (response.statusCode !== 200 || !result || typeof result.paymentEnabled !== 'boolean') {
          reject(new Error(NETWORK_MESSAGE))
          return
        }
        resolve(result.paymentEnabled)
      },
      fail() { reject(new Error(NETWORK_MESSAGE)) }
    })
  })
}

// 读开关：true 开着、false 关着；读不到时抛错（消息可直接给用户看）。
// maxAgeMs 内读过就直接用上次的结果；并发调用共用同一个请求。
async function loadPaymentSwitch({ maxAgeMs = FRESH_MS } = {}) {
  const id = flowId()
  // 「读取支付开关」还没上线（config 里没有编号）：按开着处理，保持上线前的行为；后端下单仍会把关
  if (!id) return true
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.enabled
  if (!inFlight) {
    inFlight = requestSwitch(id).then((enabled) => {
      cached = { enabled, at: Date.now() }
      try { wx.setStorageSync(STORAGE_KEY, { enabled }) } catch (error) {}
      return enabled
    }).finally(() => { inFlight = null })
  }
  return inFlight
}

// 手头最近一次的结果（不发请求）：本次启动读到的 → 本机记住的 → 从没读到过按关着。
function knownPaymentOpen() {
  if (!flowId()) return true
  if (cached) return cached.enabled
  try {
    const stored = wx.getStorageSync(STORAGE_KEY)
    if (stored && typeof stored.enabled === 'boolean') return stored.enabled
  } catch (error) {}
  return false
}

// 有会员中心、积分包入口的页面在 onShow 里调：先按手头的结果设 paymentOpen，再现读一次（一分钟内复用），变了就刷新。
// 读不到时保留手头的结果。
function attachPaymentSwitch(page) {
  const apply = (open) => {
    if (page && page.data && page.data.paymentOpen !== open) page.setData({ paymentOpen: open })
  }
  apply(knownPaymentOpen())
  return loadPaymentSwitch().then(apply, () => {})
}

function paymentClosedMessage(kind) {
  return MESSAGES[kind] || MESSAGES.membership
}

function showPaymentClosed(kind, onClose) {
  wx.showModal({
    title: '',
    content: paymentClosedMessage(kind),
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#FD7C02',
    complete: () => { if (typeof onClose === 'function') onClose() }
  })
}

function isPaymentDisabled(error) {
  return !!error && (error.code === 'PAYMENT_DISABLED' || /PAYMENT_DISABLED/.test(String(error.message || '')))
}

// 入口点击：开着返回 true；关着弹提示、读不到给轻提示，都返回 false。
// 没有新鲜结果时显示加载遮罩，避免连点。
async function confirmPaymentOpen(kind = 'membership') {
  const fresh = cached && Date.now() - cached.at < FRESH_MS
  if (!fresh && flowId()) wx.showLoading({ title: '请稍候', mask: true })
  let enabled
  try {
    enabled = await loadPaymentSwitch()
  } catch (error) {
    if (!fresh && flowId()) wx.hideLoading()
    wx.showToast({ title: error.message || NETWORK_MESSAGE, icon: 'none' })
    return false
  }
  if (!fresh && flowId()) wx.hideLoading()
  if (!enabled) showPaymentClosed(kind)
  return enabled
}

// 打开会员中心、积分包等支付页面：关着就只弹提示，不进页面。
async function openPaymentPage(url, kind = 'membership', { redirect = false } = {}) {
  if (opening) return false
  opening = true
  try {
    if (!(await confirmPaymentOpen(kind))) return false
    if (redirect) wx.redirectTo({ url })
    else wx.navigateTo({ url })
    return true
  } finally {
    opening = false
  }
}

// 支付页面自己在 onShow 里调：关着弹提示后离开本页（返回上一页；没有上一页回「我的」），返回 'closed'；
// 开着返回 'open'；读不到返回 'failed'（页面自己显示读取失败与重试）。
async function checkPaymentPage(kind = 'membership') {
  let enabled
  try {
    enabled = await loadPaymentSwitch()
  } catch (error) {
    return 'failed'
  }
  if (enabled) return 'open'
  showPaymentClosed(kind, leavePaymentPage)
  return 'closed'
}

function leavePaymentPage() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (pages.length > 1) wx.navigateBack({ delta: 1 })
  else wx.switchTab({ url: '/pages/me/index' })
}

// 发起微信支付前再核一次（待支付订单「继续支付」不经过下单流程）：关着或读不到都不发起支付。
async function assertPaymentOpen() {
  let enabled
  try {
    enabled = await loadPaymentSwitch({ maxAgeMs: 0 })
  } catch (error) {
    throw Object.assign(new Error(error.message || NETWORK_MESSAGE), { paymentNotStarted: true })
  }
  if (!enabled) throw Object.assign(new Error('支付功能准备中，敬请期待。'), { code: 'PAYMENT_DISABLED', paymentNotStarted: true })
}

function resetPaymentSwitchCache() {
  cached = null
  inFlight = null
  opening = false
}

module.exports = {
  loadPaymentSwitch,
  knownPaymentOpen,
  attachPaymentSwitch,
  paymentClosedMessage,
  showPaymentClosed,
  isPaymentDisabled,
  confirmPaymentOpen,
  openPaymentPage,
  checkPaymentPage,
  leavePaymentPage,
  assertPaymentOpen,
  resetPaymentSwitchCache
}
