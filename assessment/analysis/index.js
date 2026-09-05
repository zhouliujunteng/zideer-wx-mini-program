const { loadAssessmentCenter } = require('../../services/identity')

Page({
  data: { loading: true, attempt: null, attemptId: '', statusLabel: '', canViewReport: false },

  async onLoad(options) {
    this.setData({ attemptId: String(options.attemptId || '') })
    await this.loadStatus()
  },

  async onPullDownRefresh() {
    await this.loadStatus()
    wx.stopPullDownRefresh()
  },

  async loadStatus() {
    this.setData({ loading: true })
    try {
      const center = await loadAssessmentCenter()
      const attempt = (center.attempts || []).find((item) => String(item.id) === this.data.attemptId)
      if (!attempt) throw new Error('未找到本次测评记录。')
      const completed = attempt.status === 'completed'
      this.setData({ attempt, statusLabel: attempt.statusLabel, canViewReport: completed })
    } catch (error) {
      wx.showToast({ title: error.message || '分析状态加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  goHistory() {
    if (this.data.canViewReport) {
      wx.redirectTo({ url: '/diagnosis/report/index' })
      return
    }
    wx.redirectTo({ url: '/assessment/center/index' })
  }
})
