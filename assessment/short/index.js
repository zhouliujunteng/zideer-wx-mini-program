const assessment = require('../../services/assessment')

const ROUND_SECONDS = 30 * 60 // 每轮 30 分钟倒计时（仅作提醒，到时不强制交卷）

function fmt(sec) {
  sec = Math.max(0, Math.round(sec))
  const m = Math.floor(sec / 60), s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 提交后的报告在独立的报告页（assessment/report，设计稿 M17）：已提交的测评一律转过去。
function reportUrl(attemptId) { return `/assessment/report/index?attemptId=${encodeURIComponent(attemptId)}` }

// 视图模型：选项加 A/B/C/D 前缀与选中态。前缀用选项自己的字母（判分和解析页都按它），
// 题库里个别题的选项数组顺序是乱的，按下标编字母会和解析页对不上。
function buildOptionList(options, answer) {
  return (options || []).map((option, index) => ({
    ...option,
    key: `${/^[A-Z]$/.test(option.value) ? option.value : String.fromCharCode(65 + index)}、`,
    isSelected: option.value === answer
  }))
}

// 一道题的全部配图地址（题干 → 选项 → 解析），点开大图时放在同一组里左右滑动。
// 配图由测评动作流随题下发（后端表 k12_question_figure），地址是约两天有效的签名链接，不在本地保存。
function figureUrls(question) {
  if (!question) return []
  const groups = [question.figures].concat((question.options || []).map(option => option && option.figures), [question.explanationFigures])
  const urls = []
  groups.forEach(list => (list || []).forEach(figure => { if (figure && figure.url && urls.indexOf(figure.url) < 0) urls.push(figure.url) }))
  return urls
}

// 视图模型：按题生成进度分段（已答/当前/未答）；翻回已答过的题时，「当前」落在正在看的那一题
function buildSegments(answeredCount, total, position, hasCurrent) {
  const totalNumber = Math.max(0, Number(total) || 0)
  const answered = Math.max(0, Number(answeredCount) || 0)
  const segments = []
  for (let i = 0; i < totalNumber; i++) {
    segments.push({ id: i, segmentClass: hasCurrent && i === position ? 'is-current' : i < answered ? 'is-completed' : 'is-upcoming' })
  }
  return segments
}

// 翻到上一题前，把本题已用的时间和还没提交的选择记在本机：翻回来选项还在，提交时用时接着算。
function drafts(page) { return page.drafts || (page.drafts = {}) }
function stashQuestion(page) {
  const current = page.data.attempt && page.data.attempt.current
  if (!current) return
  const list = drafts(page), before = list[current.id] || { seconds: 0 }
  const seconds = page.questionShownAt ? (Date.now() - page.questionShownAt) / 1000 : 0
  list[current.id] = { answer: page.data.answer, seconds: before.seconds + seconds }
  page.questionShownAt = 0
}

Page({
  data: {
    // loading 只在需要换画面时为真（进入页面、切换测评）；skeleton 决定骨架画成列表还是题目。
    loading: true, skeleton: 'list', busy: false, failed: false, error: '', scopes: [], records: [],
    attempt: null, answer: '',
    countdown: '', countdownOver: false, roundLabel: '',
    // position：正在看本轮第几题（0 起）；revisiting：翻回了已答过的题，savedAnswer 是这道题保存过的答案（跳过为空）
    segments: [], currentNumber: 0, optionList: [], position: 0, revisiting: false, savedAnswer: '',
    failedFigures: [],
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
    this.questionShownAt = 0
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
  // 回到页面时静默刷新：读到过一次就保留当前画面，不再换成骨架
  onShow() { this.visible = true; this.loadPage(true) },
  onHide() { stashQuestion(this); this.visible = false; this.requestVersion++; this.setData({ busy: false }); this.stopTimer() },
  onUnload() { this.requestVersion++; this.stopTimer() },

  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null } },
  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (!this.visible) return
      this.countdownLeft--
      if (this.countdownLeft <= 0) { this.countdownLeft = 0; this.stopTimer() }
      this.setData({ countdown: fmt(this.countdownLeft), countdownOver: this.countdownLeft <= 0 })
    }, 1000)
  },

  handleBack() {
    if (!this.data.attempt) {
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

  async loadPage(quiet) {
    const version = ++this.requestVersion
    const silent = quiet === true && this.loaded
    this.setData(silent ? { failed: false, error: '' } : { loading: true, skeleton: this.attemptId ? 'attempt' : 'list', failed: false, error: '' })
    try {
      if (this.attemptId) {
        // 静默刷新停在正在看的那道题：翻回去改答案时不跳回最新一题
        const shown = this.data.attempt, payload = { attemptId: this.attemptId }
        if (silent && shown && shown.status === 'draft' && String(shown.id) === String(this.attemptId)) payload.position = this.data.position
        const result = await assessment.call('read', payload)
        if (version === this.requestVersion) { this.loaded = true; this.showAttempt(result.attempt) }
      } else {
        const result = await assessment.call('catalog', { subject: this.options.subjectKey || '' })
        if (version !== this.requestVersion) return
        this.loaded = true
        // 各范围做完的卷（entry.history）：做完的记录标上「比上次 +X 分」（2026-10-06）
        const histories = {}
        result.scopes.forEach(s => { histories[String(s.id)] = s.entry && s.entry.history })
        this.setData({
          scopes: result.scopes.filter(s => !this.options.scopeId || String(s.id) === String(this.options.scopeId)).map(s => ({ ...s, ...assessment.entryView(s), mode: s.entry && s.entry.mode, attemptId: s.entry && s.entry.attemptId })),
          records: result.attempts.filter(a => (!this.options.subjectKey || (a.scope_snapshot || {}).subject === this.options.subjectKey) && (!this.options.scopeId || String(a.exam_scope_id) === String(this.options.scopeId))).map(a => ({
            ...a,
            ...(a.status === 'submitted' && a.paperCount > 1 ? assessment.historyChange(histories[String(a.exam_scope_id)], a.id) : { deltaLabel: '', deltaTone: '' }),
            name: ((a.scope_snapshot || {}).name || '测评记录') + (a.paperCount > 1 ? ` · 第 ${a.paperNumber} 次` : ''),
            statusLabel: a.status === 'submitted' ? '查看报告' : a.status === 'draft' ? '继续作答' : `已完成 ${a.completedRounds}/${a.roundCount} 轮`
          }))
        })
      }
    } catch (e) {
      if (version !== this.requestVersion) return
      // 静默刷新失败：画面上的内容仍然有效，只提示一下
      if (silent) wx.showToast({ title: e.message || '刷新失败，请稍后重试', icon: 'none' })
      else this.setData({ failed: !this.data.scopes.length && !this.data.attempt, error: e.message, grantRequired: false })
    }
    finally { if (version === this.requestVersion) this.setData({ loading: false }) }
  },

  showAttempt(attempt) {
    // 已提交（本轮报告已生成）：换到报告页，答题页不再显示这次测评
    if (attempt.status === 'submitted') { this.stopTimer(); wx.redirectTo({ url: reportUrl(attempt.id) }); return }
    this.attemptId = attempt.id
    // 每轮一条记录：换轮（换记录）时按服务端记录的本轮开始时间计算剩余时间，退出再进来也连续。
    if (attempt.status === 'draft' && attempt.current && this.roundKey !== attempt.id) {
      this.roundKey = attempt.id
      const started = Date.parse(attempt.roundStartedAt || '')
      const limit = Number(attempt.roundLimitSeconds) || ROUND_SECONDS
      this.countdownLeft = Number.isFinite(started) ? Math.max(0, limit - Math.floor((Date.now() - started) / 1000)) : limit
    }
    const drafting = attempt.status === 'draft'
    const answering = drafting && attempt.current
    const current = answering ? attempt.current : null
    // 服务端没给 position（旧版动作流）时就是第一道没答的题
    const position = !drafting ? 0 : Number.isInteger(attempt.position) ? attempt.position : attempt.answeredCount
    const revisiting = Boolean(current && current.answered)
    const savedAnswer = revisiting ? current.selected || '' : ''
    // 后台刷新回来还是同一道题：保留已选答案和计时起点，不能把学生刚点的选项清掉。
    const shown = this.data.attempt
    if (!shown || shown.id !== attempt.id) this.drafts = {}
    const sameQuestion = Boolean(answering && shown && shown.id === attempt.id && shown.current && String(shown.current.id) === String(current.id))
    // 翻回已答过的题：选项停在保存过的答案上；还没答的题：恢复翻走前点选的选项
    const draft = current && !revisiting ? drafts(this)[current.id] : null
    const answer = sameQuestion ? this.data.answer : revisiting ? savedAnswer : draft ? draft.answer : ''
    if (answering && (!sameQuestion || !this.questionShownAt)) this.questionShownAt = Date.now()
    this.setData({
      attempt,
      answer,
      position,
      revisiting,
      savedAnswer,
      optionList: answering ? buildOptionList(current.options, answer) : [],
      segments: drafting ? buildSegments(attempt.answeredCount, attempt.totalQuestions, position, Boolean(answering)) : [],
      currentNumber: answering ? position + 1 : drafting ? attempt.totalQuestions || 0 : 0,
      countdown: answering ? fmt(this.countdownLeft) : '',
      countdownOver: answering && this.countdownLeft <= 0,
      roundLabel: attempt.roundCount > 1 ? `第 ${attempt.round || attempt.roundIndex + 1} 轮 / 共 ${attempt.roundCount} 轮` : ''
    })
    if (answering) this.startTimer()
    else this.stopTimer()
  },

  async start(event) {
    if (this.data.busy) return
    const { id, mode, attemptId } = event.currentTarget.dataset
    if (mode === 'report' && attemptId) { wx.navigateTo({ url: reportUrl(attemptId) }); return }
    if (mode === 'resume' && attemptId) { this.attemptId = attemptId; this.loadPage(); return }
    if (mode === 'unavailable') return
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '', grantRequired: false })
    try {
      const result = await assessment.call('start', { scopeId: id })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) { this.setData({ busy: false }); if (this.visible && this.data.attempt && this.data.attempt.current && !this.questionShownAt) this.questionShownAt = Date.now() } }
  },

  // 再测一次（2026-10-03）：做完整张卷后在同一范围开一张新卷，以前的报告保留在测评记录里。
  retake(event) {
    if (this.data.busy) return
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '再测一次',
      content: '会重新出一套题，优先出上次没做过的题。上次的报告会保留，可以在测评记录里查看。',
      confirmText: '开始',
      confirmColor: '#FD7C02',
      success: (res) => { if (res.confirm) this.startRetake(id) }
    })
  },
  async startRetake(id) {
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '', grantRequired: false })
    try {
      const result = await assessment.call('start', { scopeId: id, retake: true })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) { this.setData({ busy: false }); if (this.visible && this.data.attempt && this.data.attempt.current && !this.questionShownAt) this.questionShownAt = Date.now() } }
  },

  // 测评记录：没做完的接着作答；做完了的（整卷完成或已交的某一轮）看报告
  resume(event) {
    const { id, status } = event.currentTarget.dataset
    if (status && status !== 'draft') { wx.navigateTo({ url: reportUrl(id) }); return }
    this.attemptId = id
    this.loadPage()
  },
  select(event) {
    if (this.data.busy) return
    const value = event.currentTarget.dataset.value
    this.setData({ answer: value, optionList: this.data.optionList.map(o => ({ ...o, isSelected: o.value === value })) })
  },

  // 提交本题并看下一题。翻回来的题：改了答案就保存修改（以最后一次为准），没改就直接往后翻，跳过的题照旧算跳过。
  async next(event) {
    const a = this.data.attempt
    if (this.data.busy || !a || !a.current) return
    const skip = event.currentTarget.dataset.skip === 'yes'
    const unchanged = !skip && Boolean(a.current.answered) && this.data.answer === (a.current.selected || '')
    if (!skip && !unchanged && !this.data.answer.trim()) { this.setData({ error: '请选择一个答案，或点“暂时不会”跳过。' }); return }
    stashQuestion(this)
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '' })
    try {
      const draft = drafts(this)[a.current.id]
      const elapsed = this.questionShownAt ? (Date.now() - this.questionShownAt) / 1000 : null
      const secondsUsed = elapsed == null && !draft ? null : Math.round((elapsed || 0) + (draft ? draft.seconds : 0))
      const result = await assessment.call('answer', { attemptId: a.id, revision: a.revision, questionId: a.current.id, answer: skip ? '' : this.data.answer, secondsUsed, timingMethod: 'foreground-v1' })
      delete drafts(this)[a.current.id]
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) { this.setData({ busy: false }); if (this.visible && this.data.attempt && this.data.attempt.current && !this.questionShownAt) this.questionShownAt = Date.now() } }
  },

  // 上一题：翻回已答过的题，看得到自己选的答案，可以重新选择。本轮提交前都能改。
  async previous() {
    const a = this.data.attempt
    if (this.data.busy || !a || a.status !== 'draft' || !(this.data.position > 0)) return
    stashQuestion(this)
    const version = ++this.requestVersion
    this.setData({ busy: true, error: '' })
    try {
      const result = await assessment.call('read', { attemptId: a.id, position: this.data.position - 1 })
      if (version === this.requestVersion) this.showAttempt(result.attempt)
    } catch (e) { if (version === this.requestVersion) this.setData({ error: e.message }) }
    finally { if (version === this.requestVersion) { this.setData({ busy: false }); if (this.visible && this.data.attempt && this.data.attempt.current && !this.questionShownAt) this.questionShownAt = Date.now() } }
  },

  submit() {
    if (this.data.busy || !this.data.attempt || !this.data.attempt.answeredCount) return
    if (this.data.attempt.current) {
      const { id, totalQuestions, answeredCount } = this.data.attempt
      const left = Math.max(0, (totalQuestions || 0) - (answeredCount || 0))
      wx.showModal({ title: '提前结束本轮？', content: `本轮还有 ${left} 题未作答，结束后按未答对计入，并生成掌握报告。`, confirmText: '结束本轮', cancelText: '继续作答', success: r => { if (r.confirm && this.visible && this.data.attempt && this.data.attempt.id === id) this.finish() } })
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
    finally { if (version === this.requestVersion) { this.setData({ busy: false }); if (this.visible && this.data.attempt && this.data.attempt.current && !this.questionShownAt) this.questionShownAt = Date.now() } }
  },

  // 配图点开看大图：同一道题的配图放在一组里左右滑动。
  previewFigure(event) {
    const { url } = event.currentTarget.dataset
    if (!url) return
    const urls = figureUrls(this.data.attempt && this.data.attempt.current)
    wx.previewImage({ current: url, urls: urls.length ? urls : [url] })
  },
  // 配图没加载出来（签名过期、网络断开）：换成提示，点一下静默重读测评，拿到新的图片地址。
  figureFailed(event) {
    const url = event.currentTarget.dataset.url
    if (!url || this.data.failedFigures.indexOf(url) >= 0) return
    this.setData({ failedFigures: this.data.failedFigures.concat(url) })
  },
  retryFigures() {
    this.setData({ failedFigures: [] })
    this.loadPage(true)
  },
  backToList() { this.attemptId = ''; this.roundKey = null; this.drafts = {}; this.stopTimer(); this.setData({ attempt: null, countdown: '', countdownOver: false, roundLabel: '', segments: [], currentNumber: 0, optionList: [], position: 0, revisiting: false, savedAnswer: '', failedFigures: [] }); this.loadPage() }
})
