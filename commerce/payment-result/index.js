const { loadOrderDetail, payWechatOrder, isWechatPaymentCancelled } = require('../../services/identity')
const { openPaymentPage, showPaymentClosed, isPaymentDisabled, attachPaymentSwitch } = require('../../services/payment-switch')
const { rpxToPx } = require('../../utils/screen')
const { goHomeAfterCreditPayment } = require('../payment-done')
const { shouldPayOnWeb, openWebPay } = require('../../services/web-pay')

// 订单状态：积分包取消支付（或支付结果没确认）时从确认订单页转到这里，可继续支付；付款成功直接回首页。
// 没有订单号的旧链接读不到订单，按「待支付」显示但不给继续支付。
function resultView(order) {
  if (order && order.status === '已支付') return { kind: 'paid', title: '支付已完成', subtitle: '课程积分已发放到账户。' }
  if (!order || order.status === '待支付') return { kind: 'pending', title: '订单待支付', subtitle: '订单已保留，可以继续支付；如已付款，请稍等几秒。' }
  return { kind: 'closed', title: `订单${order.statusLabel || order.status}`, subtitle: '这笔订单不能继续支付，可以回到积分包重新购买。' }
}

Page({
  // 第一次读到订单前，状态和订单信息位显示骨架；读到过一次后（回到本页）保留旧内容静默刷新。
  // paymentOpen：支付开关关着时不给「重新购买」「继续支付」，只留「返回首页」
  data: { orderId: '', orderNo: '', amount: '', loaded: false, failed: false, paying: false, order: null, view: resultView(null), paymentOpen: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },
  onLoad(options) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      orderId: options.orderId || '', orderNo: options.orderNo || '', amount: options.amount || '',
      statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375)
    })
  },
  onShow() {
    attachPaymentSwitch(this)
    this.loadPage()
  },
  async loadPage() {
    if (!this.data.orderId) {
      this.setData({ loaded: true, view: resultView(null) })
      return
    }
    if (!this.data.loaded) this.setData({ failed: false })
    try {
      const order = await loadOrderDetail(this.data.orderId)
      this.setData({ order, view: resultView(order), orderNo: order.order_no || this.data.orderNo, amount: order.amountDisplay || this.data.amount, loaded: true })
    } catch (error) {
      // 首次读取失败时显示重试，不把「待支付」当成真实状态展示。
      if (!this.data.loaded) this.setData({ failed: true })
    }
  },
  async continuePayment() {
    const order = this.data.order
    if (this.data.paying || !order || order.status !== '待支付') return
    // 安卓：到手机浏览器里付款（services/web-pay.js）
    if (shouldPayOnWeb()) return openWebPay(order.id, 'credit')

    this.setData({ paying: true })
    try {
      await payWechatOrder({
        orderId: order.id,
        amount: order.amount,
        description: order.title || '知鹿学习课程积分'
      })
      goHomeAfterCreditPayment()
    } catch (error) {
      if (isPaymentDisabled(error)) {
        showPaymentClosed('credits')
      } else if (isWechatPaymentCancelled(error)) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        wx.showToast({ title: error.message || '暂时无法发起支付', icon: 'none' })
      }
    } finally {
      this.setData({ paying: false })
    }
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    this.goHome()
  },
  goHome() { wx.switchTab({ url: '/pages/home/index' }) },
  // 2026-11-10 起没有积分包，「重新购买」去会员中心
  goProducts() { return openPaymentPage('/commerce/membership/index', 'membership', { redirect: true }) },
  goOrder() {
    if (!this.data.orderId) return
    wx.redirectTo({ url: `/commerce/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}` })
  }
})
