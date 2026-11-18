const { loadAgentCourseAcceptance, sendAgentCourseAcceptance } = require('../../services/identity')
const { loadCheckin } = require('../../services/learning-streak')
const { attachUiAssets } = require('../../services/ui-assets')
const { playSequence, stopSpeech } = require('../../services/learn-speech')
const { getNavigationMetrics } = require('../../utils/navigation')
const {
  viewState,
  classroomPeers,
  boardView,
  peerHint,
  speechQueue,
  classRecords,
  resultCard,
  HINT_FIRST_DELAY,
  HINT_MORE_DELAY,
  hintKey,
  hintCard,
  hintSpeech
} = require('../../utils/peer-class-view')
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

// 第三关「当小老师」（复述验收改版，2026-11-17，docs/当小老师记录.md）：
// 学完整门课、通关互动练习 → 孩子当小老师，按住说话把这节课讲给两三个 AI 同学听；黑板上写着要讲的几件事，
// 每讲一段，同学们挨个说自己学到了什么、再有一个人提问；讲清一半就过关，等老师核验 → 知识点进入学习宇宙。
// 过关同时算当天打卡（2026-09-25）：回包带 checkin 时弹「今日打卡完成」，并刷新顶栏火苗等连胜入口。
//
// 课堂状态（黑板、星星、谁在提问）和同学们说的话都由课程服务定（lib/course/peer-class.ts），
// 这里只负责画（utils/peer-class-view.js）、按顺序朗读同学们的话（services/learn-speech.js playSequence），
// 以及收孩子讲的话：默认「按住说话」，松手转成文字直接发出；点左边的键盘也能打字（2026-10-04 复述验收默认按住说话）。
// 按住说话与老师端「直播间记录」（teacher/live-room）同一套 utils/voice-input。
// 孩子半天没开口（2026-11-17）：轮到小老师讲、15 秒没动静弹「悄悄提示」（怎么开头），再过 20 秒加上大概的提示；
// 提示条旁边的「怎么讲？」随时能点开。开着朗读时提示也读出来。孩子一开口、讲完一段，提示就收起来。
const MAX_ANSWER = 1000
// 一段话最多录约 60 秒（VOICE_MAX_BYTES，16kHz × 2 字节）：最后 10 秒提示还能说几秒，到点自动当松手发出
const VOICE_BYTES_PER_SECOND = 32000
const VOICE_COUNTDOWN_SECONDS = 10
// 打字框最多长到 5 行，再多在框里上下滑
const MAX_INPUT_LINES = 5
// 自动朗读同学们的话：默认开（年纪小的孩子不认字；页面读不到年级，一律按开），可以在教室右上角关掉，本机记住
const AUTO_READ_KEY = 'zhilu_peer_class_auto_read'

function footerBottomOffset() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const safeArea = info.safeArea || {}
  const safeAreaBottom = Math.max(0, (info.screenHeight || info.windowHeight || 0) - (safeArea.bottom || info.windowHeight || 0))
  return safeAreaBottom + 12
}

function readAutoRead() {
  try {
    return wx.getStorageSync(AUTO_READ_KEY) !== 'off'
  } catch (error) {
    return true
  }
}

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    course: null,
    acceptance: null,
    peerClass: null,
    state: '',
    result: null,
    turns: [],
    // 同学们这次新说的话（按顺序朗读），读到第几句（revealed），正在出声的同学
    lines: [],
    revealed: 0,
    playing: false,
    speakingPeer: '',
    // 由上面几项算出来给模板画的
    peers: [],
    board: null,
    hint: '',
    // 悄悄提示：hintLevel 0 没弹 / 1 怎么开头 / 2 再加大概的提示；hintReady 正等着小老师讲（显示「怎么讲？」）
    hintCard: null,
    hintLevel: 0,
    hintReady: false,
    records: [],
    recordOpen: false,
    autoRead: true,
    draft: '',
    sending: false,
    lastSaid: '',
    // 讲完这一段等了几秒（同学们在记笔记，等久了换说法，2026-11-18）
    waitSeconds: 0,
    checkinNotice: null,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    footerBottom: 12,
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
    this.setData({
      statusBarHeight: navigation.statusBarHeight,
      navigationBarHeight: navigation.navigationBarHeight,
      contentTop: navigation.contentTop,
      footerBottom: footerBottomOffset(),
      autoRead: readAutoRead()
    })
    this._playback = null
    this._afterPlayback = null
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
    // 读到过就后台刷新；正在等同学们的回应、或正在识别刚说的话时不打断。
    if (!this.data.sending && !this._asrBusy) this.refresh({ resume: true })
  },

  onHide() {
    this._isPageVisible = false
    this.clearHintTimer()
    this.stopHintSpeech()
    this.stopPlayback()
    this.abortVoiceInput()
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 })
  },

  onUnload() {
    this._isDestroyed = true
    this._isPageVisible = false
    this.clearHintTimer()
    this.stopWaitClock()
    this.stopPlayback()
    stopSpeech()
    this.abortVoiceInput(true)
  },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.redirectTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(this.stageId)}` })
  },

  // resume：进页面时，上一段存上了、同学们的话没回来（最后一句是孩子讲的），自动把那段再发一次（服务端认出是重发，不再存一遍）；
  // 课已经下了、结论没落下的，也接着要结论。发送失败后的那次刷新不自动重试，免得连着失败。
  async refresh({ resume = false } = {}) {
    try {
      const result = await loadAgentCourseAcceptance(this.stageId)
      // 读的途中孩子已经讲了一段：以那次回包为准，不拿这份旧的盖掉
      if (this._isDestroyed || this.data.sending) return
      this.apply(result)
      // 闯关学习（2026-11-11）：第三关要先通关第二关「互动练习」，还没开始过的先引导去做练习
      const status = result && result.acceptance && result.acceptance.status
      if (result && result.practice && !result.practice.cleared && (!status || status === 'not_started')) this.guidePractice()
      if (!resume) return
      const last = this.data.turns[this.data.turns.length - 1]
      if (this.data.state === 'class' && last && last.role === 'user') this.sendSegment(last.content, { resend: true })
      else if (this.data.state === 'settling') this.post({}).catch(() => {})
    } catch (error) {
      if (this._isDestroyed || this.data.loaded) return
      this.setData({ loadFailed: true, errorMessage: error && error.message || '课堂暂时没有打开，请稍后重试。' })
    }
  },

  guidePractice() {
    if (this._guidingPractice || this._isDestroyed) return
    this._guidingPractice = true
    wx.showModal({
      title: '先闯过互动练习',
      content: '这节课的小题都做对了，再来讲给同学们听。',
      confirmText: '去闯关',
      cancelText: '再看看',
      success: (result) => {
        this._guidingPractice = false
        if (result.confirm) wx.redirectTo({ url: `/learning/practice/index?stageId=${encodeURIComponent(this.stageId)}` })
      },
      fail: () => { this._guidingPractice = false }
    })
  },

  retry() {
    this.setData({ loadFailed: false, errorMessage: '' })
    this.refresh()
  },

  // 一次回包：课堂状态、对话、同学们新说的话。新说的话按顺序朗读，读完才亮结论、弹打卡（不然盖住正在说话的同学）。
  apply(result = {}) {
    const acceptance = result.acceptance || {}
    const peerClass = result.peerClass || null
    const turns = (result.turns || []).map((turn, index) => ({ id: `t${index}`, role: turn.role, content: turn.content, speaker: turn.speaker || '' }))
    const lines = Array.isArray(result.lines) ? result.lines.filter((line) => line && line.text) : []
    const state = viewState(acceptance, peerClass)
    const after = { result: resultCard(state, acceptance, peerClass), checkin: result.checkin || null }
    this.stopPlayback()
    const play = lines.length > 0 && this.data.autoRead
    this.setData({
      loaded: true,
      loadFailed: false,
      course: result.course || this.data.course,
      acceptance,
      peerClass,
      state,
      turns,
      records: classRecords(turns),
      lines,
      revealed: play ? 0 : lines.length,
      playing: play,
      speakingPeer: '',
      result: play ? null : after.result
    })
    if (play) {
      this._afterPlayback = after
      this.startPlayback(lines)
    } else if (after.checkin) {
      this.celebrate(after.checkin)
    }
    this.render()
  },

  // 由课堂状态算出模板要画的：同学们（表情、气泡、星星）、黑板、提示条
  render(extra = {}) {
    const data = Object.assign({}, this.data, extra)
    const outcome = data.state === 'pending' || data.state === 'passed' ? 'passed' : ''
    this.setData(Object.assign(extra, {
      peers: classroomPeers({
        peerClass: data.peerClass,
        turns: data.turns,
        lines: data.lines,
        revealed: data.revealed,
        speakingPeer: data.speakingPeer,
        learnerTalking: data.voiceRecognizing,
        playing: data.playing,
        outcome,
        thinking: Boolean(data.sending && data.lastSaid)
      }),
      board: boardView(data.peerClass),
      hint: data.state === 'class' || data.state === 'settling'
        ? peerHint({ peerClass: data.peerClass, playing: data.playing, sending: data.sending || data.state === 'settling', waitSeconds: data.waitSeconds })
        : ''
    }))
    this.syncHint()
  },

  // ——— 孩子半天没开口：悄悄提示 ————————————————————————————
  // 正等着小老师讲：上着课、同学们没在说、没在等回应、没在按住说话或识别、输入框里也没字
  isWaitingForLearner() {
    const data = this.data
    return Boolean(hintKey(data.peerClass)) && data.state === 'class' && this._isPageVisible !== false &&
      !data.playing && !data.sending && !data.voiceRecognizing && !this._asrBusy && !data.draft
  },

  // 每次课堂状态变了都过一遍：换了一轮就从头算；在等小老师就按级数排下一次弹出；讲完一段（发出去）提示收起
  syncHint() {
    if (this._isDestroyed) return
    const data = this.data
    const key = data.state === 'class' ? hintKey(data.peerClass) : ''
    if (key !== this._hintKey || data.sending) {
      if (key !== this._hintKey) this._hintClosed = false
      this._hintKey = key
      this.clearHintTimer()
      this.stopHintSpeech()
      if (data.hintCard || data.hintLevel) this.setData({ hintCard: null, hintLevel: 0 })
    }
    const waiting = this.isWaitingForLearner()
    if (waiting !== this.data.hintReady) this.setData({ hintReady: waiting })
    if (!waiting) {
      this.clearHintTimer()
      return
    }
    const level = this.data.hintLevel
    const hasCue = Boolean(data.peerClass.hint.cue)
    // 自己收起过就不再自动弹（还能点「怎么讲？」）；已经给全了也不再弹
    if (this._hintTimer || this._hintClosed || level >= 2 || (level === 1 && !hasCue)) return
    this._hintTimer = setTimeout(() => {
      this._hintTimer = null
      if (this.isWaitingForLearner()) this.showHint(this.data.hintLevel + 1)
    }, level === 0 ? HINT_FIRST_DELAY : HINT_MORE_DELAY)
  },

  clearHintTimer() {
    if (this._hintTimer) clearTimeout(this._hintTimer)
    this._hintTimer = null
  },

  showHint(level) {
    const next = Math.min(2, Math.max(1, level))
    const card = hintCard(this.data.peerClass, next)
    if (!card) return
    const added = next === 2 && this.data.hintLevel === 1 && Boolean(this.data.hintCard)
    this.setData({ hintCard: card, hintLevel: next })
    if (this.data.autoRead) this.speakHint(hintSpeech(card, { onlyCue: added }))
    this.syncHint()
  },

  // 提示条旁的「怎么讲？」：没弹过就弹，弹过就再给多一点
  openHint() {
    this._hintClosed = false
    this.showHint(this.data.hintCard ? this.data.hintLevel + 1 : Math.max(1, this.data.hintLevel))
  },

  moreHint() {
    this.showHint(2)
  },

  closeHint() {
    this._hintClosed = true
    this.clearHintTimer()
    this.stopHintSpeech()
    this.setData({ hintCard: null })
  },

  readHint() {
    this.speakHint(hintSpeech(this.data.hintCard))
  },

  speakHint(text) {
    if (!text) return
    this.stopHintSpeech()
    const handle = playSequence([{ text, voice: '' }], {
      onDone: () => {
        if (this._hintPlayback === handle) this._hintPlayback = null
      }
    })
    this._hintPlayback = handle
  },

  stopHintSpeech() {
    const handle = this._hintPlayback
    this._hintPlayback = null
    if (handle) handle.stop()
  },

  // ——— 同学们按顺序说话 ————————————————————————————————
  startPlayback(lines) {
    const handle = playSequence(speechQueue(lines), {
      onStart: (index) => {
        if (this._playback !== handle || this._isDestroyed) return
        const line = lines[index] || {}
        this.render({ revealed: index + 1, speakingPeer: line.peer || '' })
      },
      onEnd: () => {
        if (this._playback !== handle || this._isDestroyed) return
        this.render({ speakingPeer: '' })
      },
      onDone: () => {
        if (this._playback !== handle) return
        this._playback = null
        this.finishPlayback()
      }
    })
    this._playback = handle
  },

  // 读完、或被打断（按住说话、离开页面、关掉朗读）：剩下的话一起亮出来，再亮结论、弹打卡
  finishPlayback() {
    if (this._isDestroyed) return
    const after = this._afterPlayback
    this._afterPlayback = null
    const patch = { playing: false, speakingPeer: '', revealed: this.data.lines.length }
    if (after) patch.result = after.result
    this.render(patch)
    if (after && after.checkin) this.celebrate(after.checkin)
  },

  stopPlayback() {
    const handle = this._playback
    if (!handle) return
    this._playback = null
    handle.stop()
    this.finishPlayback()
  },

  toggleAutoRead() {
    const autoRead = !this.data.autoRead
    try {
      wx.setStorageSync(AUTO_READ_KEY, autoRead ? 'on' : 'off')
    } catch (error) {
      // 记不住也不要紧，这次照样生效
    }
    this.setData({ autoRead })
    if (!autoRead) {
      this.stopPlayback()
      this.stopHintSpeech()
    }
  },

  openRecords() {
    this.setData({ recordOpen: true })
  },

  closeRecords() {
    this.setData({ recordOpen: false })
  },

  noop() {},

  // ——— 上课、讲一段、下课、再讲一次 ————————————————————————————
  // 都带 peerClass: true；message 是孩子讲的一段（开课、补结论时为空）。没过互动练习的转去引导，其余错误抛给调用处提示
  async post({ message = '', finish = false, restart = false } = {}) {
    if (this.data.sending) return
    this.stopPlayback()
    this.render({ sending: true })
    try {
      const result = await sendAgentCourseAcceptance(this.stageId, message, { peerClass: true, finish, restart })
      if (this._isDestroyed) return
      this.setData({ sending: false })
      this.apply(result)
      return result
    } catch (error) {
      if (this._isDestroyed) return
      this.render({ sending: false })
      if (error && error.code === 'PRACTICE_REQUIRED') return this.guidePractice()
      throw error || new Error('')
    }
  },

  // 开始上课（也是没过关后「再给同学讲一次」之前的那次进课堂）：同学们打招呼
  async start() {
    if (this.data.sending) return
    // 当小老师靠开口讲：开始时就把麦克风权限问好，免得第一次按住说话被授权弹窗打断；不给就改成打字
    this.askMicrophone((granted) => {
      if (!granted && !this._isDestroyed) this.setData({ voiceMode: false })
    })
    try {
      await this.post({})
    } catch (error) {
      if (this._isDestroyed) return
      wx.showToast({ title: error && error.message || '课堂暂时没有打开，请稍后重试。', icon: 'none', duration: 3000 })
      this.refresh()
    }
  },

  // 没过关 / 老师要求重学：另开一次课（旧对话留给老师看）
  async restart() {
    if (this.data.sending) return
    this.askMicrophone((granted) => {
      if (!granted && !this._isDestroyed) this.setData({ voiceMode: false })
    })
    try {
      await this.post({ restart: true })
    } catch (error) {
      if (this._isDestroyed) return
      wx.showToast({ title: error && error.message || '课堂暂时没有打开，请稍后重试。', icon: 'none', duration: 3000 })
      this.refresh()
    }
  },

  // 「下课」：讲了至少一段才可以点，二次确认后按黑板现在的样子出结论
  handleFinishTap() {
    const peerClass = this.data.peerClass
    if (this.data.state !== 'class' || this.data.sending || !peerClass || !peerClass.rounds) {
      if (this.data.state === 'class' && peerClass && !peerClass.rounds) wx.showToast({ title: '先给同学们讲一段再下课', icon: 'none' })
      return
    }
    const left = Math.max(0, (peerClass.total || 0) - (peerClass.done || 0))
    wx.showModal({
      title: '要下课了吗？',
      content: left ? `黑板上还有 ${left} 件事没讲清。下课后，老师按同学们听懂的来看这节课。` : '黑板上的事都讲清啦，下课吧！',
      confirmText: '下课',
      cancelText: '接着讲',
      success: (result) => {
        if (!result.confirm || this._isDestroyed) return
        this.post({ finish: true }).catch((error) => {
          if (!this._isDestroyed) wx.showToast({ title: error && error.message || '没有下课成功，请再点一次', icon: 'none', duration: 3000 })
        })
      }
    })
  },

  handleInput(event) {
    this.setData({ draft: String(event.detail.value || '').slice(0, MAX_ANSWER) })
    this.syncHint()
  },

  handleSend() {
    return this.sendSegment(this.data.draft, { fromDraft: true })
  },

  // 讲一段：先放进课堂记录，等同学们回应。fromDraft：打字发的，发出去才清空输入框；resend：进页面时补发没回应的那段
  async sendSegment(value, { fromDraft = false, resend = false } = {}) {
    const answer = String(value || '').trim().slice(0, MAX_ANSWER)
    if (!answer || this.data.sending || this.data.state !== 'class') return
    const turns = resend ? this.data.turns : this.data.turns.concat({ id: `t${this.data.turns.length}`, role: 'user', content: answer, speaker: 'learner' })
    const patch = { turns, records: classRecords(turns), lastSaid: answer, waitSeconds: 0 }
    if (fromDraft) Object.assign(patch, { draft: '', inputLines: 1 })
    this.setData(patch)
    this.startWaitClock()
    try {
      await this.post({ message: answer })
    } catch (error) {
      if (this._isDestroyed) return
      // 没送到：放回输入框（说话转出来的字也放回去，切到键盘看得到、改得了，点发送再试），课堂以服务端为准重新读取
      this.setData({ draft: answer, voiceMode: false })
      wx.showToast({ title: error && error.message || '这段没有发送成功，请重试', icon: 'none', duration: 3000 })
      this.refresh()
    } finally {
      this.stopWaitClock()
      if (!this._isDestroyed) this.render({ lastSaid: '', waitSeconds: 0 })
    }
  },

  // 讲完一段等同学们回应：每秒数一下，等久了提示条换说法
  startWaitClock() {
    this.stopWaitClock()
    const started = Date.now()
    this._waitClock = setInterval(() => {
      if (this._isDestroyed || !this.data.sending) return
      const waitSeconds = Math.floor((Date.now() - started) / 1000)
      if (waitSeconds !== this.data.waitSeconds) this.render({ waitSeconds })
    }, 1000)
  },

  stopWaitClock() {
    if (this._waitClock) clearInterval(this._waitClock)
    this._waitClock = null
  },

  handleVoiceButtonTap() {
    if (this.data.voiceRecognizing) return
    if (wx.hideKeyboard) wx.hideKeyboard()
    // 打字框随 wx:if 卸掉，不一定再报键盘高度 0：这里直接放回原位
    this.setData({ voiceMode: true, keyboardHeight: 0 })
  },

  handleKeyboardButtonTap() {
    if (this.data.voiceRecognizing) return
    this.setData({ voiceMode: false })
  },

  // 键盘弹起时底栏自己抬到键盘上方（adjust-position=false）：交给系统顶起整页时，平板上收起键盘后页面会停在错位处
  handleKeyboardHeightChange(event) {
    const height = Math.max(0, Math.round(Number(event && event.detail && event.detail.height) || 0))
    if (height !== this.data.keyboardHeight) this.setData({ keyboardHeight: height })
  },

  handleInputBlur() {
    if (this.data.keyboardHeight) this.setData({ keyboardHeight: 0 })
  },

  handleLineChange(event) {
    const detail = (event && event.detail) || {}
    const inputLines = Math.min(MAX_INPUT_LINES, Math.max(1, Number(detail.lineCount) || 1))
    if (inputLines !== this.data.inputLines) this.setData({ inputLines })
  },

  // ——— 按住说话 ——————————————————————————————————————
  handleSpeakTouchStart(event) {
    if (this._voiceTimer || this._asrBusy || this.data.voiceRecognizing || this.data.state !== 'class') return
    if (this.data.sending) {
      wx.showToast({ title: '同学们在记笔记，等一下再讲', icon: 'none' })
      return
    }
    // 同学们还在说：小老师一开口，大家就停下来听
    this.stopPlayback()
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
    this.render({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [], voiceRemaining: 0 })
    const chunks = this._asrChunks || []
    this._asrChunks = []
    this._asrBytes = 0
    if (canceled) return
    if (voiceByteLength(chunks) >= VOICE_MIN_BYTES) this.transcribeAndSend(chunks)
    else wx.showToast({ title: '说话时间太短，请重新按住', icon: 'none' })
  },

  async transcribeAndSend(chunks) {
    this._asrBusy = true
    wx.showLoading({ title: '正在识别…', mask: true })
    const { text, warning } = await transcribeVoiceChunks(chunks, { logTag: 'peer-class' })
    if (this._isDestroyed) return
    wx.hideLoading()
    this._asrBusy = false
    if (!text) {
      if (warning) wx.showToast({ title: warning, icon: 'none' })
      this.syncHint()
      return
    }
    this.sendSegment(text)
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
      content: '开启后可以按住说话，把学到的讲给同学们听。录音仅上传用于转成文字，识别完成后不保留。也可以点左边的键盘打字。',
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
    this.stopPlayback()
    this.stopHintSpeech()
    this.render({ voiceRecognizing: true, voiceCancel: false, voiceSoundActive: false, voiceBars: VOICE_BARS, voiceRemaining: 0 })
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
      this.render({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [], voiceRemaining: 0 })
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
    // 录满了：后面的话收不进去，与其悄悄丢掉，不如就此发出，孩子接着按住讲下一段
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
