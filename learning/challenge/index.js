const { loadAgentCourseChallenge, answerAgentCourseChallenge, retryAgentCourseChallenge } = require('../../services/identity')
const { isAgentCourseId } = require('../../utils/agent-course-view')
const {
  normalizeChallenge,
  emptyChallengeAnswer,
  challengeResponse,
  challengeScreen,
  challengeFeedback,
  challengePercent,
  challengeSummary
} = require('../../utils/challenge-view')
const { rpxToPx } = require('../../utils/screen')

// 考试挑战（2026-11-17 用户要求，课程服务 lib/course/homework/challenge-service.ts）：互动练习通关后可选的一关，
// 对标学校考试的中档题，不挡闯关。每道题最多答两次：第一次错只给错因和提示、留在这道题；第二次错给答案往下走。
// 做完按第一次答对的比例给星。出题在后台（开思考、两次独立复核，比互动练习慢），没出好时每 5 秒看一次。

const POLL_INTERVAL_MS = 5000
const MAX_POLLS = 60

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    challenge: null,
    screen: null,
    answer: null,
    stepMarks: null,
    checking: false,
    feedback: null,
    percent: 0,
    summary: null,
    showReview: false,
    pollStopped: false,
    shake: false,
    celebrate: false,
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
    if (this.data.feedback) return
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this.stopPolling()
    if (this._shakeTimer) clearTimeout(this._shakeTimer)
    this._shakeTimer = null
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
      const data = await loadAgentCourseChallenge(this.stageId)
      if (!this._visible) return
      this.apply(normalizeChallenge(data && data.challenge))
    } catch (error) {
      if (!this._visible) return
      if (this.data.loaded) {
        wx.showToast({ title: error && error.message || '考试挑战暂时无法读取', icon: 'none' })
        if (this.data.challenge && this.data.challenge.status === 'preparing') this.schedule()
        return
      }
      this.setData({ loadFailed: true, errorMessage: error && error.message || '考试挑战暂时无法读取，请稍后重试。' })
    }
  },

  apply(challenge) {
    const previous = this.data.screen
    const current = challenge.progress ? challenge.progress.current : null
    const keep = previous && current === previous.index && this.data.challenge && this.data.challenge.status === 'ready'
    const answer = keep ? this.data.answer : emptyChallengeAnswer(challenge.questions[current])
    const stepMarks = keep ? this.data.stepMarks : null
    this.setData({
      loaded: true,
      loadFailed: false,
      challenge,
      answer,
      stepMarks,
      screen: challengeScreen(challenge, answer, false, stepMarks),
      percent: challengePercent(challenge),
      summary: challengeSummary(challenge),
      feedback: null,
      pollStopped: false
    })
    if (challenge.status === 'preparing') this.schedule()
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
    this.setData({ answer, screen: challengeScreen(this.data.challenge, answer, false, this.data.stepMarks) })
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

  inputStep(event) {
    if (!this.canEdit()) return
    const index = Number(event.currentTarget.dataset.index)
    const answer = Array.isArray(this.data.answer) ? this.data.answer.slice() : []
    answer[index] = String(event.detail.value || '')
    this.setAnswer(answer)
  },

  async check() {
    const { screen, challenge, answer } = this.data
    if (!screen || this.data.checking || this.data.feedback) return
    if (!screen.ready) {
      wx.showToast({ title: screen.type === 'steps' ? '每一问都要填上' : screen.type === 'fill' ? '先把空填上' : '先选一个答案', icon: 'none' })
      return
    }
    this.setData({ checking: true })
    try {
      const question = challenge.questions[screen.index]
      const result = await answerAgentCourseChallenge(this.stageId, screen.index, challengeResponse(question, answer))
      this._next = normalizeChallenge(result && result.challenge)
      if (wx.vibrateShort) wx.vibrateShort({ type: result && result.correct ? 'light' : 'heavy' })
      const feedback = challengeFeedback(result)
      const stepMarks = feedback.held && Array.isArray(result.steps) && result.steps.length ? result.steps : null
      this.setData({
        feedback,
        stepMarks,
        screen: challengeScreen(challenge, answer, true, stepMarks),
        percent: challengePercent(this._next),
        shake: !(result && result.correct)
      })
      if (this._shakeTimer) clearTimeout(this._shakeTimer)
      this._shakeTimer = setTimeout(() => { this._shakeTimer = null; if (this.data.shake) this.setData({ shake: false }) }, 520)
    } catch (error) {
      if (error && error.code === 'CHALLENGE_STALE') {
        this.setData({ feedback: null })
        return this.refresh()
      }
      wx.showToast({ title: error && error.message || '没有提交上去，请再点一次。', icon: 'none', duration: 2500 })
    } finally {
      this.setData({ checking: false })
    }
  },

  next() {
    const challenge = this._next
    this._next = null
    if (!challenge) return this.refresh()
    // 第一次答错：留在这道题，保留作答和每一问的对错标记，让他改
    if (this.data.feedback && this.data.feedback.held) {
      this.setData({
        feedback: null,
        challenge,
        screen: challengeScreen(challenge, this.data.answer, false, this.data.stepMarks)
      })
      return
    }
    const justDone = challenge.status === 'done' && this.data.challenge && this.data.challenge.status === 'ready'
    this.setData({ feedback: null, screen: null, stepMarks: null })
    this.apply(challenge)
    if (justDone) {
      this.setData({ celebrate: true })
      if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
    }
  },

  async retryGenerate() {
    if (this._retrying) return
    this._retrying = true
    try {
      const data = await retryAgentCourseChallenge(this.stageId)
      this._polls = 0
      this.apply(normalizeChallenge(data && data.challenge))
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

  openPractice() {
    wx.redirectTo({ url: `/learning/practice/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
