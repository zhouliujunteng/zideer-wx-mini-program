const {
  startOrResumeDeepAssessment,
  saveCurrentAssessmentAnswer,
  submitCurrentBasicAssessment
} = require('../../services/identity')

function stringifyAnswer(answer) {
  if (answer === null || answer === undefined) return ''
  if (typeof answer === 'string') return answer
  if (typeof answer.value === 'string') return answer.value
  return ''
}

Page({
  data: {
    loading: true,
    submitting: false,
    savingId: '',
    grantId: '',
    subjectKey: '',
    template: null,
    attempt: null,
    questions: []
  },

  async onLoad(options) {
    const grantId = decodeURIComponent(options.grantId || '')
    const subjectKey = decodeURIComponent(options.subjectKey || '')
    if (!grantId || !subjectKey) {
      wx.showToast({ title: '缺少深测资格或学科', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ grantId, subjectKey })
    await this.loadAssessment()
  },

  async loadAssessment() {
    this.setData({ loading: true })
    try {
      const data = await startOrResumeDeepAssessment(this.data.grantId, this.data.subjectKey)
      this.setData({
        attempt: data.attempt,
        template: data.template,
        questions: (data.questions || []).map((question) => ({
          ...question,
          id: String(question.id),
          answerText: stringifyAnswer(question.answer),
          optionValues: (question.options || []).map((option) => typeof option === 'string'
            ? { label: option, value: option }
            : { label: option.label || option.value, value: option.value || option.label })
        }))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '深测加载失败', icon: 'none', duration: 2600 })
      setTimeout(() => wx.navigateBack(), 450)
    } finally {
      this.setData({ loading: false })
    }
  },

  async saveAnswer(questionId, answer) {
    if (!this.data.attempt || !questionId) return
    this.setData({ savingId: String(questionId) })
    try {
      await saveCurrentAssessmentAnswer(this.data.attempt.id, questionId, { value: answer })
    } catch (error) {
      wx.showToast({ title: error.message || '答案暂未保存', icon: 'none' })
    } finally {
      this.setData({ savingId: '' })
    }
  },

  inputAnswer(event) {
    const id = String(event.currentTarget.dataset.id)
    const answerText = event.detail.value
    this.setData({ questions: this.data.questions.map((item) => item.id === id ? { ...item, answerText } : item) })
  },

  blurAnswer(event) {
    this.saveAnswer(event.currentTarget.dataset.id, event.detail.value)
  },

  chooseAnswer(event) {
    const id = String(event.currentTarget.dataset.id)
    const answerText = event.currentTarget.dataset.value
    this.setData({ questions: this.data.questions.map((item) => item.id === id ? { ...item, answerText } : item) })
    this.saveAnswer(id, answerText)
  },

  async submitAssessment() {
    if (this.data.submitting || !this.data.attempt) return
    this.setData({ submitting: true })
    try {
      const result = await submitCurrentBasicAssessment(this.data.attempt.id)
      if (result.status === 'incomplete') {
        wx.showToast({ title: `还有 ${result.missingQuestionIds.length} 题未完成`, icon: 'none' })
        return
      }
      wx.redirectTo({ url: `/assessment/analysis/index?attemptId=${encodeURIComponent(this.data.attempt.id)}` })
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
