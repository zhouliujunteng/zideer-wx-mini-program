const { loadAuthorizedTopicLearningReports } = require('../../services/identity')

const statusLabels = {
  generating: '评价生成中',
  ai_evaluated_pending_teacher: 'AI 已评价，待老师核验',
  teacher_verified_passed: '老师核验通过',
  teacher_rejected: '老师判定需补学',
  failed: '评价生成失败'
}

const reviewLabels = {
  pending: '老师核验中',
  verified_passed: '老师核验通过',
  teacher_verified_passed: '老师核验通过',
  rejected_for_remediation: '老师判定需补学',
  teacher_rejected: '老师判定需补学'
}

function textFrom(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter(Boolean).join('；') || fallback
  if (typeof value === 'object') return value.summary || value.overview || value.headline || value.text || value.parent_summary || fallback
  return fallback
}

function durationText(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  return hours ? `${hours}小时${minutes}分钟` : `${minutes}分钟`
}

function buildResult(report, student) {
  const status = report.status || 'generating'
  const review = report.teacher_review_status || ''
  const assets = report.audioAssets || report.feynman_acceptance && report.feynman_acceptance.audio_assets || []
  return {
    id: report.id,
    acceptanceId: report.feynman_acceptance && report.feynman_acceptance.id ? String(report.feynman_acceptance.id) : '',
    studentName: student.profile.nickname || student.profile.real_name || '学生档案',
    reportNo: report.report_no || `报告 #${report.id}`,
    statusLabel: statusLabels[status] || '评价处理中',
    reviewLabel: reviewLabels[review] || '老师核验中',
    isVerified: status === 'teacher_verified_passed' || review === 'verified_passed' || review === 'teacher_verified_passed',
    isRemediation: status === 'teacher_rejected' || review === 'rejected_for_remediation' || review === 'teacher_rejected',
    learningDuration: durationText(report.effective_seconds),
    acceptanceSummary: textFrom(report.acceptance_summary, 'AI 正在整理候选评价。'),
    coverageSummary: textFrom(report.required_concept_coverage, '必备概念覆盖结果待生成。'),
    reviewSummary: textFrom(report.teacher_review_summary, '老师完成最终核验后，会在这里展示可公开的结论。'),
    afterMasterySummary: textFrom(report.after_mastery_snapshot, '核验通过后会同步最终学习结果。'),
    comparisonSummary: textFrom(report.comparison_summary, '核验通过后会生成前后掌握对比。'),
    audioCount: assets.length,
    audioReadyCount: assets.filter((asset) => asset.audio_file && asset.audio_file.id && asset.upload_status === 'uploaded').length
  }
}

Page({
  data: { loading: true, failed: false, result: null },

  onLoad(options) { this.reportId = String(options.reportId || '') },
  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const payload = await loadAuthorizedTopicLearningReports()
      let result = null
      for (const student of payload.students) {
        const report = (student.reports || []).find((item) => String(item.id) === this.reportId)
        if (report) {
          result = buildResult(report, student)
          break
        }
      }
      this.setData({ result })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '验收结果加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  openReport() {
    if (!this.data.result) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: `/account/topic-learning-report/index?reportId=${encodeURIComponent(this.data.result.id)}` })
  },

  openNextStep() {
    if (!this.data.result) return
    if (this.data.result.isRemediation) {
      if (!this.data.result.acceptanceId) {
        wx.showToast({ title: '验收信息暂未就绪，请稍后刷新。', icon: 'none' })
        return
      }
      wx.navigateTo({ url: `/learning/remediation/index?acceptanceId=${encodeURIComponent(this.data.result.acceptanceId)}` })
      return
    }
    wx.navigateTo({ url: '/learning/daily-task/index' })
  }
})
