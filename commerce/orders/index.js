const { loadOrders } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, status: 'all', orders: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ orders: await loadOrders() })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '订单加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  chooseStatus(event) { this.setData({ status: event.currentTarget.dataset.status }) },
  openOrder(event) {
    wx.navigateTo({ url: `/commerce/order-detail/index?orderId=${encodeURIComponent(event.currentTarget.dataset.id)}` })
  }
})
