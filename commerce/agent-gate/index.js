const { loadPurchaseEligibility } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, eligibility: null },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ eligibility: await loadPurchaseEligibility() })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '购买资格加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  goProducts() { wx.navigateTo({ url: '/commerce/products/index' }) },
  openAssignmentRequest() { wx.navigateTo({ url: '/commerce/assignment-request/index' }) }
})
