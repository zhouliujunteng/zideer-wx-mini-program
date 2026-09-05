const { loadOrderDetail, payWechatOrder, isWechatPaymentCancelled } = require('../../services/identity')

Page({
  data: { orderId: '', orderNo: '', amount: '', loading: true, failed: false, paying: false, order: null },
  onLoad(options) {
    this.setData({ orderId: options.orderId || '', orderNo: options.orderNo || '', amount: options.amount || '' })
  },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    if (!this.data.orderId) {
      this.setData({ loading: false })
      return
    }
    this.setData({ loading: true, failed: false })
    try {
      const order = await loadOrderDetail(this.data.orderId)
      this.setData({ order, orderNo: order.order_no || this.data.orderNo, amount: order.amountDisplay || this.data.amount })
    } catch (error) {
      this.setData({ failed: true })
    } finally {
      this.setData({ loading: false })
    }
  },
  async continuePayment() {
    const order = this.data.order
    if (this.data.paying || !order || order.status === '已支付') return

    this.setData({ paying: true })
    try {
      await payWechatOrder({
        orderId: order.id,
        amount: order.amount,
        description: order.title || '知鹿私课课程积分'
      })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await this.loadPage()
    } catch (error) {
      if (isWechatPaymentCancelled(error)) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        wx.showToast({ title: error.message || '暂时无法发起支付', icon: 'none' })
      }
    } finally {
      this.setData({ paying: false })
    }
  },
  goProducts() { wx.redirectTo({ url: '/commerce/products/index' }) },
  goCredits() { wx.redirectTo({ url: '/commerce/entitlements/index' }) },
  goOrder() {
    if (!this.data.orderId) return
    wx.redirectTo({ url: `/commerce/order-detail/index?orderId=${encodeURIComponent(this.data.orderId)}` })
  }
})
