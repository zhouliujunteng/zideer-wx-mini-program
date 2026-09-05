const { loadCurrentDiagnosticReports } = require('../../services/identity')

function formatDate(value) {
  if (!value) return '生成时间待确认'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '生成时间待确认'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

Page({
  data: { loading: true, failed: false, report: null, predictions: [] },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentDiagnosticReports()
      const report = data.reports.find((item) => item.status === 'completed' || item.status === 'ready') || data.reports[0] || null
      this.setData({
        report: report ? { ...report, generatedLabel: formatDate(report.generatedAt) } : null,
        predictions: data.predictions || []
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '诊断报告加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openForecast() {
    wx.navigateTo({ url: '/diagnosis/score-forecast/index' })
  },

  openSubject(event) {
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (!subjectKey) return
    wx.navigateTo({ url: `/diagnosis/subject/index?subjectKey=${encodeURIComponent(subjectKey)}` })
  },

  openPrePlan() {
    wx.navigateTo({ url: '/diagnosis/pre-plan/index' })
  },

  startAssessment() {
    wx.redirectTo({ url: '/assessment/center/index' })
  }
})
