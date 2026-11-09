const { loadAgentCourseHomework, submitAgentCourseHomework, retryAgentCourseHomework } = require('../../services/identity')
const { isAgentCourseId } = require('../../utils/agent-course-view')
const { normalizeHomework, questionRows, allAnswered, resultSummary } = require('../../utils/homework-view')
const { rpxToPx } = require('../../utils/screen')

// 课后作业（2026-10-13 用户规则「每节课学完 AI 出练习题」）：课程详情「课后作业」卡片点进来。
// 整节学完后课程服务在后台出 3～5 道客观题；还没出好时显示「正在出题」并每 4 秒看一次，出不来给「重新出题」。
// 学生一题一题选好后交卷，服务端判分，交卷后才拿到正确答案与解析。一节课只有一份作业，交过不能重做。

const POLL_INTERVAL_MS = 4000
// 出题一般一两分钟；轮询 3 分钟还没好就停下，留一个「刷新」按钮
const MAX_POLLS = 45

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    homework: null,
    rows: [],
    choices: [],
    canSubmit: false,
    submitting: false,
    summary: null,
    pollStopped: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80
  },

  onLoad(options = {}) {
    this.stageId = String(options.stageId || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(18, windowInfo.windowWidth || 375)
    })
  },

  onShow() {
    this._visible = true
    this._polls = 0
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this.stopPolling()
  },

  onUnload() { this.onHide() },

  stopPolling() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  },

  async refresh() {
    this.stopPolling()
    if (!isAgentCourseId(this.stageId)) {
      this.setData({ loaded: false, loadFailed: true, errorMessage: '课程链接无效，请回到课程详情重新打开。' })
      return
    }
    try {
      const data = await loadAgentCourseHomework(this.stageId)
      if (!this._visible) return
      this.apply(normalizeHomework(data && data.homework))
    } catch (error) {
      if (!this._visible) return
      // 读到过一次后再失败只提示，不换掉页面内容
      if (this.data.loaded) {
        wx.showToast({ title: error && error.message || '课后作业暂时无法读取', icon: 'none' })
        if (this.data.homework && this.data.homework.status === 'preparing') this.schedule()
        return
      }
      this.setData({ loadFailed: true, errorMessage: error && error.message || '课后作业暂时无法读取，请稍后重试。' })
    }
  },

  apply(homework) {
    // 同一份题目做了一半时刷新，保留已选的答案
    const keep = this.data.homework && this.data.homework.status === 'ready' && homework.status === 'ready'
    const choices = keep ? this.data.choices : homework.questions.map(() => '')
    this.setData({
      loaded: true,
      loadFailed: false,
      homework,
      choices,
      rows: questionRows(homework, choices),
      canSubmit: allAnswered(homework, choices),
      summary: resultSummary(homework),
      pollStopped: false
    })
    if (homework.status === 'preparing') this.schedule()
  },

  schedule() {
    if (!this._visible) return
    this._polls = (this._polls || 0) + 1
    if (this._polls > MAX_POLLS) {
      this.setData({ pollStopped: true })
      return
    }
    this.stopPolling()
    this._timer = setTimeout(() => this.refresh(), POLL_INTERVAL_MS)
  },

  reload() {
    this._polls = 0
    this.setData({ loadFailed: false, pollStopped: false })
    return this.refresh()
  },

  choose(event) {
    const homework = this.data.homework
    if (!homework || homework.status !== 'ready' || this.data.submitting) return
    const { index, letter } = event.currentTarget.dataset
    const choices = this.data.choices.slice()
    choices[Number(index)] = String(letter || '')
    this.setData({ choices, rows: questionRows(homework, choices), canSubmit: allAnswered(homework, choices) })
  },

  submit() {
    const homework = this.data.homework
    if (!homework || homework.status !== 'ready' || this.data.submitting) return
    if (!this.data.canSubmit) {
      wx.showToast({ title: '还有题目没选答案', icon: 'none' })
      return
    }
    wx.showModal({
      title: '交卷',
      content: '交卷后马上出结果，交了就不能再改答案。确认交卷吗？',
      confirmText: '交卷',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ submitting: true })
        try {
          const data = await submitAgentCourseHomework(this.stageId, this.data.choices)
          this.apply(normalizeHomework(data && data.homework))
          wx.pageScrollTo && wx.pageScrollTo({ scrollTop: 0, duration: 200 })
        } catch (error) {
          wx.showToast({ title: error && error.message || '没有交上去，请再交一次。', icon: 'none', duration: 2500 })
        } finally {
          this.setData({ submitting: false })
        }
      }
    })
  },

  async retryGenerate() {
    if (this._retrying) return
    this._retrying = true
    try {
      const data = await retryAgentCourseHomework(this.stageId)
      this._polls = 0
      this.apply(normalizeHomework(data && data.homework))
    } catch (error) {
      wx.showToast({ title: error && error.message || '没有重新出题，请稍后再试。', icon: 'none' })
    } finally {
      this._retrying = false
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/learning/index' })
  },

  openCourse() {
    wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(this.stageId)}` })
  }
})
