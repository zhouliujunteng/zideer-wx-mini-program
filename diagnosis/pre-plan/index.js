const { loadCurrentDiagnosticReports } = require('../../services/identity')

function normalizeTopic(topic) {
  if (typeof topic === 'string') return { name: topic, reason: '' }
  return {
    name: topic.name || topic.title || topic.topicName || topic.topic_code || '待确认知识点',
    reason: topic.reason || topic.description || ''
  }
}

Page({
  data: { loading: true, failed: false, topics: [], hasReport: false },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentDiagnosticReports()
      const report = (data.reports || []).find((item) => item.status === 'completed' || item.status === 'ready') || null
      this.setData({
        hasReport: Boolean(report),
        topics: report ? (report.weakTopics || []).map(normalizeTopic) : []
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '规划建议加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  startAssessment() {
    wx.redirectTo({ url: '/assessment/center/index' })
  },

  createPlan() {
    wx.navigateTo({ url: '/diagnosis/plan-generation/index' })
  }
})
