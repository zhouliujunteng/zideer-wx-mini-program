const { loadAgentCourseAcceptance, sendAgentCourseAcceptance } = require('../../services/identity')
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

// 智能体课程复述验收（费曼验收，课程服务 lib/course/agent-acceptance.ts）：
// 学完整门课 → 与验收智能体对话、把知识点讲给它听 → AI 通过后等老师核验 → 老师确认后知识点进入学习宇宙。
// AI 通过同时算当天打卡（2026-09-25）：回包带 checkin 时弹「今日打卡完成」，并刷新顶栏火苗等连胜入口。
//
// 版式照诊断室（pages/diagnosis-room）：同一个顶栏、底色、气泡和输入框（2026-10-04 用户要求）。
// 这里是让学生开口复述，不是做选择：对话默认「按住说话」，松手转成文字直接发出；点左边的键盘也能打字。
// 按住说话与老师端「直播间记录」（teacher/live-room）同一套 utils/voice-input。
const ANSWERABLE = ['not_started', 'in_progress', 'ai_retry', 'teacher_rejected']
const MAX_ANSWER = 1000
// 记录列表底部留白 = 输入框离底边的距离 + 输入框本身连同上下留白的高度（与直播间记录同一个数）
const LIST_BOTTOM_GAP = 112
// 一段话最多录约 60 秒（VOICE_MAX_BYTES，16kHz × 2 字节）：最后 10 秒提示还能说几秒，到点自动当松手发出
const VOICE_BYTES_PER_SECOND = 32000
const VOICE_COUNTDOWN_SECONDS = 10
// 与直播间记录同一招：scroll-top 给一个远大于记录高度的值，由 scroll-view 夹到真实底部；每次 +1 才会再滚
const BOTTOM_SCROLL_REQUEST = 1000000
// 打字框最多长到 5 行，再多在框里上下滑；一行大约多高（px）在 linechange 里量，量到之前按 21 算
const MAX_INPUT_LINES = 5
const DEFAULT_LINE_HEIGHT = 21

function viewState(acceptance) {
  const status = acceptance.status
  if (!acceptance.learningComplete && ANSWERABLE.includes(status)) return 'learning'
  if (status === 'in_progress') return 'chat'
  if (status === 'pending_teacher') return 'pending'
  if (status === 'teacher_passed') return 'passed'
  if (status === 'ai_retry' || status === 'teacher_rejected') return 'retry'
  return 'intro'
}

// 对话结束后接在最后一条后面的结论卡片（诊断室「诊断已结束」那个位置）
function resultCard(state, acceptance) {
  const topics = acceptance.topics || []
  if (state === 'pending') {
    return { title: 'AI 验收已通过，等待老师核验', copy: '老师确认后，这门课就算通过，下面的知识点会进入你的学习宇宙。', topicsTitle: '本课知识点', topics }
  }
  if (state === 'passed') {
    const teacher = acceptance.teacherName || '老师'
    return { title: '验收通过', copy: `${teacher} 已确认${acceptance.teacherSummary ? '：' + acceptance.teacherSummary : '。'}`, topicsTitle: '已进入学习宇宙', topics }
  }
  if (state === 'retry' && acceptance.status === 'teacher_rejected') {
    const summary = acceptance.teacherSummary || '回到课程再复习一下，准备好了再来讲一遍。'
    return { title: '老师建议再巩固一下', copy: acceptance.teacherName ? `${acceptance.teacherName}：${summary}` : summary, topicsTitle: '', topics: [] }
  }
  if (state === 'retry') {
    // 独立考官的逐条结论（2026-10-08 起）：列出没讲清的要点和说错的地方；更早的验收没有，退回 AI 总结
    const grade = acceptance.grade
    if (grade && ((grade.weakPoints || []).length || (grade.misconceptions || []).length)) {
      return {
        title: '这次还差一点',
        copy: '对照下面几条回去复习，准备好了再来讲一遍。',
        topicsTitle: '',
        topics: [],
        weakPoints: grade.weakPoints || [],
        misconceptions: grade.misconceptions || []
      }
    }
    return { title: '这次还差一点', copy: acceptance.aiSummary || '回到课程再复习一下，准备好了再来讲一遍。', topicsTitle: '', topics: [] }
  }
  return null
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
    course: null,
    acceptance: null,
    state: '',
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
    keyboardHeight: 0,
    inputLines: 1,
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
    // 读到过就后台刷新；正在等验收智能体回复、或正在识别刚说的话时不打断。
    if (!this.data.sending && !this._asrBusy) this.refresh({ resume: true })
  },

  onHide() {
    this._isPageVisible = false
    this.abortVoiceInput()
    if (this.data.keyboardHeight) this.setKeyboardHeight(0)
  },

  onUnload() {
    this._isDestroyed = true
    this._isPageVisible = false
    this.abortVoiceInput(true)
  },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  // resume：进页面时，上次的回答存上了、回复没回来（最后一句是学生说的），自动接着要回复；
  // 回答次数满了的那次就是直接出结论（2026-11-09 用户反馈：卡在「验收中」、一发就提示次数已用完）。
  // 发送失败后的那次刷新不自动重试，免得连着失败；学生点发送就是重试，服务端不会把同一句再存一遍。
  async refresh({ resume = false } = {}) {
    try {
      const result = await loadAgentCourseAcceptance(this.stageId)
      // 读的途中学生已经发出了回答：以那次回包为准，不拿这份旧的盖掉刚放上去的气泡
      if (this._isDestroyed || this.data.sending) return
      this.apply(result)
      const last = this.data.turns[this.data.turns.length - 1]
      if (resume && this.data.state === 'chat' && last && last.role === 'user') this.resume()
    } catch (error) {
      if (this._isDestroyed || this.data.loaded) return
      this.setData({ loadFailed: true, errorMessage: error && error.message || '验收状态暂时无法读取，请稍后重试。' })
    }
  },

  retry() {
    this.setData({ loadFailed: false, errorMessage: '' })
    this.refresh()
  },

  apply(result = {}) {
    if (result.checkin) this.celebrate(result.checkin)
    const acceptance = result.acceptance || {}
    const turns = (result.turns || []).map((turn, index) => ({ id: `t${index}`, role: turn.role, content: turn.content }))
    const state = viewState(acceptance)
    this.setData(Object.assign({
      loaded: true,
      loadFailed: false,
      course: result.course || this.data.course,
      acceptance,
      state,
      result: resultCard(state, acceptance),
      turns,
      listBottomPadding: this.listBottomPadding({ state })
    }, this.bottomScrollPatch()), () => this.repeatBottomScroll())
  },

  // 记录列表底部留白：输入框离底边的距离（键盘弹起时就是键盘高度）+ 输入框高度；打字框多一行就多留一行
  listBottomPadding({ state = this.data.state, keyboardHeight = this.data.keyboardHeight, inputLines = this.data.inputLines } = {}) {
    const bottom = this.data.composerBottomOffset
    if (state !== 'chat') return bottom
    const extraLines = this.data.voiceMode ? 0 : Math.max(0, inputLines - 1)
    return (keyboardHeight > 0 ? keyboardHeight : bottom) + LIST_BOTTOM_GAP + extraLines * (this._lineHeight || DEFAULT_LINE_HEIGHT)
  },

  setKeyboardHeight(keyboardHeight) {
    const patch = { keyboardHeight, listBottomPadding: this.listBottomPadding({ keyboardHeight }) }
    // 键盘弹起后滚到最新一问，学生边看问题边打字
    if (keyboardHeight > 0) Object.assign(patch, this.bottomScrollPatch())
    this.setData(patch, keyboardHeight > 0 ? () => this.repeatBottomScroll() : undefined)
  },

  handleKeyboardHeightChange(event) {
    const height = Math.max(0, Math.round(Number(event && event.detail && event.detail.height) || 0))
    if (height !== this.data.keyboardHeight) this.setKeyboardHeight(height)
  },

  // 平板上点键盘的「收起」或点别处时，有的版本不报高度 0，失焦时也放回原位
  handleInputBlur() {
    if (this.data.keyboardHeight) this.setKeyboardHeight(0)
  },

  handleLineChange(event) {
    const detail = (event && event.detail) || {}
    const lineCount = Math.max(1, Number(detail.lineCount) || 1)
    if (detail.height > 0 && lineCount <= MAX_INPUT_LINES) this._lineHeight = detail.height / lineCount
    const inputLines = Math.min(MAX_INPUT_LINES, lineCount)
    if (inputLines === this.data.inputLines) return
    this.setData({ inputLines, listBottomPadding: this.listBottomPadding({ inputLines }) })
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

  // 开始 / 重新验收：空消息让验收智能体先提问。
  async start() {
    if (this.data.sending) return
    this.setData({ sending: true, typingLabel: '正在准备第一个问题' })
    // 复述靠开口说：开始时就把麦克风权限问好，免得第一次按住说话被授权弹窗打断；不给就改成打字
    this.askMicrophone((granted) => {
      if (!granted && !this._isDestroyed) this.setData({ voiceMode: false })
    })
    try {
      this.apply(await sendAgentCourseAcceptance(this.stageId, ''))
    } catch (error) {
      wx.showToast({ title: error && error.message || '验收暂时无法开始', icon: 'none', duration: 3000 })
    } finally {
      if (!this._isDestroyed) this.setData({ sending: false })
    }
  },

  async resume() {
    if (this.data.sending) return
    this.setData({ sending: true, typingLabel: '正在接着刚才的回答' })
    try {
      this.apply(await sendAgentCourseAcceptance(this.stageId, ''))
    } catch (error) {
      if (!this._isDestroyed) wx.showToast({ title: error && error.message || '验收暂时无法继续，请稍后重试。', icon: 'none', duration: 3000 })
    } finally {
      if (!this._isDestroyed) this.setData({ sending: false })
    }
  },

  // ——— 回答：按住说话（默认）或打字 ————————————————————————————
  handleInput(event) {
    this.setData({ draft: String(event.detail.value || '').slice(0, MAX_ANSWER) })
  },

  handleSend() {
    return this.sendAnswer(this.data.draft, { fromDraft: true })
  },

  // fromDraft：打字发的，发出去才清空输入框
  async sendAnswer(value, { fromDraft = false } = {}) {
    const answer = String(value || '').trim().slice(0, MAX_ANSWER)
    if (!answer || this.data.sending || this.data.state !== 'chat') return
    // 先把学生的回答放进对话，等验收智能体回复。
    const turns = this.data.turns.concat({ id: `t${this.data.turns.length}`, role: 'user', content: answer })
    const patch = { turns, sending: true, typingLabel: '正在想下一个问题' }
    if (fromDraft) {
      patch.draft = ''
      patch.inputLines = 1
      patch.listBottomPadding = this.listBottomPadding({ inputLines: 1 })
    }
    this.setData(Object.assign(patch, this.bottomScrollPatch()), () => this.repeatBottomScroll())
    try {
      this.apply(await sendAgentCourseAcceptance(this.stageId, answer))
    } catch (error) {
      if (this._isDestroyed) return
      // 回答没送达：放回输入框（说话转出来的字也放回去，切到键盘看得到、改得了，点发送再试），
      // 对话以服务端为准重新读取。
      this.setData({ draft: answer, voiceMode: false })
      wx.showToast({ title: error && error.message || '回答没有发送成功，请重试', icon: 'none', duration: 3000 })
      this.refresh()
    } finally {
      if (!this._isDestroyed) this.setData({ sending: false })
    }
  },

  handleVoiceButtonTap() {
    if (this.data.voiceRecognizing) return
    if (wx.hideKeyboard) wx.hideKeyboard()
    // 打字框随 wx:if 卸掉，不一定再报键盘高度 0：这里直接放回原位
    this.setData({ voiceMode: true, keyboardHeight: 0 }, () => {
      if (!this._isDestroyed) this.setData({ listBottomPadding: this.listBottomPadding() })
    })
  },

  handleKeyboardButtonTap() {
    if (this.data.voiceRecognizing) return
    this.setData({ voiceMode: false }, () => {
      if (!this._isDestroyed) this.setData({ listBottomPadding: this.listBottomPadding() })
    })
  },

  handleSpeakTouchStart(event) {
    if (this._voiceTimer || this._asrBusy || this.data.voiceRecognizing || this.data.state !== 'chat') return
    if (this.data.sending) {
      wx.showToast({ title: '等它问完下一个问题再说', icon: 'none' })
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
    const { text, warning } = await transcribeVoiceChunks(chunks, { logTag: 'agent-acceptance' })
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

  continueLearning() {
    wx.redirectTo({ url: `/learning/course/index?agentCourseId=${encodeURIComponent(this.stageId)}` })
  },

  openUniverse() {
    wx.switchTab({ url: '/pages/knowledge-universe/index' })
  }
})
