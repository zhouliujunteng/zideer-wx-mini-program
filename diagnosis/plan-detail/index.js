const { loadCurrentLearningPlans } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, plan: null },
  async onLoad(options) {
    const planId = String(options.planId || '')
    if (!planId) { wx.navigateBack(); return }
    await this.loadPlan(planId)
  },
  async loadPlan(planId) {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      const plan = (data.plans || []).find((item) => String(item.id) === planId)
      if (!plan) throw new Error('未找到该学习计划。')
      this.setData({ plan })
    } catch (error) { this.setData({ failed: true }); wx.showToast({ title: error.message || '计划详情加载失败', icon: 'none' }) } finally { this.setData({ loading: false }) }
  }
})
