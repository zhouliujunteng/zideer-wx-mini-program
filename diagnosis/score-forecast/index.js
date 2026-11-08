const { call, reportView } = require('../../services/assessment')

Page({
  // loaded：第一次读到报告前画骨架；之后回到页面保留旧数据，后台静默刷新。
  data: { loaded: false, failed: false, reports: [] },
  onShow() { this.loadPage() },
  onUnload() { this.version = (this.version || 0) + 1 },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    const version = this.version = (this.version || 0) + 1
    this.setData({ failed: false })
    try {
      const result = await call('reports')
      if (this.version !== version) return
      const reports = (result.reports || []).map(a => {
        const r = reportView(a.report)
        // 同一范围再测过的（第 2 次起）标上第几次，最新的在前
        const nth = a.paper_number > 1 ? ` · 第 ${a.paper_number} 次` : ''
        return { id: a.id, scopeName: ((a.scope_snapshot && a.scope_snapshot.name) || '') + nth, submittedAt: a.submitted_at ? String(a.submitted_at).slice(0, 10) : '', ...r }
      })
      this.setData({ loaded: true, reports })
    } catch (_) {
      if (this.version !== version) return
      this.setData({ failed: true })
      if (this.data.loaded) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
    }
  },
  openTopic(event) { wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${event.currentTarget.dataset.id}` }) },
  startTest() { wx.navigateTo({ url: '/assessment/short/index' }) }
})
