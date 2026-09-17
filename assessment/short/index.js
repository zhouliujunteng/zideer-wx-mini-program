const assessment = require('../../services/assessment')

const ROUND_SECONDS = 30 * 60 // 每轮 30 分钟倒计时

function fmt(sec) {
  sec = Math.max(0, sec)
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 视图模型：选项加 A/B/C/D 前缀与选中态
function buildOptionList(options, answer) {
  return (options || []).map((option, index) => ({
    ...option,
    key: `${String.fromCharCode(65 + index)}、`,
    isSelected: option.value === answer
  }))
}

// 视图模型：按题生成进度分段（已答/当前/未答）
function buildSegments(answeredCount, total, hasCurrent) {
  const totalNumber = Math.max(0, Number(total) || 0)
  const answered = Math.max(0, Number(answeredCount) || 0)
  const segments = []
  for (let i = 0; i < totalNumber; i++) {
    segments.push({ id: i, segmentClass: i < answered ? 'is-completed' : hasCurrent && i === answered ? 'is-current' : 'is-upcoming' })
  }
  return segments
}

Page({
  data: {
    loading: true, busy: false, failed: false, error: '', scopes: [], records: [],
    attempt: null, report: null, answer: '',
    countdown: '', roundLabel: '',
    segments: [], currentNumber: 0, optionList: [],
    grantRequired: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80
  },
  onLoad(options) {
    this.options = options || {}
    this.attemptId = this.options.attemptId || ''
    this.requestVersion = 0
    this.timer = null
    this.countdownLeft = ROUND_SECONDS
    this.roundKey = null
    // 自定义顶栏需要的安全区尺寸（环境不提供时保持默认，保证测试与低版本基础库可用）
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18
    })
  },
  onShow() { this.visible = true; this.loadPage() },
  onHide() { this.visible = false; this.requestVersion++; this.setData({ busy: false }); this.stopTimer() },
  onUnload() { this.requestVersion++; this.stopTimer() },

  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null } },
  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (!this.visible) return
      this.countdownLeft--
      if (this.countdownLeft <= 0) { this.countdownLeft = 0; this.stopTimer() }
      this.setData({ countdown: fmt(this.countdownLeft) })
    }, 1000)
  },

  handleBack() {
    if (this.data.report || !this.data.attempt) {
      this.backToList()
      const pages = getCurrentPages()
      if (pages.length > 1) { wx.navigateBack({ delta: 1 }); return }
      wx.switchTab({ url: '/pages/home/index' })
      return
    }
    const id = this.data.attempt.id
    wx.showModal({
      title: '离开本次测评？', content: '已提交的答案会保留，稍后可从测评列表继续。', confirmText: '继续离开', cancelText: '继续作答',
      success: r => { if (r.confirm && this.visible && this.data.attempt && this.data.attempt.id === id) { const pages = getCurrentPages(); if (pages.length > 1) { wx.navigateBack({ delta: 1 }) } else { this.backToList() } } }
    })
  },

  async loadPage() {
    const version = ++this.requestVersion
    this.setData({ loading: true, failed: false, error: '' })
    try {
      if (this.attemptId) {
        const result = await assessment.call('read', { attemptId: this.attemptId })
        if (version === this.requestVersion) this.showAttempt(result.attempt)
      } else {
        const result = await assessment.call('catalog', { subject: this.options.subjectKey || '' })
        if (version === this.requestVersion) this.setData({
          scopes: result.scopes.filter(s => !this.options.scopeId || String(s.id) === String(this.options.scopeId)).map(s => ({ ...s, actionLabel: s.entry && s.entry.mode === 'resume' ? '继续测评' : s.entry && s.entry.mode === 'report' ? '查看报告' : '免费开始测评' })),
          records: result.attempts.filter(a => (!this.options.subjectKey || a.scope_snapshot.subject === this.options.subjectKey) && (!this.options.scopeId || String(a.exam_scope_id) === String(this.options.scopeId))).map(a => ({ ...a, name: a.scope_snapshot.name, statusLabel: a.status === 'submitted' ? '查看报告' : '继续作答' }))
        })
      }
    } catch (e) { if (version === this.requestVersion) this.setData({ failed: !this.data.scopes.length && !this.data.attempt, error: e.message, grantRequired: false }) }
    finally { if (version === this.requestVersion) this.setData({ loading: false }) }
  },

  showAttempt(attempt) {
    this.attemptId = attempt.id
    // 轮切换时重置倒计时
    if (attempt.status === 'draft' && attempt.current && this.roundKey !== attempt.roundIndex) {
      this.roundKey = attempt.roundIndex
      this.countdownLeft = ROUND_SECONDS
    }
    const answering = attempt.status === 'draft' && attempt.current
    this.setData({
      attempt,
      report: assessment.reportView(attempt.report),
      answer: '',
      optionList: answering ? buildOptionList(attempt.current.options, '') : [],
      segments: answering ? buildSegments(attempt.answeredCount, attempt.totalQuestions, true) : [],
      currentNumber: answering ? attempt.answeredCount + 1 : 0,
      countdown: answering ? fmt(this.countdownLeft) : '',
      roundLabel: attempt.roundCount > 1 ? `第 ${attempt.roundIndex + 1} 轮 / 共 ${attempt.roundCount} 轮` : ''
    })
    if (answering) this.startTimer()
    else this.stopTimer()
  },

  async start(event) {
    if (this.data.busy) return
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '', grantRequired: false })
    try {
      const result = await assessment.call('start', { scopeId: event.currentTarget.dataset.id })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) this.setData({ busy: false }) }
  },

  resume(event) { this.attemptId = event.currentTarget.dataset.id; this.loadPage() },
  select(event) {
    if (this.data.busy) return
    const value = event.currentTarget.dataset.value
    this.setData({ answer: value, optionList: this.data.optionList.map(o => ({ ...o, isSelected: o.value === value })) })
  },

  async next(event) {
    const a = this.data.attempt
    if (this.data.busy || !a || !a.current) return
    const skip = event.currentTarget.dataset.skip === 'yes'
    if (!skip && !this.data.answer.trim()) { this.setData({ error: '请选择一个答案，或点“暂时不会”跳过。' }); return }
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '' })
    try {
      const result = await assessment.call('answer', { attemptId: a.id, revision: a.revision, questionId: a.current.id, answer: skip ? '' : this.data.answer })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) this.setData({ busy: false }) }
  },

  submit() {
    if (this.data.busy || !this.data.attempt || !this.data.attempt.answeredCount) return
    if (this.data.attempt.current) {
      const id = this.data.attempt.id
      wx.showModal({ title: '结束本次测评？', content: '将根据已保存的答案生成掌握报告，未测知识点保持待测。', confirmText: '生成报告', success: r => { if (r.confirm && this.visible && this.data.attempt && this.data.attempt.id === id) this.finish() } })
    } else this.finish()
  },

  async finish() {
    if (this.data.busy) return
    const a = this.data.attempt, version = ++this.requestVersion
    this.setData({ busy: true, error: '' })
    try {
      const result = await assessment.call('submit', { attemptId: a.id, revision: a.revision })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) this.setData({ busy: false }) }
  },

  openMap() { wx.switchTab({ url: '/pages/knowledge-map/index' }) },
  openTopic(event) { wx.navigateTo({ url: `/diagnosis/topic/index?topicId=${encodeURIComponent(event.currentTarget.dataset.id)}` }) },
  backToList() { this.attemptId = ''; this.roundKey = null; this.stopTimer(); this.setData({ attempt: null, report: null, countdown: '', roundLabel: '', segments: [], currentNumber: 0, optionList: [] }); this.loadPage() }
})
