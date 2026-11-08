const { loadCurrentLearningPlans } = require('../../services/identity')
const { courseGenerationState } = require('../../utils/course-state')

Page({
  // loaded：第一次读到计划前画骨架；之后回到页面保留旧计划，后台静默刷新任务状态。
  data: { loaded: false, failed: false, plan: null },
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
    this.setData({ failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      if (!this._active || version !== this._loadVersion) return
      const plan = (data.plans || []).find((item) => String(item.id) === this.planId)
      if (!plan) throw new Error('未找到该学习计划。')
      this.setData({ loaded: true, plan: { ...plan, items: (plan.items || []).map((item) => {
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
    }
  }
})
