const { loadCurrentDiagnosticReports } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, predictions: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentDiagnosticReports()
      this.setData({ predictions: data.predictions || [] })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '预测加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  }
})
