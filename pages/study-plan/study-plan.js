const { loadStudyLearners } = require('../../services/identity')

function formatLearner(learner) {
  const displayName = learner.nickname || learner.real_name || '学习用户'
  return {
    id: learner.id,
    displayName,
    initial: displayName.slice(0, 1),
    relationName: learner.relation_name || '本人',
    plans: (learner.plans || []).map((plan) => ({
      id: plan.id,
      title: plan.course && plan.course.title ? plan.course.title : plan.plan_name || '学习计划',
      planName: plan.plan_name || '',
      schedules: plan.schedules || []
    }))
  }
}

Page({
  data: {
    loading: true,
    learners: [],
    selectedIndex: 0,
    selectedLearner: null
  },

  async onShow() {
    await this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true })
    try {
      const learners = (await loadStudyLearners()).map(formatLearner)
      const selectedIndex = Math.min(this.data.selectedIndex, Math.max(learners.length - 1, 0))
      this.setData({
        learners,
        selectedIndex,
        selectedLearner: learners[selectedIndex] || null
      })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none', duration: 3000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  switchLearner(event) {
    const selectedIndex = Number(event.currentTarget.dataset.index)
    this.setData({
      selectedIndex,
      selectedLearner: this.data.learners[selectedIndex]
    })
  }
})
