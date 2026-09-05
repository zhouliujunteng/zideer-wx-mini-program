const { loadCreditProduct } = require('../../services/identity')

function ruleText(rule, fallback) {
  if (!rule || typeof rule !== 'object') return fallback
  return rule.description || rule.summary || rule.label || fallback
}

Page({
  data: { loading: true, failed: false, product: null, validityText: '', serviceText: '' },
  onLoad(options) { this.productVersionId = options.productVersionId || '' },
  onShow() { this.loadPage() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const product = await loadCreditProduct(this.productVersionId)
      this.setData({
        product,
        estimatedCourseText: product.estimatedCourseCount ? `约 ${product.estimatedCourseCount} 节` : '以学习规划为准',
        validityText: ruleText(product.validityRule, '以商品版本公布的有效期规则为准'),
        serviceText: ruleText(product.serviceRule, '以商品版本公布的服务规则为准'),
        refundText: ruleText(product.refundRule, '以商品版本公布的退款规则为准')
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '商品加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  goConfirm() {
    if (!this.data.product) return
    wx.navigateTo({ url: `/commerce/order-confirm/index?productVersionId=${encodeURIComponent(this.data.product.id)}` })
  }
})
