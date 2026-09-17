const { call, reportView } = require('../../services/assessment')

Page({
  data: { loading: true, failed: false, reports: [] },
  onShow() { this.loadPage() },
  onUnload() { this.version = (this.version || 0) + 1 },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    const version = this.version = (this.version || 0) + 1
    this.setData({ loading: true, failed: false })
    try {
      const result = await call('reports')
      if (this.version !== version) return
      const reports = (result.reports || []).map(a => {
        const r = reportView(a.report)
        return { id: a.id, scopeName: a.scope_snapshot && a.scope_snapshot.name, submittedAt: a.submitted_at ? String(a.submitted_at).slice(0, 10) : '', ...r }
      })
      this.setData({ loading: false, reports })
    } catch (_) {
      if (this.version !== version) return
      this.setData({ loading: false, failed: true })
    }
  },
  openTopic(event) { wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${event.currentTarget.dataset.id}` }) },
  startTest() { wx.navigateTo({ url: '/assessment/short/index' }) }
})
