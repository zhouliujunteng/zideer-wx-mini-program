const { loadPurchaseEligibility } = require('../../services/identity')
const { openPaymentPage, attachPaymentSwitch } = require('../../services/payment-switch')

Page({
  // 第一次读到资格前显示骨架；读到过一次后回到页面保留旧结果，后台静默刷新。
  // paymentOpen：支付开关关着时不显示「进入课程积分商城」
  data: { loaded: false, failed: false, eligibility: null, paymentOpen: false },
  onShow() {
    attachPaymentSwitch(this)
    this.loadPage()
  },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    try {
      this.setData({ eligibility: await loadPurchaseEligibility(), loaded: true })
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '购买资格加载失败', icon: 'none' })
    }
  },
  goProducts() { return openPaymentPage('/commerce/products/index', 'credits') },
  openAssignmentRequest() { wx.navigateTo({ url: '/commerce/assignment-request/index' }) }
})
