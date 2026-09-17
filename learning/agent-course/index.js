const { loadAgentCourse } = require('../../services/identity')
const { isAgentCourseId } = require('../../utils/agent-course-view')

// 生成中每 3 秒读一次进度；离开页面停止，回到页面立即刷新。
const POLL_INTERVAL_MS = 3000
// 建课后马上点开卡片时生成记录可能还没登记：找不到课程时再等约 1 分钟。
const NOT_FOUND_RETRIES = 20

Page({
  data: {
    loading: true,
    course: null,
    errorMessage: ''
  },

  onLoad(options = {}) {
    this.stageId = String(options.stageId || '')
  },

  onShow() {
    this._visible = true
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this._version = (this._version || 0) + 1
    this.stopPolling()
  },

  onUnload() {
    this.onHide()
  },

  stopPolling() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  },

  reload() {
    this.setData({ loading: !this.data.course, errorMessage: '' })
    return this.refresh()
  },

  async refresh() {
    this.stopPolling()
    const version = this._version = (this._version || 0) + 1
    if (!isAgentCourseId(this.stageId)) {
      this.setData({ loading: false, course: null, errorMessage: '课程链接无效，请回到对话重新打开。' })
      return
    }
    try {
      const course = await loadAgentCourse(this.stageId)
      if (!this._visible || version !== this._version) return
      this._notFound = 0
      this.setData({ loading: false, course, errorMessage: '' })
      if (course.isGenerating) this.schedule()
    } catch (error) {
      if (!this._visible || version !== this._version) return
      const message = error && error.message || '课程进度暂时无法读取，请稍后重试。'
      // 已经显示过进度时只提示一行，继续按节拍重试；首次读取失败才显示错误页。
      this.setData({ loading: false, errorMessage: this.data.course ? '网络不稳定，正在重新读取进度…' : message })
      if (this.data.course && this.data.course.isGenerating) this.schedule()
      else if (!this.data.course && error && error.statusCode === 404 && (this._notFound = (this._notFound || 0) + 1) <= NOT_FOUND_RETRIES) this.schedule()
    }
  },

  schedule() {
    if (!this._visible) return
    this.stopPolling()
    this._timer = setTimeout(() => this.refresh(), POLL_INTERVAL_MS)
  },

  startLearning() {
    const course = this.data.course
    if (!course || !course.canLearn) return
    wx.navigateTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(course.stageId)}` })
  },

  openMyCourses() {
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
