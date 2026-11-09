const { loadTeacherStudentAssessment } = require('../../services/identity')
const assessment = require('../../services/assessment')

// 老师工作台 → 学生详情 → 测评记录 → 单次测评报告（只读）。
// 报告的计算与学生端 assessment/short 同一套 reportView；后端按老师身份与绑定关系校验。
Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    name: '',
    status: '',
    report: null,
    openReview: -1
  },

  onLoad(options = {}) {
    this.studentProfileId = String(options.studentProfileId || '')
    this.attemptId = String(options.attemptId || '')
    this.load()
  },

  async load() {
    this.setData({ loadFailed: false, errorMessage: '' })
    try {
      const attempt = await loadTeacherStudentAssessment(this.studentProfileId, this.attemptId)
      this.setData({
        loaded: true,
        name: attempt.name,
        status: attempt.status,
        report: assessment.reportView(attempt.report)
      })
    } catch (error) {
      this.setData({ loadFailed: true, errorMessage: error && error.message || '测评报告暂时无法读取，请稍后重试。' })
    }
  },

  toggleReview(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ openReview: this.data.openReview === index ? -1 : index })
  }
})
