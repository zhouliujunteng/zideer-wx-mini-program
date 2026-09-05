const { loadCurrentDiagnosticReports } = require('../../services/identity')

const subjectNames = { Chinese: '语文', Mathematics: '数学', English: '英语', Physics: '物理', Chemistry: '化学', Biology: '生物', History: '历史', Geography: '地理', Politics: '道德与法治', 'Information Technology': '信息科技' }

function subjectOf(topic) {
  return topic.subjectKey || topic.subject_key || topic.subjectCode || topic.subject_code || ''
}

Page({
  data: { loading: true, failed: false, subjectName: '', weakTopics: [], errorTypes: [], domains: [] },

  async onLoad(options) {
    this.subjectKey = decodeURIComponent(options.subjectKey || '')
    this.setData({ subjectName: subjectNames[this.subjectKey] || this.subjectKey || '学科' })
    await this.loadPage()
  },

  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentDiagnosticReports()
      const report = data.reports.find((item) => item.status === 'completed' || item.status === 'ready') || data.reports[0]
      const summary = report && report.summary || {}
      const weakTopics = (report && report.weakTopics || []).filter((topic) => !subjectOf(topic) || subjectOf(topic) === this.subjectKey)
      const errorTypes = Array.isArray(summary.error_types) ? summary.error_types : Array.isArray(summary.errorTypes) ? summary.errorTypes : []
      const domains = Array.isArray(summary.domains) ? summary.domains : Array.isArray(summary.domain_distribution) ? summary.domain_distribution : []
      this.setData({ weakTopics, errorTypes, domains })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '学科诊断加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  }
})
