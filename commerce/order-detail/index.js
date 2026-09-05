const { loadOrderDetail } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, order: null },
  onLoad(options) { this.orderId = options.orderId || '' },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ order: await loadOrderDetail(this.orderId) })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '订单详情加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  goCredits() { wx.navigateTo({ url: '/commerce/entitlements/index' }) },
  goProducts() { wx.navigateTo({ url: '/commerce/products/index' }) }
})
