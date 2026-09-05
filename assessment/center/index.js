const { loadAssessmentCenter, loadDeepAssessmentEntitlements } = require('../../services/identity')

Page({
  data: {
    loading: true,
    loadFailed: false,
    refreshing: false,
    profile: null,
    subjects: [],
    attempts: [],
    deepGrants: []
  },

  onShow() {
    this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage(true)
    wx.stopPullDownRefresh()
  },

  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ loading: !refreshing && !this.data.profile, refreshing, loadFailed: false })
    try {
      const [center, entitlements] = await Promise.all([
        loadAssessmentCenter(),
        loadDeepAssessmentEntitlements()
      ])
      this.setData({ ...center, deepGrants: entitlements.grants || [] })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '测评中心加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  startSubject(event) {
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (!subjectKey) return
    wx.navigateTo({ url: `/assessment/context/index?subjectKey=${encodeURIComponent(subjectKey)}` })
  },

  resumeAttempt(event) {
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (!subjectKey) {
      wx.showToast({ title: '该测评缺少学科信息', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/assessment/basic/index?subjectKey=${encodeURIComponent(subjectKey)}&resume=1` })
  },

  openHistory() {
    wx.navigateTo({ url: '/assessment/history/index' })
  },

  openDeepEntitlement() {
    wx.navigateTo({ url: '/assessment/deep-entitlement/index' })
  }
})
