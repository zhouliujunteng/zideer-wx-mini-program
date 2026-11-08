const {
  loadCreditProduct,
  loadCurrentUser,
  createSecureCreditOrder,
  payWechatOrder,
  isWechatPaymentCancelled
} = require('../../services/identity')
const { priceText } = require('../../services/membership-view')
const { rpxToPx } = require('../../utils/screen')
const { goHomeAfterCreditPayment } = require('../payment-done')
const { checkPaymentPage, showPaymentClosed, isPaymentDisabled, leavePaymentPage } = require('../../services/payment-switch')
const { shouldPayOnWeb, openWebPay } = require('../../services/web-pay')

// 确认订单（PRD M30）：样式与积分包页一致（自定义顶栏、白色大圆角卡片、底部支付栏）。
// 付款成功直接回首页；取消支付才进订单状态页，在那里继续支付。
function priceView(product) {
  const saved = product.memberPriceApplied ? Number(product.amount) - Number(product.payableAmount) : 0
  return { price: priceText(product.payableAmount), listPrice: product.memberPriceApplied ? priceText(product.amount) : '', savedText: saved > 0 ? `-¥${priceText(saved)}` : '' }
}

Page({
  // 第一次读到商品和受益学生前显示骨架；读到过一次后回到页面保留旧内容静默刷新。
  data: { loaded: false, failed: false, submitting: false, product: null, beneficiary: null, prices: null,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80 },
  onLoad(options) {
    this.productVersionId = options.productVersionId || ''
    this.pendingOrder = null
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/commerce/products/index' })
  },
  onShow() { this.loadPage() },
  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    // 支付开关（2026-09-30 用户规则）：关着弹提示后离开本页
    const payment = await checkPaymentPage('credits')
    if (payment === 'closed') return
    if (payment === 'failed') {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: '网络不太稳定，请稍后再试。', icon: 'none' })
      return
    }
    try {
      const [product, currentUser] = await Promise.all([loadCreditProduct(this.productVersionId), loadCurrentUser()])
      if (!currentUser.profileCompleted || !currentUser.profile) throw new Error('请先完善学习档案后购买。')
      this.setData({ product, prices: priceView(product), beneficiary: { id: currentUser.profile.id, name: currentUser.profile.nickname || currentUser.profile.real_name || '当前学生' }, loaded: true })
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '订单信息加载失败', icon: 'none' })
    }
  },
  async createOrder() {
    if (this.data.submitting || !this.data.product || !this.data.beneficiary) return
    this.setData({ submitting: true })
    let createdOrder = null
    try {
      const order = this.pendingOrder || await createSecureCreditOrder(this.data.product.id, this.data.beneficiary.id)
      createdOrder = order
      this.pendingOrder = order
      // 安卓：到手机浏览器里付款，等待页换掉确认订单页（返回回到积分包）
      if (shouldPayOnWeb()) {
        this.pendingOrder = null
        openWebPay(order.orderId, 'credit', { redirect: true })
        return
      }
      await payWechatOrder({
        orderId: order.orderId,
        amount: order.amount,
        description: order.description || this.data.product.name
      })
      this.pendingOrder = null
      goHomeAfterCreditPayment()
    } catch (error) {
      if (isPaymentDisabled(error)) {
        showPaymentClosed('credits', leavePaymentPage)
      } else if (isWechatPaymentCancelled(error)) {
        wx.showToast({ title: '已取消支付，可在订单详情继续支付', icon: 'none' })
        if (createdOrder) {
          const query = `orderId=${encodeURIComponent(createdOrder.orderId)}&orderNo=${encodeURIComponent(createdOrder.orderNo)}&amount=${encodeURIComponent(createdOrder.amount)}`
          wx.redirectTo({ url: `/commerce/payment-result/index?${query}` })
        }
      } else {
        wx.showToast({ title: error.message || '订单创建或支付失败', icon: 'none' })
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
