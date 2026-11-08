const { loadCreditProduct } = require('../../services/identity')
const { checkPaymentPage, openPaymentPage } = require('../../services/payment-switch')

function ruleText(rule, fallback) {
  if (!rule || typeof rule !== 'object') return fallback
  return rule.description || rule.summary || rule.label || fallback
}

Page({
  // 第一次读到商品前，名称、价格和规则位显示骨架；读到过一次后回到页面保留旧内容静默刷新。
  data: { loaded: false, failed: false, product: null, estimatedCourseText: '', validityText: '', serviceText: '', refundText: '' },
  onLoad(options) { this.productVersionId = options.productVersionId || '' },
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
      const product = await loadCreditProduct(this.productVersionId)
      this.setData({
        product,
        estimatedCourseText: product.estimatedCourseCount ? `约 ${product.estimatedCourseCount} 节` : '以学习规划为准',
        validityText: ruleText(product.validityRule, '以商品版本公布的有效期规则为准'),
        serviceText: ruleText(product.serviceRule, '以商品版本公布的服务规则为准'),
        refundText: ruleText(product.refundRule, '支付成功 7 日内可申请退款，超过 7 日不支持'),
        loaded: true
      })
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '商品加载失败', icon: 'none' })
    }
  },
  goConfirm() {
    if (!this.data.product) return
    return openPaymentPage(`/commerce/order-confirm/index?productVersionId=${encodeURIComponent(this.data.product.id)}`, 'credits')
  }
})
