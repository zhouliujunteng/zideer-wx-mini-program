const {
  loadCurrentAssessmentScores,
  saveCurrentAssessmentOcrReview
} = require('../../services/identity')

function formatOcr(value) {
  return value ? JSON.stringify(value, null, 2) : ''
}

Page({
  data: {
    loading: true,
    saving: false,
    attemptId: '',
    uploadId: '',
    record: null,
    reviewText: '',
    hasOcr: false,
    needsCarefulReview: false
  },

  async onLoad(options) {
    const attemptId = String(options.attemptId || '')
    const uploadId = String(options.uploadId || '')
    if (!attemptId || !uploadId) {
      wx.showToast({ title: '缺少试卷记录', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ attemptId, uploadId })
    await this.loadRecord()
  },

  async onPullDownRefresh() {
    await this.loadRecord()
    wx.stopPullDownRefresh()
  },

  async loadRecord() {
    this.setData({ loading: true })
    try {
      const records = await loadCurrentAssessmentScores(this.data.attemptId)
      const record = records.find((item) => item.id === this.data.uploadId)
      if (!record) throw new Error('未找到本次试卷记录。')
      const hasOcr = Boolean(record.ocrRaw)
      this.setData({
        record,
        hasOcr,
        reviewText: formatOcr(record.ocrCorrected || record.ocrRaw),
        needsCarefulReview: hasOcr && Number(record.ocrConfidence) < 0.8
      })
    } catch (error) {
      wx.showToast({ title: error.message || '识别结果加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  updateReview(event) {
    this.setData({ reviewText: event.detail.value })
  },

  async saveReview() {
    if (this.data.saving || !this.data.hasOcr) return
    let corrected
    try {
      corrected = JSON.parse(this.data.reviewText)
    } catch (error) {
      wx.showToast({ title: '请保持识别内容为有效 JSON 格式', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await saveCurrentAssessmentOcrReview(this.data.attemptId, this.data.uploadId, corrected)
      wx.showToast({ title: '校对结果已保存', icon: 'success' })
      wx.redirectTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(this.data.attemptId)}` })
    } catch (error) {
      wx.showToast({ title: error.message || '校对保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  returnToUpload() {
    wx.redirectTo({ url: `/assessment/exam-upload/index?attemptId=${encodeURIComponent(this.data.attemptId)}` })
  },

  continueToAnalysis() {
    wx.redirectTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(this.data.attemptId)}` })
  }
})
