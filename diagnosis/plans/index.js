const { loadCurrentLearningPlans } = require('../../services/identity')

function statusLabel(status) {
  return ({ draft: '草稿', generating: '生成中', active: '执行中', paused: '已暂停', completed: '已完成', failed: '生成失败' })[status] || '状态待确认'
}

Page({
  // loaded：第一次读到计划前画骨架；之后回到页面保留旧列表，后台静默刷新。
  data: { loaded: false, failed: false, plans: [] },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      this.setData({ loaded: true, plans: (data.plans || []).map((plan) => ({ ...plan, statusLabel: statusLabel(plan.status), itemCount: plan.items.length })) })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '学习计划加载失败', icon: 'none' })
    }
  },
  openPlan(event) {
    const planId = event.currentTarget.dataset.id
    if (!planId) return
    wx.navigateTo({ url: `/diagnosis/plan-detail/index?planId=${encodeURIComponent(planId)}` })
  },
  createPlan() {
    wx.navigateTo({ url: '/diagnosis/plan-generation/index' })
  }
})
