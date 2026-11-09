const { loadTeacherAgentAcceptance, reviewAgentCourseAcceptance } = require('../../services/identity')

// 老师工作台 → 学生详情 → 学习课程 → 课程核验。
// 学生学完课程、AI 验收通过后在这里做最终核验：确认验收后这门课才算通过，AI 认定的知识点写进学生的学习宇宙；
// 要求重学时必须写原因，学生能看到，并可以重新验收。身份与负责关系由课程服务按当前登录账号校验。
const STATUS_TEXT = {
  not_started: '学生还没有开始验收',
  in_progress: '学生正在和 AI 验收',
  ai_retry: 'AI 验收未通过，等学生重新验收',
  pending_teacher: 'AI 验收已通过，等你核验',
  teacher_passed: '已确认验收',
  teacher_rejected: '已要求重学'
}

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    course: null,
    acceptance: null,
    statusText: '',
    turns: [],
    note: '',
    submitting: false
  },

  onLoad(options = {}) {
    this.stageId = String(options.stageId || '')
  },

  onShow() {
    if (!this.data.submitting) this.refresh()
  },

  async refresh() {
    try {
      this.apply(await loadTeacherAgentAcceptance(this.stageId))
    } catch (error) {
      if (this.data.loaded) return
      this.setData({ loadFailed: true, errorMessage: error && error.message || '验收记录暂时无法读取，请稍后重试。' })
    }
  },

  retry() {
    this.setData({ loadFailed: false, errorMessage: '' })
    this.refresh()
  },

  apply(result = {}) {
    const acceptance = result.acceptance || {}
    this.setData({
      loaded: true,
      loadFailed: false,
      course: result.course || this.data.course,
      acceptance,
      statusText: STATUS_TEXT[acceptance.status] || '',
      gradePercent: acceptance.grade ? Math.round((Number(acceptance.grade.score) || 0) * 100) : 0,
      turns: (result.turns || this.data.turns || []).map((turn, index) => ({ id: `t${index}`, role: turn.role, content: turn.content }))
    })
  },

  onNoteInput(event) {
    this.setData({ note: String(event.detail.value || '').slice(0, 500) })
  },

  confirmPass() {
    const topics = (this.data.acceptance && this.data.acceptance.topics) || []
    wx.showModal({
      title: '确认验收通过？',
      content: topics.length
        ? `确认后这门课算通过，${topics.map((item) => item.name).join('、')} 会进入学生的学习宇宙。`
        : '确认后这门课算通过。AI 没有认定到对应的知识点，学习宇宙不会新增知识点。',
      confirmText: '确认通过',
      success: (res) => { if (res.confirm) this.submit('passed') }
    })
  },

  requestRemediation() {
    if (!this.data.note.trim()) {
      wx.showToast({ title: '请先在下方写一句需要重学的原因', icon: 'none' })
      return
    }
    wx.showModal({
      title: '要求学生重学？',
      content: '学生会看到你写的原因，可以复习后重新验收。',
      confirmText: '要求重学',
      success: (res) => { if (res.confirm) this.submit('remediation') }
    })
  },

  async submit(result) {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const response = await reviewAgentCourseAcceptance(this.stageId, result, this.data.note)
      this.apply({ acceptance: response.acceptance })
      this.setData({ note: '' })
      wx.showToast({ title: result === 'passed' ? '已确认验收' : '已要求重学', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: error && error.message || '核验没有提交成功', icon: 'none', duration: 3000 })
      this.refresh()
    } finally {
      this.setData({ submitting: false })
    }
  }
})
