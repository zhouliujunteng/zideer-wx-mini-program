const { loadAssessmentCenter } = require('../../services/identity')

const targetExamOptions = ['暂不设置', '期中考试', '期末考试', '中考', '高考', '其他考试']

function gradeLabel(profile) {
  const grade = Number(profile && profile.grade)
  if (grade >= 1 && grade <= 6) return `小学${grade}年级`
  if (grade >= 7 && grade <= 9) return `初${grade - 6}`
  if (grade >= 10 && grade <= 12) return `高${grade - 9}`
  return '未设置年级'
}

Page({
  data: {
    loading: true,
    submitting: false,
    subjectKey: '',
    subjectName: '',
    profile: null,
    gradeLabel: '',
    targetExamOptions,
    targetExamIndex: 0,
    targetExam: targetExamOptions[0]
  },

  async onLoad(options) {
    const subjectKey = decodeURIComponent(options.subjectKey || '')
    if (!subjectKey) {
      wx.showToast({ title: '缺少测评学科', icon: 'none' })
      wx.navigateBack()
      return
    }
    this.setData({ subjectKey })
    await this.loadContext()
  },

  async loadContext() {
    this.setData({ loading: true })
    try {
      const center = await loadAssessmentCenter()
      const subject = (center.subjects || []).find((item) => item.key === this.data.subjectKey)
      if (!subject) {
        throw new Error('当前年级不支持该学科测评。')
      }
      this.setData({
        profile: center.profile,
        subjectName: subject.name,
        gradeLabel: gradeLabel(center.profile)
      })
    } catch (error) {
      wx.showToast({ title: error.message || '测评信息加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 420)
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseTargetExam(event) {
    const targetExamIndex = Number(event.detail.value)
    this.setData({
      targetExamIndex,
      targetExam: targetExamOptions[targetExamIndex]
    })
  },

  continueToBasic() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const targetExam = this.data.targetExam === '暂不设置' ? '' : this.data.targetExam
    wx.navigateTo({
      url: `/assessment/basic/index?subjectKey=${encodeURIComponent(this.data.subjectKey)}&targetExam=${encodeURIComponent(targetExam)}`,
      complete: () => this.setData({ submitting: false })
    })
  }
})
