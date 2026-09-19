const { attachUiAssets } = require('../../services/ui-assets')
Page({
  onLoad() { attachUiAssets(this) },
  startAssessment() { wx.navigateTo({ url: '/assessment/center/index' }) },
  openKnowledgeMap() { wx.switchTab({ url: '/pages/knowledge-map/index' }) },
  openProducts() { wx.navigateTo({ url: '/commerce/products/index' }) }
})
