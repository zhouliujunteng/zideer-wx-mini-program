const { loadAssessmentCenter } = require('../../services/identity')

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}.${month}.${day}`
}

Page({
  data: { loading: true, attempts: [] },

  onShow() { this.loadAttempts() },

  async onPullDownRefresh() {
    await this.loadAttempts()
    wx.stopPullDownRefresh()
  },

  async loadAttempts() {
    this.setData({ loading: true })
    try {
      const center = await loadAssessmentCenter()
      this.setData({
        attempts: (center.attempts || []).map((item) => ({
          ...item,
          dateLabel: formatDate(item.completedAt || item.submittedAt || item.startedAt) || '日期待记录',
          actionLabel: item.status === 'draft' ? '继续' : item.status === 'completed' ? '查看报告' : '查看进度'
        }))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '测评记录加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openAttempt(event) {
    const attempt = this.data.attempts.find((item) => String(item.id) === String(event.currentTarget.dataset.id))
    if (!attempt) return
    if (attempt.status === 'draft') {
      wx.navigateTo({ url: `/assessment/basic/index?subjectKey=${encodeURIComponent(attempt.subjectKey)}&resume=1` })
      return
    }
    wx.navigateTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(attempt.id)}` })
  }
})
