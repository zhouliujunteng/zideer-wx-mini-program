const {
  startOrResumeBasicAssessment,
  saveCurrentAssessmentAnswer,
  submitCurrentBasicAssessment
} = require('../../services/identity')

function stringifyAnswer(answer) {
  if (answer === null || answer === undefined) return ''
  if (typeof answer === 'string') return answer
  if (typeof answer.value === 'string') return answer.value
  return ''
}

const subjectNames = {
  Chinese: '语文',
  Mathematics: '数学',
  English: '英语',
  Physics: '物理',
  Chemistry: '化学',
  Biology: '生物',
  History: '历史',
  Geography: '地理',
  Politics: '思想政治',
  'Information Technology': '信息技术'
}

Page({
  data: {
    loading: true,
    submitting: false,
    savingId: '',
    subjectKey: '',
    targetExam: '',
    template: null,
    attempt: null,
    questions: []
  },

  async onLoad(options) {
    const subjectKey = decodeURIComponent(options.subjectKey || '')
    if (!subjectKey) {
      wx.showToast({ title: '缺少测评学科', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ subjectKey, targetExam: decodeURIComponent(options.targetExam || '') })
    await this.loadAssessment()
  },

  async loadAssessment() {
    this.setData({ loading: true })
    try {
      const data = await startOrResumeBasicAssessment(this.data.subjectKey, this.data.targetExam)
      this.setData({
        attempt: data.attempt,
        template: {
          ...data.template,
          subjectName: subjectNames[data.template && data.template.subjectKey] || data.template && data.template.subjectKey || '综合'
        },
        questions: (data.questions || []).map((question) => ({
          ...question,
          id: String(question.id),
          answerText: stringifyAnswer(question.answer),
          optionValues: (question.options || []).map((option) => typeof option === 'string' ? { label: option, value: option } : { label: option.label || option.value, value: option.value || option.label })
        }))
      })
    } catch (error) {
      wx.showToast({ title: error.message || '测评加载失败', icon: 'none', duration: 2600 })
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
      wx.showToast({ title: error.message || '答案保存失败', icon: 'none' })
    } finally {
      this.setData({ savingId: '' })
    }
  },

  inputAnswer(event) {
    const id = String(event.currentTarget.dataset.id)
    const answerText = event.detail.value
    const questions = this.data.questions.map((item) => item.id === id ? { ...item, answerText } : item)
    this.setData({ questions })
  },

  blurAnswer(event) {
    const id = event.currentTarget.dataset.id
    this.saveAnswer(id, event.detail.value)
  },

  chooseAnswer(event) {
    const id = String(event.currentTarget.dataset.id)
    const answerText = event.currentTarget.dataset.value
    const questions = this.data.questions.map((item) => item.id === id ? { ...item, answerText } : item)
    this.setData({ questions })
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
      wx.showModal({
        title: '测评已提交',
        content: '本次作答已冻结，正在进入分析状态。',
        showCancel: false,
        success: () => wx.redirectTo({ url: `/assessment/recent-score/index?attemptId=${encodeURIComponent(this.data.attempt.id)}` })
      })
    } catch (error) {
      wx.showToast({ title: error.message || '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
