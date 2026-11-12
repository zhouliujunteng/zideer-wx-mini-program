const {
  TOOL_PAGES, loadScoreToolQuota, uploadQuestionPhoto, startRecognition, loadQuestion, confirmQuestion,
  startScoreToolRun, loadScoreToolRun, answerPractice
} = require('../../services/score-tools')
const { decorateRunResult } = require('../../utils/score-tool-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { textareaHeightRpx } = require('../../utils/textarea-height')

// 首页 AI 提分工具的工具页（审题拆解、错因诊断……共用一页，按 ?tool= 区分）。方案 ../docs/AI提分工具适配方案.md。
// 步骤：capture 拍题 → recognizing 识别中 → confirm 选题改字 → running 分析中 → result 结果。
// 也能直接打开：?runId= 看一条记录的结果；?tool=&questionId= 拿已确认的题换个工具分析（审题完接着做错因诊断）；
// 再带 &fromRunId= 时把那次分析的结果接力过去（错因诊断 → 举一反三，易错题对着错因出）。
// 举一反三的结果页是练习：选项 / 填空交给服务端判，交了才显示答案和解析。
// ui-ref 没有这几页的设计稿，样式照 AI 海报页（agent/ai-poster）那套：自定义顶栏、#FAFAFA 底、白色大圆角卡片、主题橙。

const MAX_PHOTOS = 3
const POLL_INTERVAL_MS = 3000
const POLL_LIMIT_MS = 6 * 60 * 1000

// 题目、作答输入框的高度按文字量算（auto-height 遇到长题会把高度算大几倍）。
// 内容区宽 = 750 − 页边距 64 − 卡片内边距 56 − 输入框内边距 44；字号、行高、内边距同 .st-textarea。
const TEXTAREA_FIT = { widthRpx: 586, fontRpx: 27, lineHeight: 1.7, paddingRpx: 40, maxRpx: 1400 }
const stemHeight = (stem) => textareaHeightRpx(stem, { ...TEXTAREA_FIT, minRpx: 260 })
const answerHeight = (answer) => textareaHeightRpx(answer, { ...TEXTAREA_FIT, minRpx: 160 })

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    historyTop: 26,
    historyLeft: 300,
    historyButtonSize: 32,
    tool: '',
    page: { title: '', intro: '', inputs: [], needsAnswer: false },
    // 次数第一次读到前只画骨架（首页规则：不先显示默认值）
    quotaLoaded: false,
    quota: { freeRemaining: 0, freeDaily: 3, price: 0 },
    step: 'capture',
    loadingRun: false,
    loadFailed: '',
    photos: [],
    busy: false,
    question: null,
    selectedIndex: 0,
    stem: '',
    studentAnswer: '',
    stemHeight: 260,
    answerHeight: 160,
    inputValues: {},
    run: null,
    view: null,
    // 举一反三：每道题还没交的答案（index → 选项字母或填空文字）、正在交的那道
    practiceDraft: {},
    practiceBusy: -1,
    // 错因诊断的「正确做法」默认收起：先自己按提示改，再展开对答案
    referenceOpen: false
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const statusBarHeight = Number.isFinite(windowInfo.statusBarHeight) ? windowInfo.statusBarHeight : 20
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: statusBarHeight + 6, height: 32 }
    const menuTop = Number.isFinite(menuButton.top) ? menuButton.top : statusBarHeight + 6
    const menuHeight = Number.isFinite(menuButton.height) ? menuButton.height : 32
    const menuLeft = Number.isFinite(menuButton.left) ? menuButton.left : windowWidth - 92
    const navigationBarHeight = menuHeight + (menuTop - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 12,
      // 胶囊位置只在这里读一次（转屏时读到的可能是旧值），记录按钮贴在胶囊左边。
      // 用胶囊左边算 left，不用「窗口宽 - 胶囊左边」算 right：横屏打开时窗口宽可能还是竖屏的值，按钮会跑出屏幕
      historyTop: menuTop,
      historyLeft: menuLeft - 8 - menuHeight,
      historyButtonSize: menuHeight
    })
    if (/^[a-f0-9]{32}$/.test(String(options.runId || ''))) return this.openRun(options.runId)
    this._fromRunId = /^[a-f0-9]{32}$/.test(String(options.fromRunId || '')) ? options.fromRunId : ''
    this.useTool(String(options.tool || ''))
    if (/^[a-f0-9]{32}$/.test(String(options.questionId || ''))) this.reuseQuestion(options.questionId)
  },

  onShow() {
    this._hidden = false
    if (this.data.tool && this.data.step !== 'result') this.loadQuota()
    this.resumePolling()
  },

  onHide() {
    this._hidden = true
    this.stopPolling()
  },

  onUnload() {
    this._hidden = true
    this._left = true
    this.stopPolling()
    if (this._leaveTimer) clearTimeout(this._leaveTimer)
  },

  useTool(tool) {
    const page = TOOL_PAGES[tool]
    if (!page) {
      wx.showToast({ title: '这个工具即将上线', icon: 'none' })
      this._leaveTimer = setTimeout(() => {
        this._leaveTimer = null
        if (!this._left) this.handleBack()
      }, 800)
      return
    }
    const inputValues = {}
    for (const input of page.inputs) inputValues[input.key] = ''
    this.setData({ tool, page, inputValues })
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: page.title })
  },

  async loadQuota() {
    try {
      const quota = await loadScoreToolQuota()
      const tool = quota.tools.find((item) => item.id === this.data.tool)
      this.setData({
        quotaLoaded: true,
        quota: { freeRemaining: tool ? tool.freeRemaining : 0, freeDaily: quota.freeDaily, price: quota.price }
      })
    } catch (error) {
      // 次数读不到不挡着用：发起分析时服务端会再判断一次
      if (!this.data.quotaLoaded) this.setData({ quotaLoaded: true, quota: { ...this.data.quota, freeRemaining: -1 } })
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/home/index' })
  },

  openHistory() {
    wx.navigateTo({ url: '/score-tools/history/index' })
  },

  // ---- 拍题 ----

  choosePhotos() {
    const room = MAX_PHOTOS - this.data.photos.length
    if (room <= 0 || this.data.busy) return
    wx.chooseMedia({
      count: room,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: (result) => {
        const added = (result.tempFiles || []).map((file) => ({ path: file.tempFilePath })).filter((file) => file.path)
        this.setData({ photos: [...this.data.photos, ...added].slice(0, MAX_PHOTOS) })
      }
    })
  },

  previewPhoto(e) {
    const urls = this.data.photos.map((photo) => photo.path)
    wx.previewImage({ urls, current: urls[Number(e.currentTarget.dataset.index) || 0] })
  },

  removePhoto(e) {
    if (this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ photos: this.data.photos.filter((_, i) => i !== index) })
  },

  async recognize() {
    if (!this.data.photos.length || this.data.busy) return
    this.setData({ busy: true })
    try {
      const uploadIds = []
      for (const photo of this.data.photos) uploadIds.push(await uploadQuestionPhoto(photo.path))
      const question = await startRecognition(uploadIds)
      this.setData({ step: 'recognizing', question })
      this.startPolling(() => this.pollQuestion(question.id))
    } catch (error) {
      wx.showToast({ title: error.message || '上传失败，请重试', icon: 'none' })
    } finally {
      this.setData({ busy: false })
    }
  },

  async pollQuestion(id) {
    const question = await loadQuestion(id)
    if (question.status === 'recognizing') return false
    this.applyQuestion(question)
    return true
  },

  applyQuestion(question) {
    if (question.status !== 'ready') {
      this.setData({ step: 'capture', question })
      return
    }
    const selected = question.confirmed ? null : question.questions[0]
    const stem = selected ? selected.stem : question.stem
    const studentAnswer = selected ? selected.studentAnswer : question.studentAnswer
    this.setData({
      step: 'confirm',
      question,
      selectedIndex: question.selectedIndex,
      stem,
      studentAnswer,
      stemHeight: stemHeight(stem),
      answerHeight: answerHeight(studentAnswer)
    })
  },

  async reuseQuestion(id) {
    this.setData({ step: 'recognizing' })
    try {
      this.applyQuestion(await loadQuestion(id))
    } catch (error) {
      this.setData({ step: 'capture' })
      wx.showToast({ title: error.message || '题目读取失败，请重新拍照', icon: 'none' })
    }
  },

  retake() {
    this.stopPolling()
    this.setData({ step: 'capture', photos: [], question: null, run: null, view: null, stem: '', studentAnswer: '' })
  },

  // ---- 确认 ----

  pickQuestion(e) {
    const index = Number(e.currentTarget.dataset.index)
    const picked = this.data.question && this.data.question.questions[index]
    if (!picked || index === this.data.selectedIndex) return
    this.setData({
      selectedIndex: index,
      stem: picked.stem,
      studentAnswer: picked.studentAnswer,
      stemHeight: stemHeight(picked.stem),
      answerHeight: answerHeight(picked.studentAnswer)
    })
  },

  handleStemInput(e) {
    this.setData({ stem: e.detail.value, stemHeight: stemHeight(e.detail.value) })
  },

  handleAnswerInput(e) {
    this.setData({ studentAnswer: e.detail.value, answerHeight: answerHeight(e.detail.value) })
  },

  handleExtraInput(e) {
    this.setData({ [`inputValues.${e.currentTarget.dataset.key}`]: e.detail.value })
  },

  async submitRun(acceptCharge = false) {
    if (this.data.busy) return
    const { tool, page, question, selectedIndex, stem, studentAnswer, inputValues } = this.data
    if (!stem.trim()) return wx.showToast({ title: '题目文字不能为空', icon: 'none' })
    if (page.needsAnswer && !studentAnswer.trim()) return wx.showToast({ title: '请把你的作答也填上', icon: 'none' })
    this.setData({ busy: true })
    let run
    try {
      await confirmQuestion({ id: question.id, selectedIndex, stem, studentAnswer })
      const input = this._fromRunId ? { ...inputValues, fromRunId: this._fromRunId } : inputValues
      run = await startScoreToolRun({ tool, questionId: question.id, input, acceptCharge: acceptCharge === true })
    } catch (error) {
      // 先放开按钮再处理：确认扣积分后要立刻带 acceptCharge 重发
      this.setData({ busy: false })
      this.handleRunRefused(error)
      return
    }
    this.setData({ busy: false, step: 'running', run, view: null })
    this.startPolling(() => this.pollRun(run.id))
  },

  // 超出免费次数（用户 10-08）：会员确认后扣积分；余额不够、非会员说明原因。
  handleRunRefused(error) {
    if (error.code === 'CHARGE_CONFIRM_REQUIRED') {
      wx.showModal({
        title: '今天的免费次数用完了',
        content: `这次分析将扣除 ${error.price} 积分，分析成功才扣，没分析好不扣。`,
        confirmText: '继续',
        confirmColor: '#FD7C02',
        success: (result) => { if (result.confirm) this.submitRun(true) }
      })
      return
    }
    if (error.code === 'INSUFFICIENT_CREDITS') {
      wx.showModal({ title: '积分不够了', content: `这次需要 ${error.price} 积分，你现在有 ${error.available} 积分。`, showCancel: false, confirmColor: '#FD7C02' })
      return
    }
    if (error.code === 'DAILY_LIMIT') {
      wx.showModal({ title: '今天的免费次数用完了', content: `每个工具每天可以免费用 ${this.data.quota.freeDaily} 次，明天再来吧。会员超出后可以用积分继续。`, showCancel: false, confirmColor: '#FD7C02' })
      this.loadQuota()
      return
    }
    wx.showToast({ title: error.message || '分析没有开始，请重试', icon: 'none' })
  },

  // ---- 分析与结果 ----

  async pollRun(id) {
    const run = await loadScoreToolRun(id)
    if (run.pending) return false
    this.showRun(run)
    if (this.data.tool) this.loadQuota()
    return true
  },

  showRun(run) {
    this.setData({ step: 'result', run, view: run.status === 'succeeded' ? decorateRunResult(run) : null, practiceDraft: {}, practiceBusy: -1, referenceOpen: false })
  },

  async openRun(id) {
    this._openRunId = id
    this.setData({ step: 'result', loadingRun: true, loadFailed: '' })
    try {
      const run = await loadScoreToolRun(id)
      if (TOOL_PAGES[run.tool]) this.useTool(run.tool)
      this.setData({ loadingRun: false })
      if (run.pending) {
        this.setData({ step: 'running', run })
        this.startPolling(() => this.pollRun(run.id))
      } else this.showRun(run)
    } catch (error) {
      this.setData({ loadingRun: false, loadFailed: error.message || '记录读取失败，请稍后重试。' })
    }
  },

  retryOpenRun() {
    const id = this._openRunId
    if (id) this.openRun(id)
  },

  // 结果页：同一道题再跑一次（失败时）、换个工具看这道题、再拍一题
  retryRun() {
    this.setData({ step: 'confirm' })
  },

  // data-relay：把这次分析的结果带过去（错因诊断 → 举一反三）
  switchTool(e) {
    const tool = String(e.currentTarget.dataset.tool || '')
    const run = this.data.run
    if (!TOOL_PAGES[tool] || !run) return
    const relay = e.currentTarget.dataset.relay ? `&fromRunId=${run.id}` : ''
    wx.redirectTo({ url: `/score-tools/tool/index?tool=${tool}&questionId=${run.questionId}${relay}` })
  },

  toggleReference() {
    this.setData({ referenceOpen: !this.data.referenceOpen })
  },

  // ---- 举一反三：做题 ----

  pickOption(e) {
    const { index, letter } = e.currentTarget.dataset
    const question = this.data.view && this.data.view.questions.find((q) => q.index === Number(index))
    if (!question || question.answered) return
    this.setData({ [`practiceDraft.${index}`]: String(letter) })
  },

  handleFillInput(e) {
    this.setData({ [`practiceDraft.${e.currentTarget.dataset.index}`]: e.detail.value })
  },

  async submitPractice(e) {
    const index = Number(e.currentTarget.dataset.index)
    const answer = String(this.data.practiceDraft[index] || '').trim()
    const run = this.data.run
    if (!run || this.data.practiceBusy >= 0) return
    if (!answer) return wx.showToast({ title: '先选一个答案或填上答案', icon: 'none' })
    this.setData({ practiceBusy: index })
    try {
      const updated = await answerPractice({ id: run.id, index, answer })
      const draft = this.data.practiceDraft
      this.setData({ run: updated, view: decorateRunResult(updated), practiceBusy: -1, practiceDraft: draft })
    } catch (error) {
      this.setData({ practiceBusy: -1 })
      wx.showToast({ title: error.message || '没交上，请重试', icon: 'none' })
    }
  },

  // ---- 轮询 ----

  startPolling(step) {
    this.stopPolling()
    this._poll = { step, startedAt: Date.now() }
    this.scheduleTick(0)
  },

  scheduleTick(delay) {
    clearTimeout(this._pollTimer)
    this._pollTimer = setTimeout(() => this.tick(), delay)
  },

  async tick() {
    const poll = this._poll
    if (!poll || this._hidden) return
    if (Date.now() - poll.startedAt > POLL_LIMIT_MS) {
      this.stopPolling()
      wx.showToast({ title: '时间有点长，稍后在「提分记录」里查看', icon: 'none' })
      return
    }
    try {
      if (await poll.step()) {
        if (this._poll === poll) this._poll = null
        return
      }
    } catch (error) {
      // 偶尔读失败不打断，下一轮再读
    }
    if (this._poll === poll) this.scheduleTick(POLL_INTERVAL_MS)
  },

  resumePolling() {
    if (this._poll) this.scheduleTick(0)
  },

  stopPolling() {
    clearTimeout(this._pollTimer)
    this._pollTimer = null
    if (this._hidden) return
    this._poll = null
  },

  noop() {}
})
