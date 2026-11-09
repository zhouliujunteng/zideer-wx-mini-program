const { watchTeacherRoom, sayAsTeacher } = require('../../services/live-room-service')
const { buildTeacherRoomMessages, buildRoomSummary, buildTeacherRoom, blockedState } = require('../../services/teacher-room-view')
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

// 记录列表底部留白 = 输入框离底边的距离 + 这段（输入框本身连同上下留白的高度）
const LIST_BOTTOM_GAP = 112

// 老师端看这场会议的实时记录，并能插话。
// 版式照学生的诊断室（pages/diagnosis-room 的会议模式）：同一个顶栏、底色、气泡、课前语音条、输入框，
// 老师看到的就是学生屏幕上的样子（老师方向在左、带老师头像，学生在右）。
// 学生那边看到的永远是「老师说的」，所以这里发出去的字和 AI 的回复在学生屏幕上没有区别；
// 老师自己这边分得清（名字旁的「我发的 / AI 代答」），还能看到每一句学生读到没有。
//
// 输入框与诊断室同一套，也能按住说话（转成文字后以老师的身份发出去）；
// 但不搬诊断室那套为「手动摆放输入框」准备的键盘高度簿记——本页文字输入交给系统顶起（adjust-position 默认开），
// 少一套状态机就少一处会出错的地方。

function composerBottomOffset() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const safeArea = info.safeArea || {}
  const safeAreaBottom = Math.max(0, (info.screenHeight || info.windowHeight || 0) - (safeArea.bottom || info.windowHeight || 0))
  return Math.max(52, safeAreaBottom + 18)
}

const POLL_INTERVAL = 4000
// 记录末尾离可视区底边不超过这么多（px）就算「停在最新处」：新消息来了跟着滚；
// 老师翻上去看前面的对话时不动他的位置，改成显示「回到底部 / N 条新消息」按钮。
const FOLLOW_DISTANCE = 64
// 滚动停下这么久（ms）再量位置：惯性滚动期间 scroll 事件连续触发，停了才量得准
const SCROLL_SETTLE_MS = 140
// 与对话页同一招：scroll-top 给一个远大于记录高度的值，由 scroll-view 夹到真实底部；
// 每次 +1，因为原生组件对「目标值不变」不会再滚一次。
const BOTTOM_SCROLL_REQUEST = 1000000
// 房间这几项变了才重画顶栏、提示与结尾卡片；轮询没带新东西时一次 setData 都不发
const ROOM_KEYS = ['title', 'teacherName', 'teacherAvatarUrl', 'voiceUrl', 'voiceDurationText', 'phase', 'closedReason', 'standbyTitle', 'standbyHint', 'composerNote']

function sameRoom(a, b) {
  return Boolean(a && b) && ROOM_KEYS.every((key) => a[key] === b[key])
}

Page({
  data: {
    loadState: 'loading',
    stateTitle: '',
    stateCopy: '',
    room: {},
    summary: '',
    messages: [],
    draft: '',
    sending: false,
    scrollTop: 0,
    showJump: false,
    unseenCount: 0,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    composerBottomOffset: 52,
    listBottomPadding: 52 + LIST_BOTTOM_GAP,
    // 按住说话：与诊断室同一套
    voiceMode: false,
    voiceRecognizing: false,
    voiceCancel: false,
    voiceSoundActive: false,
    voiceBars: VOICE_BARS,
    microphonePermission: 'unknown'
  },

  onLoad(options) {
    attachUiAssets(this)
    const bottomOffset = composerBottomOffset()
    const navigation = getNavigationMetrics()
    this.setData({
      statusBarHeight: navigation.statusBarHeight,
      navigationBarHeight: navigation.navigationBarHeight,
      contentTop: navigation.contentTop,
      composerBottomOffset: bottomOffset,
      listBottomPadding: bottomOffset + LIST_BOTTOM_GAP,
      // 从学生详情带过来的学科：第一次读到记录前顶栏就有标题
      room: buildTeacherRoom({ subject: decodeURIComponent(String((options && options.subject) || '')) })
    })
    this.inviteId = String((options && options.inviteId) || '')
    // 学生编号（从学生详情进来才有）：右上角「目标导图」看学生按目标测评测出的卡点和已做的课
    this.studentProfileId = /^[1-9][0-9]*$/.test(String((options && options.studentProfileId) || '')) ? String(options.studentProfileId) : ''
    this.setData({ goalMapEntry: Boolean(this.studentProfileId) })
    this._since = '0'
    this._rows = []
    this._invite = null
    this._clockOffset = 0
    this._following = true
    this._scrollRequest = 0
    this._playingVoiceId = ''
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
    this._visible = true
    this._isPageVisible = true
    const bridge = getRecorderBridge()
    if (bridge) bridge.attach(this)
    this.loadRoom()
    this.startPolling()
  },

  onHide() {
    this._visible = false
    this._isPageVisible = false
    this.stopPolling()
    this.stopVoicePlayback()
    this.abortVoiceInput()
  },

  onUnload() {
    this._destroyed = true
    this._isDestroyed = true
    this._isPageVisible = false
    this.stopPolling()
    this.cancelMeasure()
    this.abortVoiceInput(true)
    if (this._voiceAudio) {
      this._voiceAudio.destroy()
      this._voiceAudio = null
    }
  },

  onPullDownRefresh() {
    // 下拉当成「从头再读一遍」：记录不多，重读比猜哪里缺一条可靠。
    this._since = '0'
    this._rows = []
    this._following = true
    this.loadRoom().then(() => wx.stopPullDownRefresh())
  },

  handleBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.redirectTo({ url: '/teacher/workspace/index' })
  },

  startPolling() {
    if (this._timer || this._destroyed) return
    this._timer = setInterval(() => this.loadRoom(), POLL_INTERVAL)
  },

  stopPolling() {
    if (!this._timer) return
    clearInterval(this._timer)
    this._timer = null
  },

  openGoalMap() {
    if (!this.studentProfileId) return
    wx.navigateTo({ url: `/learning/goal-diagnosis/index?studentProfileId=${encodeURIComponent(this.studentProfileId)}` })
  },

  async loadRoom() {
    if (this._loading || this._destroyed || !this.inviteId) return
    this._loading = true
    try {
      const requestedAt = Date.now()
      const result = await watchTeacherRoom({ inviteId: this.inviteId, since: this._since })
      if (this._destroyed) return
      if (result.status !== 'ready') {
        this.stopPolling()
        const blocked = blockedState(result.status)
        this.setData({ loadState: 'blocked', stateTitle: blocked.title, stateCopy: blocked.copy })
        return
      }
      // 开没开始以服务端时间为准：老师手机时钟偏几分钟，不该提前或延后显示「已上线」
      const serverNow = Date.parse(result.serverNow || '')
      if (Number.isFinite(serverNow)) this._clockOffset = serverNow - requestedAt
      if (result.lastId) this._since = result.lastId
      this.appendRows(result.messages, result.invite)
    } catch (error) {
      if (this._destroyed) return
      // 已经读到过（哪怕还没人说话）就不要把画面换成错误页：下一轮轮询会补上。
      if (this.data.loadState !== 'ready') {
        this.setData({ loadState: 'blocked', stateTitle: '暂时读不到', stateCopy: (error && error.message) || '请检查网络后重试。' })
      }
    } finally {
      this._loading = false
    }
  },

  // 头像、名字、语音地址只在从头读时返回：增量轮询带回来的 invite 没有这几项，合并时保留上一次的值。
  buildRoom(invite) {
    if (invite) this._invite = Object.assign({}, this._invite, invite)
    return buildTeacherRoom(this._invite || {}, { now: Date.now() + this._clockOffset, rows: this._rows })
  },

  buildMessages(room) {
    return buildTeacherRoomMessages(this._rows, { durationText: room.voiceDurationText })
      .map((item) => (item.kind === 'voice' && item.id === this._playingVoiceId ? Object.assign(item, { playing: true }) : item))
  },

  // toBottom：老师自己刚发了一句，无论翻到哪都回到底部看它。
  appendRows(rows, invite, { toBottom = false } = {}) {
    const known = {}
    this._rows.forEach((row) => { known[row.id] = true })
    const fresh = (rows || []).filter((row) => !known[row.id])
    const firstPaint = this.data.loadState !== 'ready'
    this._rows = this._rows.concat(fresh)
    const room = this.buildRoom(invite)
    const roomChanged = !sameRoom(room, this.data.room)
    // 轮询绝大多数时候没有新消息：不重绘整列，也就不去碰老师正在看的位置。
    // 以前每 4 秒都整列重绘并把 scroll-into-view 设到最后一条，老师往上翻会被硬拉回底部。
    if (!fresh.length && !firstPaint && !toBottom) {
      // 没有新消息但房间变了（到点上线、会议结束）：只换房间，不动列表和位置
      if (roomChanged) this.setData({ room })
      return
    }
    const messages = this.buildMessages(room)
    const patch = {
      loadState: 'ready',
      room,
      messages,
      summary: buildRoomSummary(messages)
    }
    const follow = firstPaint || toBottom || this._following
    if (follow) {
      this._following = true
      Object.assign(patch, { showJump: false, unseenCount: 0 }, this.bottomScrollPatch())
    } else {
      Object.assign(patch, { showJump: true, unseenCount: this.data.unseenCount + fresh.length })
    }
    this.setData(patch, follow ? () => this.repeatBottomScroll() : undefined)
  },

  bottomScrollPatch() {
    // 程序滚动前先作废还没量的位置：内容刚变长、还没滚下去时量到的「离底很远」是假的
    this.cancelMeasure()
    this._scrollRequest = Math.max(BOTTOM_SCROLL_REQUEST, this._scrollRequest, Number(this.data.scrollTop) || 0) + 1
    return { scrollTop: this._scrollRequest }
  },

  // 新记录与滚动请求同一次 setData 下发时，scroll-view 可能还没排好新内容就去夹最大值；
  // 下一帧再要一次（与对话页「回到底部」相同），确保真的落到最后一条。
  repeatBottomScroll() {
    if (this._destroyed || !this._following || typeof wx.nextTick !== 'function') return
    wx.nextTick(() => {
      if (!this._destroyed && this._following) this.setData(this.bottomScrollPatch())
    })
  },

  handleListTouchStart() {
    // 手一碰上记录就先停止跟随：这时下发滚动会和手指抢位置。松手、滚停后再按实测位置决定。
    this._touching = true
    this._following = false
    this.cancelMeasure()
  },

  handleListTouchEnd() {
    this._touching = false
    this.scheduleMeasure()
  },

  handleListScroll() {
    this.scheduleMeasure()
  },

  scheduleMeasure() {
    this.cancelMeasure()
    this._measureTimer = setTimeout(() => {
      this._measureTimer = null
      this.measureFollow()
    }, SCROLL_SETTLE_MS)
  },

  cancelMeasure() {
    if (!this._measureTimer) return
    clearTimeout(this._measureTimer)
    this._measureTimer = null
  },

  measureFollow() {
    if (this._destroyed || this._touching || typeof wx.createSelectorQuery !== 'function') return
    const query = wx.createSelectorQuery()
    query.select('#room-list').boundingClientRect()
    query.select('#room-tail').boundingClientRect()
    query.exec((results) => {
      if (this._destroyed || this._touching) return
      const list = results && results[0]
      const tail = results && results[1]
      if (!list || !tail) return
      // scroll-view 底部用 padding 给输入框让了位：滚到底时，记录末尾正好停在这段留白的上沿
      const visibleBottom = list.bottom - this.data.listBottomPadding
      this.applyFollow(tail.bottom - visibleBottom <= FOLLOW_DISTANCE)
    })
  },

  applyFollow(following) {
    this._following = following
    const patch = {}
    if (this.data.showJump === following) patch.showJump = !following
    if (following && this.data.unseenCount) patch.unseenCount = 0
    if (Object.keys(patch).length) this.setData(patch)
  },

  handleJumpToBottom() {
    this._following = true
    this.setData({ showJump: false, unseenCount: 0, ...this.bottomScrollPatch() }, () => this.repeatBottomScroll())
  },

  // ——— 课前语音：和学生那边同一个语音条，点一下播放 / 暂停 ————————————
  handleVoicePlay(event) {
    const id = String((event && event.currentTarget && event.currentTarget.dataset.id) || '')
    const url = (this.data.room || {}).voiceUrl
    if (!url) {
      wx.showToast({ title: '暂时读不到这段语音，请稍后再试', icon: 'none' })
      return
    }
    if (!this._voiceAudio) {
      this._voiceAudio = wx.createInnerAudioContext()
      this._voiceAudio.onEnded(() => this.setVoicePlaying(''))
      this._voiceAudio.onStop(() => this.setVoicePlaying(''))
      this._voiceAudio.onError(() => {
        this.setVoicePlaying('')
        wx.showToast({ title: '语音播放失败，请稍后重试', icon: 'none' })
      })
    }
    if (this._playingVoiceId === id) {
      this._voiceAudio.pause()
      this.setVoicePlaying('')
      return
    }
    this._voiceAudio.src = url
    this._voiceAudio.play()
    this.setVoicePlaying(id)
  },

  setVoicePlaying(id) {
    this._playingVoiceId = id
    const patch = {}
    ;(this.data.messages || []).forEach((item, index) => {
      if (item.kind !== 'voice') return
      const playing = item.id === id
      if (Boolean(item.playing) !== playing) patch[`messages[${index}].playing`] = playing
    })
    if (Object.keys(patch).length && !this._destroyed) this.setData(patch)
  },

  stopVoicePlayback() {
    if (this._voiceAudio && this._playingVoiceId) this._voiceAudio.stop()
    this.setVoicePlaying('')
  },

  // ——— 输入：打字或按住说话 ————————————————————————————
  handleInput(event) {
    this.setData({ draft: String(event.detail.value || '') })
  },

  handleSend() {
    return this.sendText(this.data.draft, { fromDraft: true })
  },

  // fromDraft：打字发的，发出去才清空输入框；说话转出来的字发不出去时放回输入框，不丢
  async sendText(value, { fromDraft = false } = {}) {
    const text = String(value || '').trim()
    if (!text || this.data.sending) return
    if ((this.data.room || {}).phase === 'closed') {
      wx.showToast({ title: blockedState('room_closed').copy, icon: 'none' })
      return
    }
    this.setData({ sending: true })
    let sent = false
    try {
      const result = await sayAsTeacher({
        inviteId: this.inviteId,
        text,
        clientKey: `t-${Date.now()}`,
        since: this._since
      })
      if (this._destroyed) return
      if (result.status !== 'ready') {
        wx.showToast({ title: blockedState(result.status).title, icon: 'none' })
        // 会议在别处结束了：下一轮轮询会把结尾卡片补上，这里先马上读一次
        if (result.status === 'room_closed') this.loadRoom()
        return
      }
      sent = true
      if (result.lastId) this._since = result.lastId
      if (fromDraft) this.setData({ draft: '' })
      this.appendRows(result.messages, null, { toBottom: true })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '发送失败，请重试', icon: 'none' })
    } finally {
      if (!this._destroyed) {
        const patch = { sending: false }
        if (!sent && !fromDraft) Object.assign(patch, { draft: text, voiceMode: false })
        this.setData(patch)
      }
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
    if (this._voiceTimer || this._asrBusy || this.data.voiceRecognizing) return
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
    this.setData({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [] }, () => {
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
    const { text, warning } = await transcribeVoiceChunks(chunks, { logTag: 'teacher-live-room' })
    if (this._destroyed) return
    wx.hideLoading()
    this._asrBusy = false
    if (!text) {
      if (warning) wx.showToast({ title: warning, icon: 'none' })
      return
    }
    // 正在发上一句：先放进输入框，等它发完再由老师自己点发送
    if (this.data.sending) {
      this.setData({ voiceMode: false, draft: text })
      wx.showToast({ title: '已识别，等上一句发完再发送', icon: 'none' })
      return
    }
    this.sendText(text)
  },

  requestVoicePermissionAndStart() {
    if (this.data.voiceRecognizing || this._asrBusy) return
    if (this.data.microphonePermission === 'granted') {
      this.startVoiceInput()
      return
    }
    if (this._permissionRequestPending) return
    this._permissionRequestPending = true
    const resolvePermission = (granted) => {
      this._permissionRequestPending = false
      if (this._destroyed) return
      this.setData({ microphonePermission: granted ? 'granted' : 'denied' })
      if (!granted) {
        this.showVoicePermissionRecovery()
        return
      }
      // 授权弹窗期间手指可能已经松开：那就只记下授权，不自己开始录
      if (this._voiceTouching) this.startVoiceInput()
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

  showVoicePermissionRecovery() {
    wx.showModal({
      title: '需要麦克风权限',
      content: '开启后可按住说话输入。录音仅上传用于转成文字，识别完成后不保留。',
      confirmText: '去设置',
      cancelText: '暂不开启',
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting({})
      }
    })
  },

  startVoiceInput() {
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.setData({ voiceRecognizing: true, voiceCancel: false, voiceSoundActive: false, voiceBars: VOICE_BARS })
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
      this.setData({ voiceRecognizing: false, voiceCancel: false, voiceSoundActive: false, voiceBars: [] })
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
    if (!this.data.voiceRecognizing) return
    const now = Date.now()
    const snapshot = this._pcmLevelMeter.getSnapshot(now)
    const live = Boolean(this._recorderActive && this._pcmLevelAvailable)
    // 开发者工具没有 PCM 帧：用合成的起伏；真机以实测电平为准
    this.setData({
      voiceSoundActive: live && snapshot.fresh ? snapshot.level >= 0.06 : true,
      voiceBars: live ? createVoiceBars(snapshot.barLevels) : createFallbackVoiceBars(now)
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
    this._pcmLevelMeter.reset()
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
    if (!this.data.voiceRecognizing || !this._isPageVisible || this._destroyed) {
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
  }
})
