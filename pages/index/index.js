const { loadCurrentUser, loadLearningDashboard } = require('../../services/identity')

function legacyPlanSummary(learning) {
  if (!learning.summary) return []
  return [{
    id: learning.summary.planId || 'current-plan',
    plan_name: learning.summary.planName || '学习计划',
    course: { title: learning.summary.planName || '学习计划' },
    schedules: (learning.tasks || []).slice(0, 3).map((task) => ({
      id: task.id,
      title: task.title || '学习任务',
      duration_minutes: Number(task.duration || 0),
      status: task.status || 'waiting'
    }))
  }]
}

Page({
  data: {
    loading: true,
    nickname: '学员',
    hasActivePlan: false,
    plans: [],
    courses: []
  },

  async onShow() {
    await this.loadPage()
  },

  async loadPage() {
    this.setData({ loading: true })
    try {
      const [user, learning] = await Promise.all([loadCurrentUser(), loadLearningDashboard()])
      const plans = legacyPlanSummary(learning)
      getApp().globalData.user = user
      this.setData({
        nickname: user.profile.nickname || user.profile.real_name || '学员',
        hasActivePlan: plans.length > 0,
        plans,
        courses: []
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  openProfile() {
    wx.switchTab({ url: '/pages/me/index' })
  }
})
