const { loadAgentCoursePractice, answerAgentCoursePractice, retryAgentCoursePractice } = require('../../services/identity')
const { isAgentCourseId } = require('../../utils/agent-course-view')
const {
  normalizePractice,
  emptyAnswer,
  responseOf,
  questionScreen,
  toggleOrder,
  tapMatch,
  feedbackOf,
  clearSummary,
  progressPercent,
  comboText
} = require('../../utils/practice-view')
const { rpxToPx } = require('../../utils/screen')

// 互动练习（2026-11-11 用户规则「闯关学习」第二关，取代课后作业）：看完课后按本课知识点出 5～8 道题，
// 一屏一道（选择、判断、填空、排序、配对），答完马上告诉对错和解析；答错的放到后面再做一遍，全部做对才通关。
// 通关后去第三关「AI 老师验收」。出题在后台，没出好时每 4 秒看一次。

const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 45

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    practice: null,
    screen: null,
    answer: null,
    checking: false,
    feedback: null,
    percent: 0,
    summary: null,
    showReview: false,
    pollStopped: false,
    // 动效（多邻国式）：连对提示、答错时题目左右抖、通关时彩带和数字滚动
    combo: null,
    shake: false,
    celebrate: false,
    statShown: { total: 0, first: 0 },
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
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375)
    })
  },

  onShow() {
    this._visible = true
    this._polls = 0
    // 正在看反馈（答完一道还没点「继续」）时回到页面，不刷新，免得跳过反馈
    if (this.data.feedback) return
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this.stopPolling()
    this.stopEffects()
  },

  stopEffects() {
    for (const key of ['_comboTimer', '_shakeTimer', '_statTimer']) {
      if (this[key]) clearTimeout(this[key])
      this[key] = null
    }
  },

  onUnload() { this.onHide() },

  stopPolling() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  },

  async refresh() {
    this.stopPolling()
    if (!isAgentCourseId(this.stageId)) {
      this.setData({ loadFailed: true, errorMessage: '课程链接无效，请回到课程重新打开。' })
      return
    }
    try {
      const data = await loadAgentCoursePractice(this.stageId)
      if (!this._visible) return
      const practice = normalizePractice(data && data.practice)
      // 以前排的课后作业（整卷交）仍在作业页做
      if (practice.kind === 'homework') {
        wx.redirectTo({ url: `/learning/homework/index?stageId=${encodeURIComponent(this.stageId)}` })
        return
      }
      this.apply(practice)
    } catch (error) {
      if (!this._visible) return
      if (this.data.loaded) {
        wx.showToast({ title: error && error.message || '互动练习暂时无法读取', icon: 'none' })
        if (this.data.practice && this.data.practice.status === 'preparing') this.schedule()
        return
      }
      this.setData({ loadFailed: true, errorMessage: error && error.message || '互动练习暂时无法读取，请稍后重试。' })
    }
  },

  apply(practice) {
    const previous = this.data.screen
    const current = practice.progress ? practice.progress.current : null
    // 同一道题刷新时保留已经做了一半的作答
    const keep = previous && current === previous.index && this.data.practice && this.data.practice.status === 'ready'
    const answer = keep ? this.data.answer : emptyAnswer(practice.questions[current])
    this.setData({
      loaded: true,
      loadFailed: false,
      practice,
      answer,
      screen: questionScreen(practice, answer, false),
      percent: progressPercent(practice),
      summary: clearSummary(practice),
      feedback: null,
      pollStopped: false
    })
    if (practice.status === 'preparing') this.schedule()
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

  setAnswer(answer) {
    this.setData({ answer, screen: questionScreen(this.data.practice, answer, false) })
  },

  canEdit() {
    return this.data.screen && !this.data.feedback && !this.data.checking
  },

  chooseOption(event) {
    if (!this.canEdit()) return
    this.setAnswer(String(event.currentTarget.dataset.letter || ''))
  },

  inputFill(event) {
    if (!this.canEdit()) return
    this.setAnswer(String(event.detail.value || ''))
  },

  tapOrder(event) {
    if (!this.canEdit()) return
    this.setAnswer(toggleOrder(this.data.answer, Number(event.currentTarget.dataset.option)))
  },

  tapMatchLeft(event) {
    if (!this.canEdit()) return
    this.setAnswer(tapMatch(this.data.answer, 'left', Number(event.currentTarget.dataset.index)))
  },

  tapMatchRight(event) {
    if (!this.canEdit()) return
    this.setAnswer(tapMatch(this.data.answer, 'right', Number(event.currentTarget.dataset.index)))
  },

  async check() {
    const { screen, practice, answer } = this.data
    if (!screen || this.data.checking || this.data.feedback) return
    if (!screen.ready) {
      wx.showToast({ title: screen.type === 'fill' ? '先把空填上' : screen.type === 'order' ? '把每一项都排上' : screen.type === 'match' ? '每一项都要连上' : '先选一个答案', icon: 'none' })
      return
    }
    this.setData({ checking: true })
    try {
      const question = practice.questions[screen.index]
      const result = await answerAgentCoursePractice(this.stageId, screen.index, responseOf(question, answer))
      this._next = normalizePractice(result && result.practice)
      if (wx.vibrateShort) wx.vibrateShort({ type: result && result.correct ? 'light' : 'heavy' })
      const streak = this._next.progress ? this._next.progress.streak : 0
      const combo = result && result.correct ? comboText(streak) : ''
      this.setData({
        feedback: feedbackOf(result),
        screen: questionScreen(practice, answer, true),
        percent: progressPercent(this._next),
        shake: !(result && result.correct),
        ...(combo ? { combo: { text: combo, key: Date.now() } } : {})
      })
      if (combo) {
        if (this._comboTimer) clearTimeout(this._comboTimer)
        this._comboTimer = setTimeout(() => { this._comboTimer = null; this.setData({ combo: null }) }, 1800)
      }
      if (this._shakeTimer) clearTimeout(this._shakeTimer)
      this._shakeTimer = setTimeout(() => { this._shakeTimer = null; if (this.data.shake) this.setData({ shake: false }) }, 520)
    } catch (error) {
      if (error && error.code === 'PRACTICE_STALE') {
        this.setData({ feedback: null })
        return this.refresh()
      }
      wx.showToast({ title: error && error.message || '没有提交上去，请再点一次。', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ checking: false })
    }
  },

  next() {
    const practice = this._next
    this._next = null
    if (!practice) return this.refresh()
    const justCleared = practice.status === 'done' && this.data.practice && this.data.practice.status === 'ready'
    this.setData({ feedback: null, screen: null })
    this.apply(practice)
    if (justCleared) this.celebrate()
  },

  // 刚通关：彩带飘落，「几道小题」「一次答对」两个数字依次从 0 滚上去
  celebrate() {
    const summary = this.data.summary
    if (!summary) return
    this.setData({ celebrate: true, statShown: { total: 0, first: 0 } })
    if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    const steps = [['total', summary.total], ['first', summary.first]]
    let field = 0
    let value = 0
    const tick = () => {
      if (field >= steps.length) { this._statTimer = null; return }
      const [key, target] = steps[field]
      value = Math.min(target, value + 1)
      this.setData({ [`statShown.${key}`]: value })
      if (value >= target) { field += 1; value = 0 }
      this._statTimer = setTimeout(tick, value === 0 ? 260 : 70)
    }
    this._statTimer = setTimeout(tick, 450)
  },

  async retryGenerate() {
    if (this._retrying) return
    this._retrying = true
    try {
      const data = await retryAgentCoursePractice(this.stageId)
      this._polls = 0
      this.apply(normalizePractice(data && data.practice))
    } catch (error) {
      wx.showToast({ title: error && error.message || '没有重新出题，请稍后再试。', icon: 'none' })
    } finally {
      this._retrying = false
    }
  },

  toggleReview() {
    this.setData({ showReview: !this.data.showReview })
  },

  openAcceptance() {
    wx.redirectTo({ url: `/learning/agent-acceptance/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  openCourse() {
    wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
