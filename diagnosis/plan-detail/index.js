const { loadCurrentLearningPlans } = require('../../services/identity')
const { courseGenerationState } = require('../../utils/course-state')

Page({
  data: { loading: true, failed: false, plan: null },
  onLoad(options) {
    this.planId = String(options.planId || '')
  },
  onShow() {
    this._active = true
    if (!this.planId) { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/learning/index' }) }); return }
    return this.loadPlan()
  },
  onHide() { this._active = false; this._loadVersion = (this._loadVersion || 0) + 1 },
  onUnload() { this.onHide() },
  async loadPlan() {
    const version = this._loadVersion = (this._loadVersion || 0) + 1
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      if (!this._active || version !== this._loadVersion) return
      const plan = (data.plans || []).find((item) => String(item.id) === this.planId)
      if (!plan) throw new Error('未找到该学习计划。')
      this.setData({ plan: { ...plan, items: (plan.items || []).map((item) => {
        const course = (item.courseInstances || [])[0]
        return { ...item,
          taskStatusLabel: course || item.generationJob ? courseGenerationState(course, item.generationJob, item.status).label : item.statusLabel,
          generationUrl: `/learning/generation-status/index?planItemId=${encodeURIComponent(item.id)}`
        }
      }) } })
    } catch (error) {
      if (!this._active || version !== this._loadVersion) return
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '计划详情加载失败', icon: 'none' })
    } finally {
      if (this._active && version === this._loadVersion) this.setData({ loading: false })
    }
  }
})
