Page({
  startAssessment() { wx.navigateTo({ url: '/assessment/center/index' }) },
  openKnowledgeMap() { wx.switchTab({ url: '/pages/knowledge-map/index' }) },
  openProducts() { wx.navigateTo({ url: '/commerce/products/index' }) }
})
