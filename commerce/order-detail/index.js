const { loadOrderDetail, payWechatOrder, isWechatPaymentCancelled } = require('../../services/identity')
const { openPaymentPage, showPaymentClosed, isPaymentDisabled, attachPaymentSwitch } = require('../../services/payment-switch')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx } = require('../../utils/screen')
const { orderDetailView } = require('../order-view')
const { goHomeAfterCreditPayment } = require('../payment-done')
const { shouldPayOnWeb, openWebPay } = require('../../services/web-pay')

// 订单详情：设计仓库没有这一页，按课程积分页（M34）与积分包、确认订单那一系重做——
// 顶部概览（订单名、金额大字、状态标签、右侧积分星 / 会员皇冠插画）、小节标题 + 白色大圆角行卡片。
// 底部按钮只在有事可做时出现：待支付的积分包「继续支付」（付款成功回首页），会员订单「查看会员中心」。
Page({
  // 第一次读到订单前显示骨架；读到过一次后回到页面保留旧内容静默刷新。
  // paymentOpen：支付开关关着时底部按钮（继续支付、查看会员中心）都不显示
  data: { loaded: false, failed: false, paying: false, order: null, view: null, paymentOpen: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },
  onLoad(options) {
    attachUiAssets(this)
    this.orderId = options.orderId || ''
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() {
    attachPaymentSwitch(this)
    this.loadPage()
  },
  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    try {
      const order = await loadOrderDetail(this.orderId)
      this.setData({ order, view: orderDetailView(order), loaded: true })
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      else wx.showToast({ title: error.message || '订单详情刷新失败', icon: 'none' })
    }
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/commerce/orders/index' })
  },
  copyOrderNo() {
    const orderNo = this.data.order && this.data.order.order_no
    if (!orderNo) return
    wx.setClipboardData({ data: orderNo, success: () => wx.showToast({ title: '订单编号已复制', icon: 'none' }) })
  },
  handleAction() {
    const action = this.data.view && this.data.view.action
    if (!action) return
    if (action.id === 'membership') return openPaymentPage('/commerce/membership/index', 'membership')
    if (action.id === 'pay') return this.continuePayment()
  },
  async continuePayment() {
    const order = this.data.order
    if (this.data.paying || !order || order.status !== '待支付') return
    // 安卓：到手机浏览器里付款（services/web-pay.js）
    if (shouldPayOnWeb()) return openWebPay(order.id, 'credit')
    this.setData({ paying: true })
    try {
      await payWechatOrder({ orderId: order.id, amount: order.amount, description: order.title || '知鹿学习课程积分' })
      goHomeAfterCreditPayment()
    } catch (error) {
      // 支付开关关着：待支付订单也不能继续付款
      if (isPaymentDisabled(error)) showPaymentClosed('credits')
      else wx.showToast({ title: isWechatPaymentCancelled(error) ? '已取消支付' : (error.message || '暂时无法发起支付'), icon: 'none' })
    } finally {
      this.setData({ paying: false })
    }
  }
})
