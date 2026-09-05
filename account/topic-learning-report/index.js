const { loadAuthorizedTopicLearningReports, authorizeAcceptanceAudio } = require('../../services/identity')

const statusLabels = {
  generating: '报告生成中',
  ai_evaluated_pending_teacher: 'AI 已评价，待老师核验',
  teacher_verified_passed: '老师核验通过',
  teacher_rejected: '老师判定需补学',
  failed: '报告生成失败'
}

const reviewLabels = {
  pending: '待老师核验',
  verified_passed: '老师核验通过',
  teacher_verified_passed: '老师核验通过',
  rejected_for_remediation: '老师判定需补学',
  teacher_rejected: '老师判定需补学'
}

function studentName(profile) {
  return profile.nickname || profile.real_name || '学生档案'
}

function textFrom(value, fallback) {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter(Boolean).join('；') || fallback
  if (typeof value === 'object') {
    return value.summary || value.overview || value.headline || value.text || value.parent_summary || fallback
  }
  return fallback
}

function durationText(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  if (hours) return `${hours}小时${minutes}分钟`
  return `${minutes}分钟`
}

function formatDate(value) {
  if (!value) return '时间待补充'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间待补充'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function audioStatus(asset) {
  if (!asset.audio_file || !asset.audio_file.id) return '音频文件尚未就绪'
  if (asset.upload_status && asset.upload_status !== 'uploaded') return '音频上传处理中'
  if (asset.transcription_status === 'failed') return '转写处理异常'
  return '原声已受保护保存'
}

function buildReport(report, student) {
  const audioAssets = (report.audioAssets || []).map((asset) => ({
    ...asset,
    durationLabel: durationText(asset.duration_ms / 1000),
    statusLabel: audioStatus(asset),
    canPlay: Boolean(asset.audio_file && asset.audio_file.id && asset.upload_status === 'uploaded')
  }))
  const status = report.status || 'generating'
  const review = report.teacher_review_status || ''
  return {
    ...report,
    id: report.id,
    studentId: student.id,
    studentName: studentName(student.profile),
    studentGrade: student.profile.current_grade ? `${student.profile.school_stage || ''}${student.profile.current_grade}年级` : '年级待完善',
    reportNo: report.report_no || `报告 #${report.id}`,
    statusLabel: statusLabels[status] || '报告处理中',
    learningDuration: durationText(report.effective_seconds),
    generatedAt: formatDate(report.generated_at || report.updated_at_business),
    learningSummary: textFrom(report.learning_summary, '学习过程摘要正在整理。'),
    acceptanceSummary: textFrom(report.acceptance_summary, 'AI 验收摘要尚未生成。'),
    coverageSummary: textFrom(report.required_concept_coverage, '必备概念覆盖结果待生成。'),
    afterMasterySummary: textFrom(report.after_mastery_snapshot, '老师核验完成后会更新学习结果。'),
    comparisonSummary: textFrom(report.comparison_summary, '前后掌握对比待老师核验后生成。'),
    reviewLabel: reviewLabels[review] || '待老师核验',
    reviewSummary: textFrom(report.teacher_review_summary, '老师完成最终核验后，会在这里展示可公开的说明。'),
    isVerified: status === 'teacher_verified_passed' || review === 'verified_passed' || review === 'teacher_verified_passed',
    audioAssets
  }
}

Page({
  data: { loading: true, failed: false, students: [], currentIndex: 0, current: null, reports: [], selected: null, playingAssetId: null },

  onLoad(options) { this.initialReportId = String(options.reportId || '') },
  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const payload = await loadAuthorizedTopicLearningReports()
      const students = payload.students.map((student) => ({
        ...student,
        name: studentName(student.profile),
        initial: studentName(student.profile).slice(0, 1),
        gradeLabel: student.profile.current_grade ? `${student.profile.school_stage || ''}${student.profile.current_grade}年级` : '年级待完善'
      }))
      const currentIndex = Math.min(this.data.currentIndex, Math.max(students.length - 1, 0))
      const current = students[currentIndex] || null
      const reports = current ? current.reports.map((report) => buildReport(report, current)) : []
      const selected = reports.find((item) => String(item.id) === this.initialReportId) || reports[0] || null
      this.initialReportId = ''
      this.setData({ students, currentIndex, current, reports, selected })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '学习报告加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseStudent() {
    if (this.data.students.length < 2) return
    wx.showActionSheet({
      itemList: this.data.students.map((item) => `${item.name} · ${item.gradeLabel}`),
      success: ({ tapIndex }) => {
        this.stopAudio()
        const current = this.data.students[tapIndex]
        const reports = current.reports.map((report) => buildReport(report, current))
        this.setData({ currentIndex: tapIndex, current, reports, selected: reports[0] || null })
      }
    })
  },

  selectReport(event) {
    this.stopAudio()
    const reportId = String(event.currentTarget.dataset.id)
    const selected = this.data.reports.find((item) => String(item.id) === reportId)
    if (selected) this.setData({ selected })
  },

  openAcceptanceResult() {
    if (!this.data.selected) return
    wx.navigateTo({ url: `/learning/acceptance-result/index?reportId=${encodeURIComponent(this.data.selected.id)}` })
  },

  async playAudio(event) {
    const assetId = Number(event.currentTarget.dataset.id)
    if (!Number.isSafeInteger(assetId) || assetId <= 0) return

    if (this.data.playingAssetId === assetId && this.audioContext) {
      this.audioContext.stop()
      this.setData({ playingAssetId: null })
      return
    }

    this.stopAudio()
    this.setData({ playingAssetId: assetId })
    try {
      const asset = await authorizeAcceptanceAudio(assetId)
      if (this.data.playingAssetId !== assetId) return
      const audio = wx.createInnerAudioContext()
      this.audioContext = audio
      audio.src = asset.url
      audio.onEnded(() => this.setData({ playingAssetId: null }))
      audio.onStop(() => this.setData({ playingAssetId: null }))
      audio.onError(() => {
        this.setData({ playingAssetId: null })
        wx.showToast({ title: '原声播放失败，请重新尝试。', icon: 'none' })
      })
      audio.play()
    } catch (error) {
      this.setData({ playingAssetId: null })
      wx.showToast({ title: error.message || '原声暂时不可播放', icon: 'none' })
    }
  },

  stopAudio() {
    if (!this.audioContext) return
    this.audioContext.stop()
    this.audioContext.destroy()
    this.audioContext = null
  },

  onUnload() {
    this.stopAudio()
  }
})
