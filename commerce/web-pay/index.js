const { attachUiAssets } = require('../../services/ui-assets')
const { createWebPayLink, loadWebPayStatus } = require('../../services/web-pay')
const { checkPaymentPage } = require('../../services/payment-switch')
const { rpxToPx } = require('../../utils/screen')
const { goHomeAfterCreditPayment } = require('../payment-done')

// 安卓网页付款等待页（services/web-pay.js）：换付款链接并由服务号推给用户（没关注就让用户复制链接）
// → 用户在微信里点开付款 → 这里每 3 秒问一次，付好了显示已到账。
// 页面在后台（用户切去浏览器）时停止询问，回到本页马上再问并接着等；最多等 10 分钟，之后给「刷新付款结果」。
const POLL_MS = 3000
const POLL_LIMIT = 200

function orderView(order) {
  if (!order) return null
  const fen = Number(order.amountFen)
  return { title: order.title || '', amount: Number.isFinite(fen) ? (fen / 100).toFixed(2) : '', accountHint: order.accountHint || '' }
}

Page({
  // 第一次换到链接前，金额与链接位显示骨架；固定的步骤说明直接显示。
  data: { guideVisible: true, orderId: '', kind: 'credit', loaded: false, failed: false, errorText: '', order: null, link: '',
    paid: false, closed: false, slow: false, copied: false, checking: false, push: '', mpName: '', resending: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },
  onLoad(options) {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      orderId: /^[1-9][0-9]*$/.test(String(options.orderId || '')) ? String(options.orderId) : '',
      kind: options.kind === 'membership' ? 'membership' : 'credit',
      statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375)
    })
  },
  onShow() {
    if (!this.started) {
      this.started = true
      this.prepare()
    } else if (this.data.link && !this.data.paid && !this.data.closed) {
      this.startPolling()
    }
  },
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },

  async prepare() {
    if (!this.data.orderId) return this.setData({ failed: true, errorText: '订单信息不完整，请返回重新下单。' })
    this.setData({ failed: false })
    const state = await checkPaymentPage(this.data.kind === 'membership' ? 'membership' : 'credits')
    if (state === 'closed') return
    if (state === 'failed') return this.setData({ failed: true, errorText: '网络不太稳定，请稍后再试。' })
    try {
      const result = await createWebPayLink(this.data.orderId, { push: true })
      if (result.status === 'paid') return this.setData({ loaded: true, paid: true, order: orderView(result.order) })
      this.setData({ loaded: true, link: result.url, order: orderView(result.order), push: result.push || '', mpName: result.mpName || '' })
      this.startPolling()
    } catch (error) {
      this.setData({ failed: true, errorText: error.message || '暂时无法获取付款链接，请稍后再试。' })
    }
  },

  startPolling() {
    this.stopPolling()
    this.attempts = 0
    this.setData({ slow: false })
    this.timer = setTimeout(() => this.poll(), 0)
  },
  stopPolling() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  },
  async poll() {
    this.timer = null
    try {
      const order = await loadWebPayStatus(this.data.orderId)
      if (order.status === 'paid') return this.setData({ paid: true, checking: false })
      if (order.status !== 'pending') return this.setData({ closed: true, checking: false })
    } catch (error) {
      // 偶尔读不到不打断等待，下一轮再问
    }
    this.setData({ checking: false })
    this.attempts = (this.attempts || 0) + 1
    if (this.attempts >= POLL_LIMIT) return this.setData({ slow: true })
    this.timer = setTimeout(() => this.poll(), POLL_MS)
  },
  checkNow() {
    if (this.data.checking || this.data.paid) return
    this.setData({ checking: true })
    this.startPolling()
  },

  // 「没收到？重新发送」「我已关注，重新发送」
  async resend() {
    if (this.data.resending || !this.data.link) return
    this.setData({ resending: true })
    try {
      const result = await createWebPayLink(this.data.orderId, { push: true, resend: true })
      if (result.status === 'paid') return this.setData({ paid: true })
      const push = result.push || ''
      const tips = { sent: '已重新发送', not_following: '还没查到你的关注，请关注后再试', throttled: '刚发过，请稍等一会儿再试' }
      wx.showToast({ title: tips[push] || '暂时发送不了，请复制链接付款', icon: push === 'sent' ? 'success' : 'none' })
      if (push === 'sent' || push === 'not_following') this.setData({ push })
    } catch (error) {
      wx.showToast({ title: error.message || '暂时发送不了，请复制链接付款', icon: 'none' })
    } finally {
      this.setData({ resending: false })
    }
  },

  // 每次进入先看教程；只切换说明视图，不改变订单或付款状态。
  dismissGuide() { this.setData({ guideVisible: false }) },
  showGuide() { this.setData({ guideVisible: true }) },

  copyLink() {
    if (!this.data.link) return
    wx.setClipboardData({
      data: this.data.link,
      success: () => {
        this.setData({ copied: true })
        wx.showToast({ title: '链接已复制', icon: 'success' })
      },
      fail: () => wx.showToast({ title: '复制失败，请长按链接手动复制', icon: 'none' })
    })
  },
  finish() {
    if (this.data.kind === 'credit') return goHomeAfterCreditPayment()
    // 会员：回到会员中心（它在 onShow 里重新读取，直接显示已开通）
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/home/index' })
  }
})
