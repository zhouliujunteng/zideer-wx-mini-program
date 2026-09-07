const { loadLearningDashboard } = require('../../services/identity')
const { syncTab } = require('../../utils/navigation')

function formatToday() {
  const now = new Date()
  return `${now.getMonth() + 1}月${now.getDate()}日的安排`
}

Page({
  data: {
    navigation: {},
    loading: true,
    loadFailed: false,
    refreshing: false,
    dateLabel: '',
    currentStudent: null,
    canStart: true,
    students: [],
    summary: null,
    currentTask: null,
    tasks: [],
    generation: null,
    acceptance: null
  },

  onLoad() {
    this.setData({
      navigation: getApp().globalData.navigation || {},
      dateLabel: formatToday()
    })
  },

  async onShow() {
    syncTab(this, 1)
    await this.loadPage()
  },

  async onPullDownRefresh() {
    await this.loadPage(true)
    wx.stopPullDownRefresh()
  },

  async loadPage(refreshing = false) {
    if (this.data.refreshing) return
    this.setData({ loading: !refreshing && !this.data.summary, refreshing, loadFailed: false })
    try {
      const learning = await loadLearningDashboard()
      const selectedId = getApp().globalData.currentStudentId || learning.currentStudentId
      const currentStudent = learning.students.find((item) => item.id === selectedId) || learning.students[0]
      this.setData({
        students: learning.students,
        currentStudent,
        canStart: currentStudent.relation === '本人',
        summary: learning.summary,
        currentTask: learning.currentTask,
        tasks: learning.tasks,
        generation: learning.generation,
        acceptance: learning.acceptance
      })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '学习安排加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  chooseStudent() {
    const names = this.data.students.map((item) => `${item.name} · ${item.relation}`)
    wx.showActionSheet({
      itemList: names,
      success: ({ tapIndex }) => {
        const currentStudent = this.data.students[tapIndex]
        getApp().globalData.currentStudentId = currentStudent.id
        this.setData({
          currentStudent,
          canStart: currentStudent.relation === '本人'
        })
      }
    })
  },

  startCurrentTask() {
    if (!this.data.canStart) {
      wx.showToast({ title: '家长视角仅可查看学习安排', icon: 'none' })
      return
    }
    const task = this.data.currentTask
    if (!task) return
    if (task.acceptanceCourseInstanceId) {
      wx.navigateTo({ url: `/learning/acceptance-entry/index?courseInstanceId=${encodeURIComponent(task.acceptanceCourseInstanceId)}` })
      return
    }
    if (!task.courseInstanceId) {
      wx.navigateTo({ url: `/learning/generation-status/index?planItemId=${encodeURIComponent(task.id)}&courseInstanceId=${encodeURIComponent(task.generationCourseInstanceId || '')}` })
      return
    }
    wx.navigateTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(task.courseInstanceId)}` })
  },

  handleTaskTap(event) {
    if (event.currentTarget.dataset.status === 'active') {
      this.startCurrentTask()
      return
    }
    this.showUpcoming()
  },

  showUpcoming() {
    const planId = this.data.summary && this.data.summary.planId
    if (planId) {
      wx.navigateTo({ url: `/learning/daily-task/index?planId=${encodeURIComponent(planId)}` })
      return
    }
    wx.navigateTo({ url: '/diagnosis/plans/index' })
  },

  openGenerationStatus() {
    const generation = this.data.generation
    if (!generation) return
    wx.navigateTo({ url: `/learning/generation-status/index?planItemId=${encodeURIComponent(generation.planItemId)}&courseInstanceId=${encodeURIComponent(generation.courseInstanceId || '')}` })
  },

  openSchedule() {
    wx.navigateTo({ url: '/learning/schedule/index' })
  },

  openKnowledgeMap() {
    wx.switchTab({ url: '/pages/knowledge-map/index' })
  }
})
