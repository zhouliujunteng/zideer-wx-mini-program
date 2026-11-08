const { attachUiAssets } = require('../../services/ui-assets')
const { openPaymentPage, attachPaymentSwitch } = require('../../services/payment-switch')
Page({
  // paymentOpen：支付开关关着时不显示「课程积分商城」
  data: { paymentOpen: false },
  onLoad() { attachUiAssets(this) },
  onShow() { attachPaymentSwitch(this) },
  startAssessment() { wx.navigateTo({ url: '/assessment/center/index' }) },
  openKnowledgeMap() { wx.switchTab({ url: '/pages/knowledge-map/index' }) },
  openProducts() { return openPaymentPage('/commerce/products/index', 'credits') }
})
