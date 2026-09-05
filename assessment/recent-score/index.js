const {
  loadCurrentAssessmentScores,
  saveCurrentAssessmentScore
} = require('../../services/identity')

function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function emptyForm() {
  return { id: '', examName: '', examDate: today(), score: '', fullScore: '', rankText: '' }
}

Page({
  data: {
    loading: true,
    saving: false,
    attemptId: '',
    scores: [],
    form: emptyForm()
  },

  async onLoad(options) {
    const attemptId = String(options.attemptId || '')
    if (!attemptId) {
      wx.showToast({ title: '缺少测评记录', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ attemptId })
    await this.loadScores()
  },

  async onPullDownRefresh() {
    await this.loadScores()
    wx.stopPullDownRefresh()
  },

  async loadScores() {
    this.setData({ loading: true })
    try {
      this.setData({ scores: await loadCurrentAssessmentScores(this.data.attemptId) })
    } catch (error) {
      wx.showToast({ title: error.message || '成绩加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  updateForm(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: event.detail.value })
  },

  chooseDate(event) {
    this.setData({ 'form.examDate': event.detail.value })
  },

  editScore(event) {
    const id = String(event.currentTarget.dataset.id)
    const score = this.data.scores.find((item) => item.id === id)
    if (!score) return
    this.setData({ form: { ...score } })
  },

  newScore() {
    this.setData({ form: emptyForm() })
  },

  async saveScore() {
    if (this.data.saving) return
    this.setData({ saving: true })
    try {
      await saveCurrentAssessmentScore(this.data.attemptId, this.data.form)
      wx.showToast({ title: '成绩已保存', icon: 'success' })
      this.setData({ form: emptyForm() })
      await this.loadScores()
    } catch (error) {
      wx.showToast({ title: error.message || '成绩保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  continueToAnalysis() {
    wx.redirectTo({ url: `/assessment/exam-upload/index?attemptId=${encodeURIComponent(this.data.attemptId)}` })
  }
})
