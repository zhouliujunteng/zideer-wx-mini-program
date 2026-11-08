const { loadAgentCourseReview, checkAgentCourseReviewAnswer, submitAgentCourseReview } = require('../../services/identity')
const { loadCheckin } = require('../../services/learning-streak')
const { attachUiAssets } = require('../../services/ui-assets')
const { getNavigationMetrics } = require('../../utils/navigation')
const {
  VOICE_LONG_PRESS_DELAY,
  AUDIO_VISUALIZER_INTERVAL,
  VOICE_MIN_BYTES,
  VOICE_MAX_BYTES,
  RECORDER_OPTIONS,
  VOICE_BARS,
  createVoiceBars,
  createFallbackVoiceBars,
  createPcmLevelMeter,
  voiceByteLength,
  getRecorderBridge,
  transcribeVoiceChunks
} = require('../../utils/voice-input')

// 间隔复习小测（课程服务 lib/course/review-service.ts，2026-10-08 用户规则）：
// 学完一节课后按遗忘规律到期复习：不看课程、凭记忆回答 2～3 个问题，交卷后由独立考官只看要点和学生的回答判分，
// 按结果排下一次复习；做完算当天打卡（回包带 checkin 时弹「今日打卡完成」）。
//
// 版式与复述验收页（learning/agent-acceptance）同一套：问题是左边的气泡，默认「按住说话」，也能打字。
// 题目一次取回、逐题显示，答完最后一题才交卷；中途离开不保存，下次进来从第一题重答。
const MAX_ANSWER = 1000
// 记录列表底部留白 = 输入框离底边的距离 + 输入框本身连同上下留白的高度（与直播间记录同一个数）
const LIST_BOTTOM_GAP = 112
// 一段话最多录约 60 秒（VOICE_MAX_BYTES，16kHz × 2 字节）：最后 10 秒提示还能说几秒，到点自动当松手发出
const VOICE_BYTES_PER_SECOND = 32000
const VOICE_COUNTDOWN_SECONDS = 10
// 与直播间记录同一招：scroll-top 给一个远大于记录高度的值，由 scroll-view 夹到真实底部；每次 +1 才会再滚
const BOTTOM_SCROLL_REQUEST = 1000000

// 读取时这两种不算失败：给说明，不给「重试」
const NOTICE = {
  REVIEW_NOT_DUE: '这节课还没到复习的日子，到时会出现在「学习任务」里。',
  REVIEW_NOT_FOUND: '这节课学完以后才会安排复习。'
}

function dayText(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  return match ? `${Number(match[2])} 月 ${Number(match[3])} 日` : ''
}

// 交卷后接在最后一条后面的结论卡片
function resultCard(result) {
  if (!result) return null
  const next = dayText(result.nextDueDay)
  return {
    title: result.passed ? '复习完成，记得很牢' : '复习完成，有几处要再巩固',
    copy: `这次评为「${result.ratingText}」${next ? `，下次复习在 ${next}` : ''}。`,
    weakPoints: result.weakPoints || [],
    misconceptions: result.misconceptions || []
  }
}

// 已答的题和下一题按对话气泡排开；pending 是刚发出、还没算作答案的那句（没在答题、听不清、说想不起来），
// 后面跟一句老师的追问，学生选「重新回答」或「就这样算」（2026-10-08 用户要求：不能学生发什么就直接算答案）。
function buildTurns(questions, answers, pending) {
  const turns = []
  questions.forEach((question, index) => {
    if (index > answers.length) return
    turns.push({ id: `q${index}`, role: 'assistant', content: `第 ${index + 1} 题：${question}` })
    if (index < answers.length) turns.push({ id: `a${index}`, role: 'user', content: answers[index] || '（没答上来）' })
  })
  if (pending) {
    turns.push({ id: `p${answers.length}-user`, role: 'user', content: pending.answer })
    turns.push({ id: `p${answers.length}-nudge`, role: 'assistant', content: pending.reply })
  }
  return turns
}

function composerBottomOffset() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const safeArea = info.safeArea || {}
  const safeAreaBottom = Math.max(0, (info.screenHeight || info.windowHeight || 0) - (safeArea.bottom || info.windowHeight || 0))
  return Math.max(52, safeAreaBottom + 18)
}

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    notice: '',
    review: null,
    // intro 还没开始 / chat 答题中 / done 已交卷
    state: '',
    answers: [],
    // 刚发出、还没算作答案的一句：{ answer, reply }
    pending: null,
    result: null,
    turns: [],
    draft: '',
    sending: false,
    typingLabel: '',
    scrollTop: 0,
    checkinNotice: null,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    composerBottomOffset: 52,
    listBottomPadding: 52,
    // 复述为主：默认就是「按住说话」，要打字点左边的键盘
    voiceMode: true,
    voiceRecognizing: false,
    voiceCancel: false,
    voiceSoundActive: false,
    voiceBars: VOICE_BARS,
    voiceRemaining: 0,
    microphonePermission: 'unknown'
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    this.stageId = String(options.stageId || '')
    const navigation = getNavigationMetrics()
    const bottomOffset = composerBottomOffset()
    this.setData({
      statusBarHeight: navigation.statusBarHeight,
      navigationBarHeight: navigation.navigationBarHeight,
      contentTop: navigation.contentTop,
      composerBottomOffset: bottomOffset,
      listBottomPadding: bottomOffset
    })
    this._scrollRequest = 0
    this._voiceTimer = null
    this._voiceTouching = false
    this._voiceStartY = 0
    this._voiceCancel = false
    this._asrBusy = false
    this._asrChunks = []
    this._asrBytes = 0
    this._recorderSessionId = null
    this._recorderActive = false
    this._pcmLevelAvailable = false
    this._pcmLevelMeter = createPcmLevelMeter()
  },

  onShow() {
    this._isPageVisible = true
    const bridge = getRecorderBridge()
    if (bridge) bridge.attach(this)
    // 第一次进来读题；答题中回到页面不重读，免得把已经答的清掉
    if (!this.data.loaded) this.refresh()
  },

  onHide() {
    this._isPageVisible = false
    this.abortVoiceInput()
  },

  onUnload() {
    this._isDestroyed = true
    this._isPageVisible = false
    this.abortVoiceInput(true)
  },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/learning/index' })
  },

  async refresh() {
    try {
      const { review } = await loadAgentCourseReview(this.stageId)
      if (this._isDestroyed) return
      this.apply(review || {})
    } catch (error) {
      if (this._isDestroyed) return
      const notice = error && NOTICE[error.code]
      if (notice) this.setData({ loaded: true, loadFailed: false, notice })
      else this.setData({ loadFailed: true, errorMessage: error && error.message || '复习暂时无法打开，请稍后重试。' })
    }
  },

  retry() {
    this.setData({ loadFailed: false, errorMessage: '' })
    this.refresh()
  },

  apply(review, checkin) {
    if (checkin) this.celebrate(checkin)
    const questions = review.questions || []
    const done = review.status === 'done'
    const answers = done ? (review.answers || []) : []
    const state = done ? 'done' : 'intro'
    this.setData(Object.assign({
      loaded: true,
      loadFailed: false,
      notice: '',
      review,
      state,
      answers,
      pending: null,
      result: done ? resultCard(review.result) : null,
      turns: done ? buildTurns(questions, answers) : [],
      listBottomPadding: this.data.composerBottomOffset
    }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
  },

  bottomScrollPatch() {
    this._scrollRequest = Math.max(BOTTOM_SCROLL_REQUEST, this._scrollRequest, Number(this.data.scrollTop) || 0) + 1
    return { scrollTop: this._scrollRequest }
  },

  // 新内容与滚动请求同一次 setData 下发时，scroll-view 可能还没排好新内容就去夹最大值；下一帧再要一次
  repeatBottomScroll() {
    if (this._isDestroyed || typeof wx.nextTick !== 'function') return
    wx.nextTick(() => {
      if (!this._isDestroyed) this.setData(this.bottomScrollPatch())
    })
  },

  start() {
    const questions = (this.data.review && this.data.review.questions) || []
    if (!questions.length) return
    // 复述靠开口说：开始时就把麦克风权限问好，免得第一次按住说话被授权弹窗打断；不给就改成打字
    this.askMicrophone((granted) => {
      if (!granted && !this._isDestroyed) this.setData({ voiceMode: false })
    })
    this.setData(Object.assign({
      state: 'chat',
      answers: [],
      pending: null,
      turns: buildTurns(questions, []),
      listBottomPadding: this.data.composerBottomOffset + LIST_BOTTOM_GAP
    }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
  },

  // ——— 回答：按住说话（默认）或打字 ————————————————————————————
  handleInput(event) {
    this.setData({ draft: String(event.detail.value || '').slice(0, MAX_ANSWER) })
  },

  handleSend() {
    return this.sendAnswer(this.data.draft, { fromDraft: true })
  },

  // 答不上来也可以直接跳过这题（记成空白，考官按没讲到算）
  skipQuestion() {
    if (this.data.sending || this.data.state !== 'chat') return
    this.recordAnswer('')
  },

  // fromDraft：打字发的，发出去才清空输入框
  // 先看一眼是不是在答这道题：是就记下；没在答题、听不清、说想不起来的，先追问一句、等学生选。
  async sendAnswer(value, { fromDraft = false } = {}) {
    const answer = String(value || '').trim().slice(0, MAX_ANSWER)
    if (!answer || this.data.sending || this.data.state !== 'chat') return
    const questions = this.data.review.questions || []
    const index = this.data.answers.length
    // 学生没点按钮、直接说了新的一句：上一句不算，按新的这句来
    const patch = { pending: null, sending: true, typingLabel: '正在看你的回答', turns: buildTurns(questions, this.data.answers).concat({ id: `p${index}-user`, role: 'user', content: answer }) }
    if (fromDraft) patch.draft = ''
    this.setData(Object.assign(patch, this.bottomScrollPatch()), () => this.repeatBottomScroll())
    let check = { accepted: true }
    try {
      check = await checkAgentCourseReviewAnswer(this.stageId, index, answer)
    } catch (error) {
      // 检查不了（网络等）就照常收下，不挡着学生答题
      check = { accepted: true }
    }
    if (this._isDestroyed) return
    this.setData({ sending: false })
    if (check.accepted) {
      this.recordAnswer(answer)
      return
    }
    const pending = { answer, reply: check.reply || '这句好像没在回答这道题，再说一次？' }
    this.setData(Object.assign({ pending, turns: buildTurns(questions, this.data.answers, pending) }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
  },

  // 「重新回答」：刚才那句不算，接着按住说话 / 打字
  retryPending() {
    if (!this.data.pending || this.data.sending) return
    const questions = this.data.review.questions || []
    this.setData(Object.assign({ pending: null, turns: buildTurns(questions, this.data.answers) }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
  },

  // 「就这样算」：按刚才那句记下（想不起来就记成没讲到，下次复习先问）
  acceptPending() {
    const pending = this.data.pending
    if (!pending || this.data.sending) return
    this.recordAnswer(pending.answer)
  },

  recordAnswer(answer) {
    const questions = this.data.review.questions || []
    const answers = this.data.answers.concat(answer)
    this.setData(Object.assign({ answers, pending: null, turns: buildTurns(questions, answers) }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
    if (answers.length >= questions.length) this.submit(answers)
  },

  async submit(answers) {
    this.setData({ sending: true, typingLabel: '正在对照本课要点判分' })
    try {
      const response = await submitAgentCourseReview(this.stageId, answers)
      if (this._isDestroyed) return
      this.apply(response.review || {}, response.checkin)
    } catch (error) {
      if (this._isDestroyed) return
      // 没交上去：退回最后一题，答案放回输入框，点发送再交
      const last = answers[answers.length - 1] || ''
      const kept = answers.slice(0, -1)
      this.setData({ answers: kept, turns: buildTurns(this.data.review.questions || [], kept), draft: last, voiceMode: false })
      wx.showToast({ title: error && error.message || '没有交上去，请再发一次', icon: 'none', duration: 3000 })
    } finally {
      if (!this._isDestroyed) this.setData({ sending: false })
    }
  },

  handleVoiceButtonTap() {
    if (this.data.voiceRecognizing) return
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({ voiceMode: true })
  },

  handleKeyboardButtonTap() {
    if (this.data.voiceRecognizing) return
    this.setData({ voiceMode: false })
  },

  handleSpeakTouchStart(event) {
    if (this._voiceTimer || this._asrBusy || this.data.voiceRecognizing || this.data.state !== 'chat') return
    if (this.data.sending) {
      wx.showToast({ title: '正在判分，请稍等', icon: 'none' })
      return
    }
    this._voiceTouching = true
    const touch = event && event.touches && event.touches[0]
    this._voiceStartY = touch ? touch.pageY : 0
    this._voiceCancel = false
    this._voiceTimer = setTimeout(() => {
      this._voiceTimer = null
      this.requestVoicePermissionAndStart()
    }, VOICE_LONG_PRESS_DELAY)
  },

  // 按住时手指往上移过 60px 就是要取消
  handleSpeakTouchMove(event) {
    if (!this.data.voiceRecognizing || !this._voiceStartY) return
    const touch = event && event.touches && event.touches[0]
    if (!touch) return
    const voiceCancel = touch.pageY < this._voiceStartY - 60
    if (voiceCancel === this._voiceCancel) return
    this._voiceCancel = voiceCancel
    this.setData({ voiceCancel })
  },

  // 松手；录满约 60 秒时也走这里（手指还按着，之后的松手不再有动作）
  handleSpeakTouchEnd() {
    if (this._voiceTimer) {
      clearTimeout(this._voiceTimer)
      this._voiceTimer = null
    }
    this._voiceTouching = false
    if (!this.data.voiceRecognizing) return
    const canceled = this._voiceCancel || this.data.voiceCancel
    this._voiceCancel = false
    this.stopVoiceVisualizer()
    this.stopRecorderCapture()
    this.setData({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [], voiceRemaining: 0 }, () => {
      const chunks = this._asrChunks || []
      this._asrChunks = []
      this._asrBytes = 0
      if (canceled) return
      if (voiceByteLength(chunks) >= VOICE_MIN_BYTES) this.transcribeAndSend(chunks)
      else wx.showToast({ title: '说话时间太短，请重新按住', icon: 'none' })
    })
  },

  async transcribeAndSend(chunks) {
    this._asrBusy = true
    wx.showLoading({ title: '正在识别…', mask: true })
    const { text, warning } = await transcribeVoiceChunks(chunks, { logTag: 'review' })
    if (this._isDestroyed) return
    wx.hideLoading()
    this._asrBusy = false
    if (!text) {
      if (warning) wx.showToast({ title: warning, icon: 'none' })
      return
    }
    this.sendAnswer(text)
  },

  // 问一次麦克风权限，结果回调一次；系统已经记下拒绝时不再弹窗。
  askMicrophone(done) {
    if (this.data.microphonePermission === 'granted') {
      done(true)
      return
    }
    if (this._permissionRequestPending) return
    this._permissionRequestPending = true
    const resolvePermission = (granted) => {
      this._permissionRequestPending = false
      if (this._isDestroyed) return
      this.setData({ microphonePermission: granted ? 'granted' : 'denied' })
      done(granted)
    }
    const authorize = () => {
      if (!wx.authorize) {
        resolvePermission(true)
        return
      }
      wx.authorize({ scope: 'scope.record', success: () => resolvePermission(true), fail: () => resolvePermission(false) })
    }
    if (!wx.getSetting) {
      authorize()
      return
    }
    wx.getSetting({
      success: (setting) => {
        const authSetting = (setting && setting.authSetting) || {}
        if (authSetting['scope.record'] === true) resolvePermission(true)
        else if (authSetting['scope.record'] === false) resolvePermission(false)
        else authorize()
      },
      fail: authorize
    })
  },

  requestVoicePermissionAndStart() {
    if (this.data.voiceRecognizing || this._asrBusy) return
    this.askMicrophone((granted) => {
      if (!granted) {
        this.showVoicePermissionRecovery()
        return
      }
      // 授权弹窗期间手指可能已经松开：那就只记下授权，不自己开始录
      if (this._voiceTouching) this.startVoiceInput()
    })
  },

  showVoicePermissionRecovery() {
    wx.showModal({
      title: '需要麦克风权限',
      content: '开启后可以按住说话，把学到的讲给它听。录音仅上传用于转成文字，识别完成后不保留。也可以点左边的键盘打字回答。',
      confirmText: '去设置',
      cancelText: '先打字',
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting({})
        else if (!this._isDestroyed) this.setData({ voiceMode: false })
      }
    })
  },

  startVoiceInput() {
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({ voiceRecognizing: true, voiceCancel: false, voiceSoundActive: false, voiceBars: VOICE_BARS, voiceRemaining: 0 })
    this.startRecorderCapture()
    this.startVoiceVisualizer()
  },

  // 页面隐藏、离开时：正在录的直接作废，不转写、不发送
  abortVoiceInput(unloading = false) {
    if (this._voiceTimer) {
      clearTimeout(this._voiceTimer)
      this._voiceTimer = null
    }
    this._voiceTouching = false
    this._voiceCancel = false
    this.stopVoiceVisualizer()
    this.stopRecorderCapture(unloading)
    this._asrChunks = []
    this._asrBytes = 0
    if (!unloading && this.data.voiceRecognizing) {
      this.setData({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [], voiceRemaining: 0 })
    }
  },

  startVoiceVisualizer() {
    this.stopVoiceVisualizer()
    this.updateVoiceVisualizer()
    this._voiceVisualizerTimer = setInterval(() => {
      if (!this.data.voiceRecognizing) {
        this.stopVoiceVisualizer()
        return
      }
      this.updateVoiceVisualizer()
    }, AUDIO_VISUALIZER_INTERVAL)
  },

  stopVoiceVisualizer() {
    if (this._voiceVisualizerTimer) clearInterval(this._voiceVisualizerTimer)
    this._voiceVisualizerTimer = null
  },

  updateVoiceVisualizer() {
    if (!this.data.voiceRecognizing || !this._pcmLevelMeter) return
    const now = Date.now()
    const snapshot = this._pcmLevelMeter.getSnapshot(now)
    const live = Boolean(this._recorderActive && this._pcmLevelAvailable)
    const left = Math.ceil((VOICE_MAX_BYTES - this._asrBytes) / VOICE_BYTES_PER_SECOND)
    // 开发者工具没有 PCM 帧：用合成的起伏；真机以实测电平为准
    this.setData({
      voiceSoundActive: live && snapshot.fresh ? snapshot.level >= 0.06 : true,
      voiceBars: live ? createVoiceBars(snapshot.barLevels) : createFallbackVoiceBars(now),
      voiceRemaining: this._asrBytes > 0 && left <= VOICE_COUNTDOWN_SECONDS ? Math.max(left, 1) : 0
    })
  },

  startRecorderCapture() {
    const bridge = getRecorderBridge()
    if (!bridge) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' })
      return
    }
    bridge.attach(this)
    this._pcmLevelAvailable = false
    this._pcmLevelMeter.reset()
    this._asrChunks = []
    this._asrBytes = 0
    try {
      const sessionId = bridge.start(this, RECORDER_OPTIONS)
      if (sessionId == null) throw new Error('Recorder owner is not active')
    } catch (error) {
      this._recorderSessionId = null
      wx.showToast({ title: '麦克风启动失败，请稍后重试', icon: 'none' })
    }
  },

  stopRecorderCapture(unloading = false) {
    const sessionId = this._recorderSessionId
    this._recorderActive = false
    this._pcmLevelAvailable = false
    if (this._pcmLevelMeter) this._pcmLevelMeter.reset()
    const bridge = getRecorderBridge()
    if (bridge) {
      if (unloading) bridge.cancelOwner(this)
      else bridge.stop(this, sessionId)
    }
    // 会话号留到 bridge 确认 onStop 再清：录音回调不带操作号，提前清掉就对不上最后那个回调了
    if (unloading) this._recorderSessionId = null
  },

  // 以下四个由 utils/recorder-session-bridge 回调
  _handleRecorderStart(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    if (!this.data.voiceRecognizing || !this._isPageVisible || this._isDestroyed) {
      const bridge = getRecorderBridge()
      if (bridge) bridge.stop(this, sessionId)
      return
    }
    this._recorderActive = true
  },

  _handleRecorderFrame(result, sessionId) {
    if (sessionId !== this._recorderSessionId || !this._recorderActive) return
    const frameBuffer = result && result.frameBuffer
    if (frameBuffer && frameBuffer.byteLength) {
      this._asrBytes += frameBuffer.byteLength
      if (this._asrBytes <= VOICE_MAX_BYTES) this._asrChunks.push(frameBuffer)
    }
    if (this._pcmLevelMeter.process(frameBuffer)) this._pcmLevelAvailable = true
    // 录满了：后面的话收不进去，与其悄悄丢掉，不如就此发出，学生接着按住说下一段
    if (this._asrBytes >= VOICE_MAX_BYTES) this.handleSpeakTouchEnd()
  },

  _handleRecorderStop(result, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderSessionId = null
    this._recorderActive = false
    this._pcmLevelAvailable = false
  },

  _handleRecorderError(error, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderSessionId = null
    this._recorderActive = false
    this._pcmLevelAvailable = false
    wx.showToast({ title: '麦克风启动失败，请稍后重试', icon: 'none' })
  },

  // ——— 打卡与结论后的去处 ————————————————————————————————
  celebrate(checkin) {
    this.setData({ checkinNotice: checkin })
    // 打卡点亮了：顶栏火苗、「我的」连胜卡片马上跟着亮（打卡页也会重新读）。
    loadCheckin({ maxAge: 0 }).catch(() => {})
  },

  closeCheckinNotice() {
    this.setData({ checkinNotice: null })
  },

  // 复习完回课程看看没讲清的地方
  openCourse() {
    wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(this.stageId)}` })
  }
})
