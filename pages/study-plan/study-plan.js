const { loadLearningDashboard } = require('../../services/identity')

function formatLearner(student, learning) {
  const displayName = student.name || '学习用户'
  return {
    id: student.id,
    displayName,
    initial: displayName.slice(0, 1),
    relationName: student.relation || '本人',
    plans: learning.summary ? [{
      id: learning.summary.planId || 'current-plan',
      title: learning.summary.planName || '学习计划',
      planName: learning.summary.planName || '',
      schedules: (learning.tasks || []).map((task) => ({
        id: task.id,
        title: task.title || '学习任务',
        duration_minutes: Number(task.duration || 0),
        status: task.status || 'waiting'
      }))
    }] : []
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
      const learning = await loadLearningDashboard()
      const learners = (learning.students || []).map((student) => formatLearner(student, learning))
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
