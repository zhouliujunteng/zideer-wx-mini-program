const { loadCurrentLearningPlans } = require('../../services/identity')

function statusLabel(status) {
  return ({ draft: '待安排', generating: '生成中', planned: '待学习', active: '学习中', completed: '已完成', paused: '已暂停', failed: '生成失败' })[String(status || '').toLowerCase()] || '状态待确认'
}

Page({
  // 第一次读到计划前只显示骨架；读到过一次后回到本页保留旧内容静默刷新。
  data: { loading: true, loaded: false, failed: false, plan: null, tasks: [] },
  onLoad(options) { this.planId = String(options.planId || '') },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    if (!this.data.loaded) this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      const plans = data.plans || []
      const plan = plans.find((item) => String(item.id) === this.planId) || plans.find((item) => String(item.status || '').toLowerCase() === 'active') || plans[0]
      if (!plan) {
        this.setData({ plan: null, tasks: [], loaded: true, failed: false })
        return
      }
      this.setData({
        loaded: true,
        failed: false,
        plan,
        tasks: (plan.items || []).map((item) => ({
          ...item,
          statusLabel: statusLabel(item.status),
          creditText: item.estimatedCreditsDisplay === null ? '积分以生成报价为准' : `预计 ${item.estimatedCreditsDisplay} 积分`
        }))
      })
    } catch (error) {
      // 已显示过的计划不因刷新失败被换成错误页。
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '学习任务加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  openPlan() {
    if (!this.data.plan) return
    wx.navigateTo({ url: `/diagnosis/plan-detail/index?planId=${encodeURIComponent(this.data.plan.id)}` })
  },
  openPlans() { wx.navigateTo({ url: '/diagnosis/plans/index' }) }
})
