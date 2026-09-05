const { loadCreditProducts, loadPurchaseEligibility } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, eligible: false, products: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const eligibility = await loadPurchaseEligibility()
      if (!eligibility.eligible) {
        this.setData({ eligible: false, products: [] })
        return
      }
      const data = await loadCreditProducts()
      this.setData({ eligible: true, products: data.products || [] })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '商城加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  openEligibility() { wx.navigateTo({ url: '/commerce/agent-gate/index' }) },
  openAccount() { wx.navigateTo({ url: '/commerce/entitlements/index' }) },
  openProduct(event) {
    const productVersionId = event.currentTarget.dataset.id
    wx.navigateTo({ url: `/commerce/product-detail/index?productVersionId=${encodeURIComponent(productVersionId)}` })
  }
})
