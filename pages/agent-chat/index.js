const { getAgentChatModel } = require('../../services/mock-service')
const {
  analyzePcm16LeFrame,
  smoothLevel,
  updateMicrophoneEnvelope
} = require('../../utils/ai-voice-visualizer')
const { getSharedRecorderBridge } = require('../../utils/recorder-session-bridge')
const { COURSE_PORTAL_ORIGIN } = require('../../config/index')
const ASR_TRANSCRIBE_URL = COURSE_PORTAL_ORIGIN + '/api/asr/transcribe'
const { renderMarkdown } = require('../../utils/markdown')
const { rememberAgentCourseFocus } = require('../../utils/agent-course-focus')
const {
  COURSE_AGENT,
  createCourseAgentSession,
  sendCourseAgentMessage,
  cancelCourseAgentSession,
  fetchCourseAgentSession,
  listCourseAgentSessions,
  streamCourseAgentEvents,
  rememberCourseAgentSession,
  recallCourseAgentSession,
  forgetCourseAgentSession,
  ensureCourseAgentAccess,
  clearCourseAgentAccess,
  playMockCourseAgentTimeline
} = require('../../services/course-agent-service')
const { presentToolLine, summarizeTopic, thinkingSummary } = require('../../utils/course-agent-fold')
const { REVEAL_TICK_MS, createStreamReveal, renderRevealFrame } = require('../../utils/stream-reveal')
const { ensureZionSession } = require('../../services/zion-auth-service')
const { attachUiAssets } = require('../../services/ui-assets')
const {
  LEARNING_MODES,
  toggleLearningMode,
  optionsSignature,
  buildAgentMessageText,
  stripLearningAppendix
} = require('../../utils/learning-options')

const REPLY_DELAY = 260
// 学习基本盘读取上限：超时就不带基本盘发送，由智能体完整摸底。
const LEARNER_BASELINE_TIMEOUT_MS = 8000
// 「回到底部」按钮距输入区的高度（含学习选项行）
const SCROLL_BUTTON_GAP = 120
// ask_user 里带这个 id 的选项是「确认生成课程」，渲染为主按钮
const CONFIRM_GENERATE_OPTION_ID = 'confirm_generate'
// 服务端常在同一毫秒连发多个工具调用：可见活动项之间至少间隔这么久，逐条出现
const ACTIVITY_STAGGER_MS = 360
// 问题卡 / 课程卡 / 结束帧等正文渐显收尾后再出现，最多等这么久
const REVEAL_SETTLE_WAIT_MS = 2500
// 不单独展示为工具卡的工具：ask_user 由问题卡呈现
const HIDDEN_ACTIVITY_TOOLS = ['ask_user']
const WAIT_FOR_REVEAL_EVENTS = ['user_question', 'stage_link', 'course_link', 'course_generation', 'session_end']
// 事件快照到达频率可能高于渲染需要：活动流与流式正文统一按此节流 setData。
const AGENT_RENDER_THROTTLE_MS = 120
// Zion 当前不开 streaming；用较少次数的成组更新做前端伪流式展示，
// 减少 rich-text 反复重排造成的卡顿，同时保持偏快的阅读节奏。
const FAKE_STREAM_INTERVAL = 70
const FAKE_STREAM_CHARS_PER_TICK = 2
const VOICE_LONG_PRESS_DELAY = 320
const AUDIO_VISUALIZER_INTERVAL = 50
const MICROPHONE_FRAME_TIMEOUT = 800
const KEYBOARD_SETTLE_DELAY = 100
const KEYBOARD_OPEN_TIMEOUT = 1000
const CHAT_TOUCH_RELEASE_PROBE_DELAYS = [0, 120, 280]
// 让轻微的橡皮筋回弹也能被视为“已到底”，但不在用户仍处于拖动手势时抢回列表。
const CHAT_NEAR_BOTTOM_DISTANCE = 64
const CHAT_BOTTOM_DISTANCE = 24
const CHAT_BOTTOM_SCROLL_REQUEST = 1000000
const RECORDER_FORMAT = 'PCM'
const RECORDER_OPTIONS = Object.freeze({
  duration: 600000,
  sampleRate: 16000,
  numberOfChannels: 1,
  format: RECORDER_FORMAT,
  frameSize: 2
})
const RECORDER_FRAMES_ARE_PCM16_LE = RECORDER_FORMAT === 'PCM'
const VOICE_BAR_COUNT = 42
const VOICE_BAR_MIN_HEIGHT = 4
const VOICE_BAR_MAX_HEIGHT = 54
const VOICE_BAR_NOISE_FLOOR_DB = -58
const VOICE_BAR_CEILING_DB = -2
const VOICE_BAR_SILENCE_RMS = 0.012

function clampVoiceValue(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function mapPcmBandToLevel(rms) {
  const safeRms = Math.max(0.000001, Number(rms) || 0)
  const decibels = 20 * Math.log10(safeRms)
  const normalized = Math.max(0, Math.min(1, (
    decibels - VOICE_BAR_NOISE_FLOOR_DB
  ) / (VOICE_BAR_CEILING_DB - VOICE_BAR_NOISE_FLOOR_DB)))
  // A super-linear curve deliberately reduces sensitivity around ordinary room
  // noise and quiet consonants. Only genuinely loud samples approach the top.
  return Math.pow(normalized, 1.5)
}

function createVoiceBars(levels) {
  const barLevels = Array.isArray(levels) ? levels : []
  if (!barLevels.length) return []
  return barLevels.map((level, index) => {
    const energy = clampVoiceValue(level)
    const height = VOICE_BAR_MIN_HEIGHT + energy * (VOICE_BAR_MAX_HEIGHT - VOICE_BAR_MIN_HEIGHT)
    return {
      id: index,
      height: Math.round(height * 10) / 10,
      opacity: Math.round((0.34 + energy * 0.66) * 100) / 100
    }
  })
}

function createFallbackVoiceBars(now = 0) {
  const time = (Number(now) || 0) / 1000
  const syllable = (Math.sin(time * 3.1 + 0.4) + 1) / 2
  const phrase = (Math.sin(time * 1.18 - 0.7) + 1) / 2
  const energy = 0.12 + syllable * 0.34 + phrase * 0.2
  const levels = Array.from({ length: VOICE_BAR_COUNT }, (_, index) => {
    const position = index / Math.max(1, VOICE_BAR_COUNT - 1)
    const carrier = (Math.sin(time * 5.2 + position * 10.4) + 1) / 2 * 0.62 +
      (Math.sin(time * 8.6 - position * 6.8 + 0.7) + 1) / 2 * 0.24 +
      (Math.sin(time * 2.1 + position * 18.2) + 1) / 2 * 0.14
    return Math.min(1, energy * (0.25 + carrier * 0.75))
  })
  return createVoiceBars(levels)
}

const VOICE_BARS = createFallbackVoiceBars(0)

let recorderBridge = null

function discardTemporaryRecording(filePath) {
  if (!filePath || !wx.getFileSystemManager) return
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} })
  } catch (error) {
    // Temporary audio cleanup is best effort; the path is never retained.
  }
}

function getRecorderBridge() {
  if (!recorderBridge) recorderBridge = getSharedRecorderBridge({ discardTemporaryRecording })
  return recorderBridge
}

const VOICE_SAMPLE_RATE = 16000

function asciiBytes(text) {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

// 16kHz 单声道 PCM16LE 帧 → WAV → multipart/form-data 请求体（字段名 audio）
function buildVoiceMultipartBody(chunks, boundary) {
  const dataBytes = chunks.reduce((sum, chunk) => sum + (chunk && chunk.byteLength || 0), 0)
  const head = asciiBytes(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\nContent-Type: audio/wav\r\n\r\n`)
  const tail = asciiBytes(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + 44 + dataBytes + tail.length)
  body.set(head, 0)
  const wavStart = head.length
  const view = new DataView(body.buffer, wavStart, 44)
  const writeStr = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)) }
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, VOICE_SAMPLE_RATE, true)
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeStr(36, 'data'); view.setUint32(40, dataBytes, true)
  let offset = wavStart + 44
  for (const chunk of chunks) {
    if (!chunk || !chunk.byteLength) continue
    body.set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }
  body.set(tail, offset)
  return body
}

function createPcmLevelMeter(onLevel) {
  let level = 0
  let peak = 0.012
  let lastFrameAt = 0
  let barLevels = Array.from({ length: VOICE_BAR_COUNT }, () => 0)

  return {
    reset() {
      level = 0
      peak = 0.012
      lastFrameAt = 0
      barLevels = Array.from({ length: VOICE_BAR_COUNT }, () => 0)
    },

    process(frameBuffer, now = Date.now()) {
      if (!RECORDER_FRAMES_ARE_PCM16_LE) return false
      const analysis = analyzePcm16LeFrame(frameBuffer, { bandCount: VOICE_BAR_COUNT })
      if (!analysis.valid) return false
      const envelope = updateMicrophoneEnvelope(level, peak, analysis.rms)
      level = envelope.level
      peak = envelope.peak
      lastFrameAt = now
      const targetBars = analysis.rms <= VOICE_BAR_SILENCE_RMS
        ? Array.from({ length: VOICE_BAR_COUNT }, () => 0)
        : Array.isArray(analysis.bands)
          ? analysis.bands.map(mapPcmBandToLevel)
          : []
      barLevels = Array.from({ length: VOICE_BAR_COUNT }, (_, index) => smoothLevel(
        barLevels[index] || 0,
        targetBars[index] || 0,
        0.46,
        0.48
      ))
      if (typeof onLevel === 'function') onLevel({ level, peak, lastFrameAt, barLevels })
      return true
    },

    getSnapshot(now = Date.now()) {
      const fresh = Boolean(lastFrameAt && now - lastFrameAt <= MICROPHONE_FRAME_TIMEOUT)
      if (lastFrameAt && !fresh) {
        level = smoothLevel(level, 0, 0.5, 0.12)
        barLevels = barLevels.map((value) => smoothLevel(value, 0, 0.5, 0.48))
      }
      return { level, peak, lastFrameAt, fresh, barLevels }
    }
  }
}

function getNavigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const windowWidth = windowInfo.windowWidth || 375
  const menuButton = wx.getMenuButtonBoundingClientRect
    ? wx.getMenuButtonBoundingClientRect()
    : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
  const statusBarHeight = windowInfo.statusBarHeight || 20
  const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
  const safeArea = windowInfo.safeArea || {}
  const safeAreaBottom = Math.max(0, (windowInfo.screenHeight || windowInfo.windowHeight || 0) - (safeArea.bottom || windowInfo.windowHeight || 0))
  const composerBottomOffset = Math.max(52, safeAreaBottom + 18)
  return {
    statusBarHeight,
    navigationBarHeight,
    menuButtonHeight: menuButton.height,
    historyTop: menuButton.top,
    historyRight: windowWidth - menuButton.left + 8,
    contentTop: statusBarHeight + navigationBarHeight + 16 * windowWidth / 750,
    safeAreaBottom,
    composerBottomOffset,
    scrollButtonBottom: composerBottomOffset + SCROLL_BUTTON_GAP
  }
}

function normalizeMessageTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function padTimePart(value) {
  return String(value).padStart(2, '0')
}

// Reply metadata stays presentation-only: today uses HH:mm, older messages use MM/DD HH:mm.
function formatReplyTime(value) {
  const timestamp = normalizeMessageTimestamp(value)
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
  return isToday ? time : `${padTimePart(date.getMonth() + 1)}/${padTimePart(date.getDate())} ${time}`
}

function formatHistoryItemTime(value) {
  const date = new Date(normalizeMessageTimestamp(value))
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
}

function getMarkdownLineUnits(value) {
  return Array.from(String(value || '')).reduce((total, character) => {
    // 中文、全角标点和 emoji 大致占一个字宽；拉丁字符和数字按半宽估算。
    return total + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.56)
  }, 0)
}

function getAssistantLineCapacity() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  const windowWidth = Number(windowInfo && windowInfo.windowWidth) || 375
  const rpx = windowWidth / 750
  const shellWidth = windowWidth - 60 * rpx
  const bubbleWidth = shellWidth * 0.88
  const horizontalPadding = 48 * rpx
  // renderMarkdown 使用 15px 字号；最终折行仍由 rich-text 原生排版决定。
  return Math.max(12, (bubbleWidth - horizontalPadding) / 15)
}

function shouldReserveStreamLine(text, nextCharacter, upcomingCharacters = []) {
  const source = String(text || '')
  if (!source || nextCharacter === undefined) return false
  // 下一字符是换行，或当前已经输出了换行但下一行还没有内容。
  if (source.endsWith('\n') || nextCharacter === '\n' || upcomingCharacters.includes('\n')) return true
  const lastLine = source.slice(source.lastIndexOf('\n') + 1)
  const capacity = getAssistantLineCapacity()
  const lineUnits = getMarkdownLineUnits(lastLine)
  const currentLineUnits = lineUnits % capacity
  // 使用“当前视觉行”而不是整段文本判断；否则第一次自然折行后会一直
  // 保留空行。整除时表示刚好填满一行，下一字符会开启新的视觉行。
  return currentLineUnits === 0 || currentLineUnits >= capacity - 1.25
}

function copyMessage(message) {
  const text = message.text || ''
  const createdAt = normalizeMessageTimestamp(message.createdAt)
  return {
    id: message.id,
    role: message.role,
    text,
    markdownNodes: message.role === 'assistant' && text ? renderMarkdown(text) : '',
    createdAt,
    createdAtLabel: message.createdAtLabel || formatReplyTime(createdAt),
    isTyping: Boolean(message.isTyping),
    streamReserveLine: Boolean(message.streamReserveLine),
    feedback: message.feedback || ''
  }
}

function filterHistory(items, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query) return items.slice()
  // keywords 是不展示的提问原文：标题是总结之后，按原话搜索仍要命中。
  return items.filter((item) =>
    `${item.title} ${item.preview} ${item.keywords || ''}`.toLowerCase().includes(query))
}

function getHistoryDayKey(value) {
  const date = new Date(normalizeMessageTimestamp(value))
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`
}

function formatHistorySectionLabel(value) {
  const timestamp = normalizeMessageTimestamp(value)
  const date = new Date(timestamp)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDistance = Math.round((startOfToday - startOfDate) / 86400000)
  if (dayDistance === 0) return '今日'
  if (dayDistance === 1) return '昨日'
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function groupHistory(items, keyword) {
  const sections = []
  const sectionMap = {}
  filterHistory(items, keyword)
    .slice()
    .sort((left, right) => normalizeMessageTimestamp(right.createdAt || right.time) - normalizeMessageTimestamp(left.createdAt || left.time))
    .forEach((item) => {
      const key = getHistoryDayKey(item.createdAt || item.time)
      if (!sectionMap[key]) {
        sectionMap[key] = { key, label: formatHistorySectionLabel(item.createdAt || item.time), items: [] }
        sections.push(sectionMap[key])
      }
      sectionMap[key].items.push(item)
    })
  return sections
}

function stripUserInputPrefix(text) {
  return String(text || '').replace(/^用户输入：\s*/, '')
}

// pi 的 assistant 消息是内容块数组；流式快照与最终帧都取全部文本块拼接。
function agentBlocksText(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : []
  return blocks
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('')
    .trim()
}

function formatAgentDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return ''
  const seconds = Math.max(1, Math.round((Number(endedAt) - Number(startedAt)) / 1000))
  return `${seconds}s`
}

function getZionMessageText(message) {
  const contents = Array.isArray(message && message.contents) ? message.contents : []
  return contents
    .map((content) => content && content.text)
    .filter((text) => typeof text === 'string' && text)
    .join('\n')
}

function mapZionConversation(row) {
  const messages = (Array.isArray(row && row.messages) ? row.messages : [])
    .filter((message) => ['user', 'assistant'].includes(String(message && message.role || '').toLowerCase()))
    .map((message) => {
      const role = String(message.role).toLowerCase()
      const rawText = getZionMessageText(message)
      const text = role === 'user' ? stripUserInputPrefix(rawText) : rawText
      const createdAt = normalizeMessageTimestamp(message.created_at || row.updated_at || row.created_at)
      return copyMessage({
        id: `zion-message-${message.id}`,
        role,
        text,
        createdAt,
        createdAtLabel: formatReplyTime(createdAt)
      })
    })
    .filter((message) => message.text)
  const firstUser = messages.find((message) => message.role === 'user')
  const firstAssistant = messages.find((message) => message.role === 'assistant')
  const conversationId = Number(row && row.id)
  const createdAt = normalizeMessageTimestamp(row && (row.updated_at || row.created_at))
  return {
    id: `zion-conversation-${conversationId}`,
    conversationId,
    title: firstUser ? firstUser.text.slice(0, 24) : `对话 ${conversationId}`,
    preview: firstAssistant ? firstAssistant.text.slice(0, 42) : (firstUser ? firstUser.text.slice(0, 42) : '暂无消息'),
    time: formatHistoryItemTime(createdAt),
    createdAt,
    messages
  }
}

Page({
  data: {
    model: {},
    messages: [],
    inputValue: '',
    inputActive: false,
    inputFocus: false,
    voiceMode: false,
    canSend: false,
    isSending: false,
    voiceHolding: false,
    voiceRecognizing: false,
    voiceCancel: false,
    voiceSoundActive: false,
    microphonePermission: 'unknown',
    voiceBars: VOICE_BARS,
    scrollIntoView: 'chat-bottom',
    scrollTop: 0,
    showScrollToBottom: false,
    historyVisible: false,
    historyClosing: false,
    historySearch: '',
    historyItems: [],
    historySections: [],
    historyLoading: false,
    historyNotice: '',
    authState: 'unknown',
    activeHistoryId: 'current-demo',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    menuButtonHeight: 32,
    historyTop: 26,
    historyRight: 100,
    contentTop: 80,
    safeAreaBottom: 0,
    keyboardHeight: 0,
    composerBottomOffset: 52,
    scrollButtonBottom: 172,
    // 学习选项：参考我的宇宙默认开；三个学习模式互斥，可都不选
    includeUniverse: true,
    learningModes: LEARNING_MODES.map(({ id, label }) => ({ id, label })),
    activeLearningMode: ''
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    // 首页带问题进入：待模型初始化后直接发送
    this._entryPrompt = decodeURIComponent(String(options.prompt || '')).trim()
    this._replyTimer = null
    this._replyInterval = null
    this._fakeStreamTimer = null
    this._historyRequestToken = 0
    // 课程智能体（OpenMAIC 控制面）会话与事件流状态
    this._agentSessionId = ''
    this._agentSessionTerminal = false
    this._agentRunToken = 0
    this._agentActive = false
    this._agentStream = null
    this._agentReconnectAttempts = 0
    this._agentReconnectTimer = null
    this._agentRenderTimer = null
    this._agentStreamText = null
    this._agentStreamFlush = null
    this._agentAccessPromise = null
    this._lastAgentEventId = 0
    this._agentMock = String(options.mock || '') === '1'
    // 流式正文匀速渐显：{ id, engine }；事件流追平（caught_up）后才启用，历史回放直接整段渲染
    this._streamReveal = null
    this._streamRevealTimer = null
    this._agentStreamLive = this._agentMock
    // 事件节拍队列：直播时工具项逐条出现、问题卡等正文收尾；回放时同步处理
    this._agentEventQueue = []
    this._agentEventTimer = null
    this._nextActivityAt = 0
    this._revealWaitStartedAt = 0
    this._runThinkingId = ''
    // 本会话已发送过的学习选项签名 / 是否已发送学习基本盘；新会话时重置
    this._sentOptionsSignature = ''
    this._baselineSent = false
    this._baselinePromise = null
    this._activeQuestion = null
    this._questionSelections = {}
    this._chatFollowEnabled = true
    this._chatScrollQueryTimer = null
    this._chatScrollStateVersion = 0
    this._chatTouchActive = false
    this._chatTouchDidMove = false
    this._chatTouchStartY = 0
    this._lastChatScrollDistance = 0
    this._chatTouchReleaseProbeToken = 0
    this._chatTouchReleaseTimers = []
    this._chatForceFollowUntilBottom = false
    this._chatManualScrollLocked = false
    this._chatScrollTopRequest = 0
    this._scrollToBottomTimer = null
    // app.js 已在 onLaunch 发起静默登录；页面优先复用启动 Promise，避免进页后才登录。
    const app = typeof getApp === 'function' ? getApp() : null
    const appAuthPromise = app && app.globalData && app.globalData.zionAuthPromise
    const authPromise = appAuthPromise || ensureZionSession({ allowAnonymous: true })
    this._authPromise = authPromise
      .then((auth) => {
        if (!this._isDestroyed) {
          this.setData({ authState: auth && auth.error
            ? 'error'
            : auth && auth.accountId
              ? 'authenticated'
              : 'anonymous' })
        }
        return auth
      })
      .catch((error) => {
        if (!this._isDestroyed) this.setData({ authState: 'error' })
        // 允许下一次发送或打开历史时重新获取 wx.login code，避免一次网络失败锁住页面。
        this._authPromise = null
        return { error, token: '', accountId: null }
      })
    this._voiceTimer = null
    this._touchVoiceStarted = false
    this._voiceStartY = 0
    this._voiceCancel = false
    this._voiceTouching = false
    this._voiceVisualizerTimer = null
    this._permissionRequestPending = false
    this._keyboardHeightTimer = null
    this._keyboardOpenTimer = null
    this._inputFocusTimer = null
    this._inputFocusRequested = false
    this._inputFocusRearming = false
    this._recorderStartPending = false
    this._recorderSessionId = null
    this._recorderActive = false
    this._microphoneLevel = 0
    this._microphonePeak = 0.012
    this._pcmLevelAvailable = false
    this._lastRecorderFrameAt = 0
    this._pcmLevelMeter = createPcmLevelMeter((snapshot) => {
      this._microphoneLevel = snapshot.level
      this._microphonePeak = snapshot.peak
      this._lastRecorderFrameAt = snapshot.lastFrameAt
    })
    this._ignoreNextComposerTap = false
    const metrics = getNavigationMetrics()
    const model = getAgentChatModel('local-demo', 'ready')
    const historyItems = model.history && Array.isArray(model.history.conversations)
      ? model.history.conversations.slice()
      : []
    this.setData({
      ...metrics,
      // 首页「参考我的学习宇宙」开关与模式随入口带入
      includeUniverse: String(options.universe || '') !== '0',
      activeLearningMode: toggleLearningMode('', String(options.mode || '')),
      model,
      messages: model.messages.map(copyMessage),
      historyItems,
      historySections: groupHistory(historyItems)
    })
    if (this._agentMock) {
      this.startAgentMockTimeline()
      return
    }
    // 带着首页问题进来是新话题：开新会话；否则恢复上一次对话
    const rememberedSession = this._entryPrompt ? '' : recallCourseAgentSession()
    if (rememberedSession) {
      this._agentSessionId = rememberedSession
      this.resumeAgentSession(rememberedSession)
    }
  },

  // 重进页面时尝试续上一次的课程智能体会话：终局的不再续流，首条新消息会开新会话。
  // 重进页面恢复上一次对话：从头回放事件流重建时间线，之后继续在同一会话里聊。
  // 每次提问（ask_user）都会让 run 结束，所以已结束的会话同样要恢复，否则一离开页面对话就“不见了”。
  resumeAgentSession(sessionId) {
    this.ensureAgentAccess()
      .then(() => fetchCourseAgentSession(sessionId))
      .then((meta) => {
        if (this._isDestroyed || this._agentSessionId !== sessionId || this.data.messages.length) return
        const status = String((meta && meta.status) || '').toLowerCase()
        this._agentSessionTerminal = ['succeeded', 'failed', 'cancelled'].includes(status)
        this._lastAgentEventId = 0
        this.startAgentStream()
      })
      .catch((error) => {
        if (this._isDestroyed || this._agentSessionId !== sessionId) return
        // 只有确认会话不存在才遗忘；网络或凭证问题保留，下次还能恢复
        if (error && error.statusCode === 404) forgetCourseAgentSession()
        if (!this.data.messages.length) this._agentSessionId = ''
      })
  },

  onUnload() {
    this._isDestroyed = true
    this._isPageVisible = false
    this.clearReplyTimers()
    this.cancelAgentRun(true)
    this.stopAgentStream()
    this.stopAgentReconnect()
    this.clearAgentStreamFlush()
    if (this._agentRenderTimer) clearTimeout(this._agentRenderTimer)
    if (this._mockPlayer) this._mockPlayer.cancel()
    if (this._voiceTimer) clearTimeout(this._voiceTimer)
    if (this._keyboardHeightTimer) clearTimeout(this._keyboardHeightTimer)
    if (this._keyboardOpenTimer) clearTimeout(this._keyboardOpenTimer)
    if (this._inputFocusTimer) clearTimeout(this._inputFocusTimer)
    if (this._chatScrollQueryTimer) clearTimeout(this._chatScrollQueryTimer)
    this.clearChatTouchReleaseProbes()
    if (this._scrollToBottomTimer) clearTimeout(this._scrollToBottomTimer)
    this.stopVoiceVisualizer()
    this.stopRecorderCapture(true)
  },

  onShow() {
    this._isPageVisible = true
    this.attachRecorderOwner()
    // 事件流是会话级的：回页用 lastEventId 续传，服务端回放补齐离开期间的帧。
    if (!this._agentMock && this._agentSessionId && !this._agentSessionTerminal && !this._agentStream) {
      this.startAgentStream()
    }
    if (this._entryPrompt) {
      const entryPrompt = this._entryPrompt
      this._entryPrompt = ''
      setTimeout(() => { if (!this._isDestroyed && this._isPageVisible) this.sendMessage(entryPrompt) }, 120)
    }
  },

  onHide() {
    this._isPageVisible = false
    this.stopAgentStream()
    this.stopAgentReconnect()
    this.stopRecorderCapture()
    this.resetKeyboardLayout({ clearInputState: true })
  },

  handleBack() {
    wx.navigateBack({ delta: 1 })
  },

  handleNewConversation() {
    this.clearReplyTimers()
    this.cancelAgentRun(true)
    this.stopAgentStream()
    this.stopAgentReconnect()
    if (this._mockPlayer) this._mockPlayer.cancel()
    this._mockPlayer = null
    this.cancelComposerFocusRequest()
    this._chatFollowEnabled = true
    this._chatManualScrollLocked = false
    this._chatForceFollowUntilBottom = false
    this._agentSessionId = ''
    this._agentSessionTerminal = false
    this._lastAgentEventId = 0
    this._agentStreamText = null
    this._activeQuestion = null
    this._questionSelections = {}
    this._sentOptionsSignature = ''
    this._baselineSent = false
    if (!this._agentMock) forgetCourseAgentSession()
    this.setData({
      messages: [],
      activeHistoryId: '',
      historyVisible: false,
      historyClosing: false,
      historySearch: '',
      historyItems: [],
      historySections: [],
      historyNotice: '',
      showScrollToBottom: false,
      inputActive: false,
      inputFocus: false,
      inputValue: '',
      canSend: false,
      isSending: false,
      'model.currentState': this.data.model.states.ready,
      ...this.getChatScrollUpdate()
    })
  },

  openHistory() {
    this.setData({
      historyVisible: true,
      historyClosing: false,
      historySearch: '',
      historyItems: [],
      historySections: [],
      historyLoading: true,
      historyNotice: ''
    })
    this.loadConversationHistory()
  },

  loadConversationHistory() {
    const requestToken = ++this._historyRequestToken
    if (this._agentMock) {
      const conversations = (this.data.model.history.conversations || []).map((item) => ({
        ...item,
        messages: (item.messages || []).map(copyMessage)
      }))
      const model = {
        ...this.data.model,
        history: { ...this.data.model.history, conversations }
      }
      this.setData({
        model,
        historyItems: filterHistory(conversations, this.data.historySearch),
        historySections: groupHistory(conversations, this.data.historySearch),
        historyLoading: false,
        historyNotice: conversations.length ? '' : model.history.emptyText
      })
      return Promise.resolve(conversations)
    }
    // 缓存的 openmaic_access 失效（服务端换了访问码/重新部署）时会 401：作废后重换一次再读
    const fetchSessions = () => this.ensureAgentAccess().then(() => listCourseAgentSessions())
    return fetchSessions()
      .catch((error) => {
        if (!error || error.statusCode !== 401) throw error
        clearCourseAgentAccess()
        return fetchSessions()
      })
      .then((sessions) => {
        if (requestToken !== this._historyRequestToken || this._isDestroyed) return
        const statusLabels = { running: '生成中', queued: '排队中', succeeded: '已完成', failed: '未完成', cancelled: '已取消' }
        const conversations = (Array.isArray(sessions) ? sessions : []).map((session) => {
          const sessionId = String(session && session.id || '')
          const prompt = String(session && session.prompt || '')
          // 服务端在一轮问答结束后写入一句话标题；还没写入（或旧会话）时退回首条提问。
          const summary = String(session && session.title || '').trim()
          const createdAt = normalizeMessageTimestamp(session && session.updatedAt)
          return {
            id: `agent-session-${sessionId}`,
            sessionId,
            status: String(session && session.status || ''),
            title: summary || stripLearningAppendix(prompt).slice(0, 24) || 'AI 课程对话',
            preview: statusLabels[String(session && session.status || '')] || 'AI 课程对话',
            keywords: stripLearningAppendix(prompt),
            time: formatHistoryItemTime(createdAt),
            createdAt
          }
        })
        const model = {
          ...this.data.model,
          history: { ...this.data.model.history, conversations }
        }
        this.setData({
          model,
          historyItems: filterHistory(conversations, this.data.historySearch),
          historySections: groupHistory(conversations, this.data.historySearch),
          historyLoading: false,
          historyNotice: conversations.length ? '' : model.history.emptyText
        })
      })
      .catch((error) => {
        if (requestToken !== this._historyRequestToken || this._isDestroyed) return
        console.warn('[agent-chat] 历史对话读取失败', error && error.statusCode, error && error.message)
        const notice = '历史对话读取失败，请稍后重试'
        this.setData({ historyItems: [], historySections: [], historyLoading: false, historyNotice: notice })
        wx.showToast({ title: notice, icon: 'none' })
      })
  },

  closeHistory() {
    if (!this.data.historyVisible) return
    this.setData({ historyClosing: true })
    setTimeout(() => {
      if (this.data.historyClosing) this.setData({ historyVisible: false, historyClosing: false })
    }, 240)
  },

  stopTap() {},

  getTouchPoint(e) {
    const touches = e && (e.touches || e.changedTouches)
    const touch = touches && touches[0]
    return touch || null
  },

  clearChatTouchReleaseProbes() {
    this._chatTouchReleaseProbeToken += 1
    if (Array.isArray(this._chatTouchReleaseTimers)) {
      this._chatTouchReleaseTimers.forEach((timer) => clearTimeout(timer))
    }
    this._chatTouchReleaseTimers = []
  },

  scheduleChatTouchReleaseProbes() {
    this.clearChatTouchReleaseProbes()
    if (typeof wx.createSelectorQuery !== 'function') return
    const token = this._chatTouchReleaseProbeToken
    this._chatTouchReleaseTimers = CHAT_TOUCH_RELEASE_PROBE_DELAYS.map((delay) => setTimeout(() => {
      if (this._isDestroyed || token !== this._chatTouchReleaseProbeToken || this._chatTouchActive) return
      // 触摸释放后等待滚动惯性稳定，再测量消息末尾；只在真实到底时恢复跟随。
      this.queryChatScrollState(undefined, token)
    }, delay))
  },

  handleChatTouchStart(e) {
    const touch = this.getTouchPoint(e)
    if (!touch) return
    this._chatTouchActive = true
    this._chatTouchDidMove = false
    this._chatTouchStartY = Number(touch.clientY || touch.pageY || 0)
    this._lastChatTouchAt = Date.now()
    this.clearChatTouchReleaseProbes()
    // 用户重新开始手动操作时，取消按钮触发的程序化回到底部请求。
    this._chatForceFollowUntilBottom = false
    // 触摸刚开始就暂停自动跟随，之后的流式刷新不再下发 scroll-top。
    // 注意不能在这里回写 scrollTop：这次 setData 会晚于手指拖动到达原生
    // scroll-view，把刚开始上滑的列表硬拉回按下时的位置（即最底部）。
    this._chatManualScrollLocked = true
    this._chatFollowEnabled = false
    this._chatScrollStateVersion += 1
    if (this.data.scrollIntoView) this.setData({ scrollIntoView: '' })
  },

  handleChatTouchMove(e) {
    if (!this._chatTouchActive) return
    const touch = this.getTouchPoint(e)
    if (!touch) return
    const currentY = Number(touch.clientY || touch.pageY || 0)
    if (currentY === this._chatTouchStartY) return
    if (this._chatTouchDidMove) return
    this._chatTouchDidMove = true
  },

  handleChatTouchEnd() {
    this._chatTouchActive = false
    this._chatTouchDidMove = false
    this._lastChatTouchAt = Date.now()
    // 是否恢复跟随只看松手后实测的位置：真机上 scroll-view 拖动时 touchmove
    // 不一定回调，缓存的距离也可能是旧值，按它恢复会把刚上滑的列表拉回底部。
    // 释放后分三次复测（含滚动惯性），真实到底才接回自动跟随。
    this.scheduleChatTouchReleaseProbes()
  },

  getChatScrollTarget() {
    return this._chatFollowEnabled || this._chatForceFollowUntilBottom ? 'chat-bottom' : ''
  },

  getNextChatScrollTop() {
    const currentRequest = Number(this.data.scrollTop) || 0
    // 目标值故意大于普通消息列表高度，交给 scroll-view 夹到真实最大值；
    // 每次再递增 1，兼容原生组件“目标值不变时不重新滚动”的行为。
    this._chatScrollTopRequest = Math.max(
      CHAT_BOTTOM_SCROLL_REQUEST,
      this._chatScrollTopRequest,
      currentRequest
    ) + 1
    return this._chatScrollTopRequest
  },

  // 参考 TDesign ChatList 的 setScrollTop 思路：用持续变化的请求值触发
  // scroll-view 重新计算最大滚动位置，避免重复写同一个 scroll-into-view
  // 导致消息富文本重排和原生滚动动画互相抢占。
  getChatScrollUpdate() {
    if (!this.getChatScrollTarget()) return { scrollIntoView: '' }
    return {
      scrollIntoView: '',
      scrollTop: this.getNextChatScrollTop()
    }
  },

  updateChatScrollState(distanceFromBottom) {
    const numericDistance = Number(distanceFromBottom)
    const distance = Number.isFinite(numericDistance) ? Math.max(0, numericDistance) : 0
    const nearBottom = distance <= CHAT_NEAR_BOTTOM_DISTANCE
    const atBottom = distance <= CHAT_BOTTOM_DISTANCE
    this._lastChatScrollDistance = distance
    // 手势尚未结束时，即使 scroll-view 暂时报告仍在底部，也不能解除
    // 手动滚动锁；否则输出刷新会和轻微拖动互相抢位置并产生闪屏。
    if (atBottom && !this._chatTouchActive) {
      this._chatManualScrollLocked = false
      this._chatForceFollowUntilBottom = false
    }
    const wasFollowing = this._chatFollowEnabled
    const shouldFollow = this._chatTouchActive
      ? false
      : (this._chatForceFollowUntilBottom
        ? true
        : (this._chatManualScrollLocked ? false : nearBottom))
    const shouldShowButton = this._chatForceFollowUntilBottom
      ? false
      : (!shouldFollow && distance > CHAT_BOTTOM_DISTANCE)
    this._chatFollowEnabled = shouldFollow
    const updates = {}
    if (this.data.showScrollToBottom !== shouldShowButton) updates.showScrollToBottom = shouldShowButton
    if (!shouldFollow && this.data.scrollIntoView) updates.scrollIntoView = ''
    if (shouldFollow && atBottom && !wasFollowing) {
      Object.assign(updates, this.getChatScrollUpdate())
    }
    if (Object.keys(updates).length) this.setData(updates)
  },

  queryChatScrollState(version, probeToken) {
    if (this._isDestroyed || !wx.createSelectorQuery) return
    if (version !== undefined && version !== this._chatScrollStateVersion) return
    if (probeToken !== undefined && probeToken !== this._chatTouchReleaseProbeToken) return
    const query = wx.createSelectorQuery()
    query.select('.agent-chat-scroll').boundingClientRect()
    query.select('#chat-bottom').boundingClientRect()
    query.exec((results) => {
      if (this._isDestroyed) return
      if (version !== undefined && version !== this._chatScrollStateVersion) return
      if (probeToken !== undefined && probeToken !== this._chatTouchReleaseProbeToken) return
      const scrollRect = results && results[0]
      const bottomRect = results && results[1]
      if (!scrollRect || !bottomRect) return
      const distance = bottomRect.bottom - scrollRect.bottom
      this.updateChatScrollState(distance)
    })
  },

  handleChatScroll(e) {
    this._chatScrollStateVersion += 1
    const detail = e && e.detail ? e.detail : {}
    const scrollTop = Number(detail.scrollTop) || 0
    const previousScrollTop = Number.isFinite(this._lastChatScrollTop) ? this._lastChatScrollTop : scrollTop
    // 手指刚操作过且位置变小：用户在往上翻，立即停止跟随（不依赖 touchmove 是否回调）。
    // 内容收缩导致的被动变小不在触摸窗口内，不会误判。
    const recentlyTouched = this._chatTouchActive || Date.now() - (this._lastChatTouchAt || 0) < 1500
    if (recentlyTouched && scrollTop < previousScrollTop - 2) {
      this._chatManualScrollLocked = true
      this._chatForceFollowUntilBottom = false
      this._chatFollowEnabled = false
    }
    this._lastChatScrollTop = scrollTop
    const scrollHeight = Number(detail.scrollHeight) || 0
    const viewportHeight = Number(detail.height || detail.scrollViewHeight || detail.clientHeight) || 0
    if (scrollHeight > 0 && viewportHeight > 0) {
      this.updateChatScrollState(scrollHeight - scrollTop - viewportHeight)
      return
    }
    this._lastChatScrollTop = scrollTop
    if (this._chatScrollQueryTimer) return
    this._chatScrollQueryTimer = setTimeout(() => {
      this._chatScrollQueryTimer = null
      this.queryChatScrollState(this._chatScrollStateVersion)
    }, 50)
  },

  handleScrollToBottom() {
    if (this._isDestroyed) return
    this._chatScrollStateVersion += 1
    this.clearChatTouchReleaseProbes()
    this._chatForceFollowUntilBottom = true
    this._chatManualScrollLocked = false
    this._chatFollowEnabled = true
    if (this._scrollToBottomTimer) clearTimeout(this._scrollToBottomTimer)
    this._scrollToBottomTimer = null
    this.setData({ showScrollToBottom: false, ...this.getChatScrollUpdate() }, () => {
      if (this._isDestroyed) return
      const applyScroll = () => {
        this._scrollToBottomTimer = null
        if (!this._isDestroyed && this.getChatScrollTarget()) this.setData(this.getChatScrollUpdate())
      }
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(applyScroll)
      } else {
        this._scrollToBottomTimer = setTimeout(applyScroll, 0)
      }
    })
  },

  handleHistorySearch(e) {
    const historySearch = String(e.detail && e.detail.value || '')
    const source = this.data.model.history.conversations || []
    this.setData({
      historySearch,
      historyItems: filterHistory(source, historySearch),
      historySections: groupHistory(source, historySearch)
    })
  },

  clearHistorySearch() {
    const conversations = this.data.model.history.conversations || []
    this.setData({
      historySearch: '',
      historyItems: conversations.slice(),
      historySections: groupHistory(conversations)
    })
  },

  handleHistoryPick(e) {
    const historyId = e.currentTarget.dataset.id
    const selected = (this.data.model.history.conversations || []).find((item) => item.id === historyId)
    if (!selected) return
    this.clearReplyTimers()
    this.cancelAgentRun(false)
    this.stopAgentStream()
    this.stopAgentReconnect()
    this.cancelComposerFocusRequest()
    this._chatFollowEnabled = true
    this._chatManualScrollLocked = false
    this._chatForceFollowUntilBottom = false
    this._activeQuestion = null
    this._questionSelections = {}
    this._agentStreamText = null
    // 历史会话当时的选项未知：下一条消息重新附带选项与基本盘
    this._sentOptionsSignature = ''
    this._baselineSent = false
    if (selected.isMock || !selected.sessionId) {
      // 本地示例没有真实会话；从示例继续输入时创建新的真实会话。
      this._agentSessionId = ''
      this._agentSessionTerminal = false
      this._lastAgentEventId = 0
      this.setData({
        messages: (selected.messages || []).map(copyMessage),
        activeHistoryId: historyId,
        historyVisible: false,
        historyClosing: false,
        inputActive: false,
        inputFocus: false,
        inputValue: '',
        canSend: false,
        isSending: false,
        historyNotice: '',
        showScrollToBottom: false,
        'model.currentState': this.data.model.states.completed,
        ...this.getChatScrollUpdate()
      })
      return
    }
    // 真实会话：清空后从 0 重放事件流，时间线（气泡+活动流）由持久日志重建。
    this._agentSessionId = String(selected.sessionId)
    this._agentSessionTerminal = ['succeeded', 'failed', 'cancelled'].includes(String(selected.status || '').toLowerCase())
    this._lastAgentEventId = 0
    rememberCourseAgentSession(this._agentSessionId)
    this.setData({
      messages: [],
      activeHistoryId: historyId,
      historyVisible: false,
      historyClosing: false,
      inputActive: false,
      inputFocus: false,
      inputValue: '',
      canSend: false,
      isSending: false,
      historyNotice: '',
      showScrollToBottom: false,
      'model.currentState': this.data.model.states.completed,
      ...this.getChatScrollUpdate()
    })
    this.startAgentStream()
  },

  handleInputTap() {
    if (this._ignoreNextComposerTap) {
      this._ignoreNextComposerTap = false
      return
    }
    if (this.data.voiceMode || this.data.voiceRecognizing || this.data.voiceHolding) return
    if (this.data.isSending) return
    this.focusComposerInput()
  },

  clearComposerFocusTimers() {
    if (this._keyboardHeightTimer) clearTimeout(this._keyboardHeightTimer)
    if (this._keyboardOpenTimer) clearTimeout(this._keyboardOpenTimer)
    if (this._inputFocusTimer) clearTimeout(this._inputFocusTimer)
    this._keyboardHeightTimer = null
    this._keyboardOpenTimer = null
    this._inputFocusTimer = null
  },

  cancelComposerFocusRequest() {
    this.clearComposerFocusTimers()
    this._inputFocusRequested = false
    this._inputFocusRearming = false
  },

  armKeyboardOpenWatchdog() {
    if (this._keyboardOpenTimer) clearTimeout(this._keyboardOpenTimer)
    this._keyboardOpenTimer = setTimeout(() => {
      this._keyboardOpenTimer = null
      if (this._isDestroyed || !this._inputFocusRequested || this.data.keyboardHeight > 0) return
      // A focus request with no keyboard event is usually a native focus race.
      // Drop the visual active state so the composer never remains suspended
      // above the safe-area footer without a keyboard behind it.
      this.cancelComposerFocusRequest()
      this.setData({
        inputFocus: false,
        inputActive: Boolean(this.data.inputValue),
        keyboardHeight: 0
      })
    }, KEYBOARD_OPEN_TIMEOUT)
  },

  focusComposerInput() {
    if (this._isDestroyed || this.data.voiceMode || this.data.voiceRecognizing || this.data.voiceHolding || this.data.isSending) return
    this._inputFocusRequested = true
    this.armKeyboardOpenWatchdog()
    if (this.data.inputFocus) return

    this._inputFocusRearming = true
    const applyFocus = () => {
      this._inputFocusTimer = null
      if (this._isDestroyed || !this._inputFocusRequested || this.data.voiceMode || this.data.isSending) {
        this._inputFocusRearming = false
        return
      }
      this._inputFocusRearming = false
      this.setData({ inputActive: true, inputFocus: true })
    }
    const inputAlreadyMounted = this.data.inputActive || Boolean(this.data.inputValue)
    this.setData(inputAlreadyMounted
      ? { inputActive: true }
      : { inputActive: true, inputFocus: false }, () => {
        if (typeof wx.nextTick === 'function') {
          wx.nextTick(applyFocus)
        } else {
          this._inputFocusTimer = setTimeout(applyFocus, 0)
        }
      })
  },

  handleInputFocus() {
    this._inputFocusRequested = true
    this.armKeyboardOpenWatchdog()
    if (!this.data.inputActive || !this.data.inputFocus) {
      this.setData({ inputActive: true, inputFocus: true })
    }
  },

  handleInputBlur() {
    if (this._inputFocusRearming || this._isDestroyed) return
    this.cancelComposerFocusRequest()
    this.setData({
      inputFocus: false,
      inputActive: Boolean(this.data.inputValue),
      keyboardHeight: 0
    })
  },

  resetKeyboardLayout({ clearInputState = false } = {}) {
    this.cancelComposerFocusRequest()
    const updates = {
      keyboardHeight: 0,
      scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP,
      inputFocus: false
    }
    if (clearInputState || !this.data.inputValue) updates.inputActive = false
    this.setData(updates)
  },

  handleKeyboardHeightChange(e) {
    const keyboardHeight = Math.max(0, Number(e.detail && e.detail.height) || 0)
    if (this._keyboardHeightTimer) clearTimeout(this._keyboardHeightTimer)
    if (!keyboardHeight) {
      // iOS/Android can report a transient height=0 between the input being
      // mounted and the keyboard finishing its first animation. Keep the
      // requested focus during that window; otherwise wx:if unmounts input
      // and the user has to tap twice.
      if (this._inputFocusRequested && this.data.keyboardHeight <= 0) {
        this._keyboardHeightTimer = null
        this.setData({
          keyboardHeight: 0,
          scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP,
          inputActive: true
        })
        this.armKeyboardOpenWatchdog()
        return
      }
      this._keyboardHeightTimer = null
      this.cancelComposerFocusRequest()
      const updates = {
        keyboardHeight: 0,
        scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP,
        inputFocus: false,
        inputActive: Boolean(this.data.inputValue)
      }
      this.setData(updates)
      return
    }
    if (this._keyboardOpenTimer) clearTimeout(this._keyboardOpenTimer)
    this._keyboardOpenTimer = null
    this._keyboardHeightTimer = setTimeout(() => {
      this._keyboardHeightTimer = null
      this.setData({ keyboardHeight, scrollButtonBottom: keyboardHeight + SCROLL_BUTTON_GAP })
    }, KEYBOARD_SETTLE_DELAY)
  },

  handleVoiceButtonTap() {
    this.cancelComposerFocusRequest()
    this.setData({
      voiceMode: true,
      inputActive: false,
      inputFocus: false,
      keyboardHeight: 0,
      scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP
    })
    if (wx.hideKeyboard) wx.hideKeyboard()
  },

  handleKeyboardButtonTap() {
    this.cancelComposerFocusRequest()
    this.setData({
      voiceMode: false,
      inputActive: false,
      inputFocus: false,
      keyboardHeight: 0,
      scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP
    })
    if (wx.hideKeyboard) wx.hideKeyboard()
  },

  handleComposerTap() {
    if (this._ignoreNextComposerTap) {
      this._ignoreNextComposerTap = false
      return
    }
    if (this.data.voiceMode || this.data.voiceRecognizing || this.data.isSending) return
    this.focusComposerInput()
  },

  handleInput(e) {
    const inputValue = String(e.detail && e.detail.value || '')
    this._inputFocusRequested = true
    this.setData({ inputValue, inputActive: true, canSend: Boolean(inputValue.trim()) && !this.data.isSending })
  },

  handleSuggestion(e) {
    const promptId = e.currentTarget.dataset.id
    const promptPool = Array.isArray(this.data.model.suggestedPromptRows)
      ? this.data.model.suggestedPromptRows.reduce((items, row) => items.concat(row.items || []), [])
      : (this.data.model.suggestedPrompts || [])
    const prompt = promptPool.find((item) => item.id === promptId)
    if (prompt) this.sendMessage(prompt.label)
  },

  handleSend() {
    this.sendMessage(this.data.inputValue)
  },

  // ---------- 学习选项 ----------

  toggleUniverseOption() {
    this.setData({ includeUniverse: !this.data.includeUniverse })
  },

  handleLearningModeTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    this.setData({ activeLearningMode: toggleLearningMode(this.data.activeLearningMode, id) })
  },

  // 学习基本盘（年级学期 + 各学科知识点掌握），页面生命周期内缓存；失败或超时返回 null。
  loadBaselineForAgent() {
    if (this._baselinePromise) return this._baselinePromise
    let token = ''
    try {
      token = String(wx.getStorageSync('zion_runtime_token') || '')
    } catch (storageError) {
      token = ''
    }
    if (!token) return Promise.resolve(null)
    let timer = null
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), LEARNER_BASELINE_TIMEOUT_MS) })
    const load = Promise.resolve()
      .then(() => require('../../services/identity').loadLearnerBaseline())
      .catch(() => null)
    const pending = Promise.race([load, timeout]).then((baseline) => {
      clearTimeout(timer)
      if (!baseline && this._baselinePromise === pending) this._baselinePromise = null
      return baseline
    })
    this._baselinePromise = pending
    return pending
  },

  handleSendOrStop() {
    if (this.data.isSending) {
      this.handleStop()
      return
    }
    this.handleSend()
  },

  handleStop() {
    if (!this.data.isSending) return
    this.clearReplyTimers()
    this.cancelAgentRun(true)
    this.settleThinkingActivity()
    this.settleRunningTools('done')
    const messages = this.data.messages.slice()
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.text) messages.pop()
    this.setData({
      messages,
      isSending: false,
      canSend: Boolean(String(this.data.inputValue || '').trim()),
      'model.currentState': this.data.model.states.completed,
      ...this.getChatScrollUpdate()
    })
  },

  sendMessage(value) {
    const text = String(value || '').trim()
    if (!text || this.data.isSending) return
    this.cancelComposerFocusRequest()
    this.clearChatTouchReleaseProbes()
    this._chatFollowEnabled = true
    this._chatManualScrollLocked = false
    this._chatForceFollowUntilBottom = true
    const userMessage = copyMessage({ id: `user-${Date.now()}`, role: 'user', text })
    this.setData({
      messages: this.data.messages.concat(userMessage),
      inputValue: '',
      inputActive: true,
      inputFocus: false,
      keyboardHeight: 0,
      scrollButtonBottom: this.data.composerBottomOffset + SCROLL_BUTTON_GAP,
      canSend: false,
      isSending: true,
      showScrollToBottom: false,
      'model.currentState': this.data.model.states.sending,
      ...this.getChatScrollUpdate()
    })
    this._replyTimer = setTimeout(() => this.startAgentReply(text), REPLY_DELAY)
  },

  startAgentReply(prompt) {
    if (this._isDestroyed) return
    const replyMessage = copyMessage({
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      text: '',
      isTyping: true
    })
    const runToken = ++this._agentRunToken
    this._agentActive = true
    this.setData({
      messages: this.data.messages.concat(replyMessage),
      'model.currentState': this.data.model.states.answering,
      ...this.getChatScrollUpdate()
    })

    if (this._agentMock) {
      if (!this._mockPlayer) this.startAgentMockTimeline()
      else if (this._activeQuestion) this._mockPlayer.answer()
      return
    }

    const universe = Boolean(this.data.includeUniverse)
    const modeId = String(this.data.activeLearningMode || '')
    const signature = optionsSignature({ universe, modeId })
    const request = this.ensureAgentAccess()
      .then(() => {
        if (runToken !== this._agentRunToken || this._isDestroyed) return null
        // 一次 run 结束（含 ask_user 暂停）后会话仍可续发：服务端收到新消息会重新排队。
        // 只有没有会话（新对话 / 会话已失效）时才新建，否则摸底问答会丢失上下文。
        const isNewSession = !this._agentSessionId
        if (isNewSession) {
          this._sentOptionsSignature = ''
          this._baselineSent = false
        }
        const attachOptions = signature !== this._sentOptionsSignature
        const attachBaseline = universe && !this._baselineSent
        return (attachBaseline ? this.loadBaselineForAgent() : Promise.resolve(null)).then((baseline) => {
          if (runToken !== this._agentRunToken || this._isDestroyed) return null
          const text = buildAgentMessageText({ text: prompt, universe, modeId, baseline, attachOptions, attachBaseline })
          const markSent = () => {
            this._sentOptionsSignature = signature
            if (attachBaseline) this._baselineSent = true
          }
          if (isNewSession) {
            return createCourseAgentSession({ prompt: text }).then((meta) => {
              if (!meta || !meta.id) throw new Error('课程智能体未返回会话')
              this._agentSessionId = String(meta.id)
              this._agentSessionTerminal = false
              rememberCourseAgentSession(this._agentSessionId)
              markSent()
              return this._agentSessionId
            })
          }
          return sendCourseAgentMessage(this._agentSessionId, text).then(() => {
            markSent()
            this._agentSessionTerminal = false
            return this._agentSessionId
          })
        })
      })

    request.then((sessionId) => {
      if (runToken !== this._agentRunToken || this._isDestroyed) return
      if (!this._agentStream) this.startAgentStream()
    }).catch((error) => {
      if (runToken !== this._agentRunToken || this._isDestroyed) return
      if (error && error.statusCode === 401) clearCourseAgentAccess()
      if (error && error.statusCode === 404 && this._agentSessionId) {
        // 会话已不存在：下一条消息开新会话
        forgetCourseAgentSession()
        this._agentSessionId = ''
      }
      this.finishLocalFallback(prompt, error)
    })
  },

  // 网关凭证：用 Zion 登录态换 openmaic_access，缓存于 storage，401 时作废重换。
  // 生产 JWT 由 Zion 壳写入 storage key「zion_runtime_token」（identity.js 同源）；
  // 设计师 E04 层的 zhilu-zion-jwt 在本项目无人写入，只作兜底。
  ensureAgentAccess() {
    if (this._agentAccessPromise) return this._agentAccessPromise
    this._agentAccessPromise = Promise.resolve()
      .then(() => {
        let token = ''
        try {
          token = String(wx.getStorageSync('zion_runtime_token') || '')
        } catch (storageError) {
          token = ''
        }
        if (token) return token
        return Promise.resolve(this._authPromise || ensureZionSession({ allowAnonymous: true }))
          .then((auth) => (auth && auth.token) || '')
      })
      .then((token) => {
        if (!token) throw new Error('请先完成微信登录后再使用 AI 对话')
        return ensureCourseAgentAccess(token)
      })
      .then(() => {
        this._agentAccessPromise = null
      })
      .catch((error) => {
        this._agentAccessPromise = null
        throw error
      })
    return this._agentAccessPromise
  },

  // ---------- 课程智能体事件流（SSE）→ 消息时间线 ----------

  startAgentStream() {
    this.stopAgentStream()
    if (this._isDestroyed || this._agentMock || !this._agentSessionId) return
    this._agentStreamLive = false
    // 每条流带令牌：只有当前流的回调生效，旧流迟到的 closed/error 不能清掉新流的引用。
    const token = this._agentStreamToken = (this._agentStreamToken || 0) + 1
    this._agentStreamEnded = false
    const stream = streamCourseAgentEvents(this._agentSessionId, {
      lastEventId: this._lastAgentEventId,
      onEvent: (event) => {
        if (token === this._agentStreamToken) this.enqueueAgentEvent(event)
      },
      onStatus: (status) => {
        if (token === this._agentStreamToken) this.handleAgentStreamStatus(status)
      }
    })
    // 同步回调里（如不支持分块）已判定本流结束时，不再挂回引用。
    if (token === this._agentStreamToken && !this._agentStreamEnded) this._agentStream = stream
  },

  stopAgentStream() {
    this._agentStreamToken = (this._agentStreamToken || 0) + 1
    if (this._agentStream) {
      this._agentStream.abort()
      this._agentStream = null
    }
  },

  handleAgentStreamStatus(status) {
    if (this._isDestroyed) return
    if (status === 'live') {
      // caught_up 只表示历史补发完毕，连接仍然开着：保留引用，
      // 否则下次发送会以为没有流而再开一条，旧连接泄漏并占满 wx.request 并发上限。
      this._agentReconnectAttempts = 0
      this._agentStreamLive = true
      return
    }
    this._agentStream = null
    this._agentStreamEnded = true
    if (status === 'fatal') {
      // 会话不存在/身份不一致：放弃本会话，用户下次发送会开新会话。
      forgetCourseAgentSession()
      this._agentSessionId = ''
      this._agentSessionTerminal = true
      if (this.data.isSending) this.finishFailedReply(new Error('会话已过期，请重新发送'))
      return
    }
    // closed（服务端 300s 截断）或 error（网络断）：会话仍在服务端，重连续传。
    if (!this._agentSessionTerminal) this.scheduleAgentReconnect()
  },

  scheduleAgentReconnect() {
    if (this._isDestroyed || !this._isPageVisible || this._agentStream || this._agentReconnectTimer) return
    const delays = COURSE_AGENT.reconnectDelaysMs
    const delay = delays[Math.min(this._agentReconnectAttempts, delays.length - 1)]
    this._agentReconnectAttempts += 1
    this._agentReconnectTimer = setTimeout(() => {
      this._agentReconnectTimer = null
      this.startAgentStream()
    }, delay)
  },

  stopAgentReconnect() {
    if (this._agentReconnectTimer) {
      clearTimeout(this._agentReconnectTimer)
      this._agentReconnectTimer = null
    }
  },

  clearAgentStreamFlush() {
    if (this._agentStreamFlush) {
      clearTimeout(this._agentStreamFlush)
      this._agentStreamFlush = null
    }
    this._agentStreamText = null
    this.clearAgentEventQueue()
    this.flushStreamReveal()
  },

  // ---------- 事件节拍：逐条出现，不一下子全蹦出来 ----------

  enqueueAgentEvent(event) {
    if (this._isDestroyed || !event) return
    this._agentEventQueue.push(event)
    this.drainAgentEvents()
  },

  clearAgentEventQueue() {
    if (this._agentEventTimer) {
      clearTimeout(this._agentEventTimer)
      this._agentEventTimer = null
    }
    this._agentEventQueue = []
    this._revealWaitStartedAt = 0
  },

  isVisibleActivityEvent(event) {
    if (event.type !== 'tool_execution_start') return false
    const toolName = String((event.data && event.data.toolName) || '')
    return !HIDDEN_ACTIVITY_TOOLS.includes(toolName)
  },

  drainAgentEvents() {
    if (this._agentEventTimer) return
    const waitThen = (ms) => {
      this._agentEventTimer = setTimeout(() => {
        this._agentEventTimer = null
        this.drainAgentEvents()
      }, ms)
    }
    while (this._agentEventQueue.length && !this._isDestroyed) {
      const event = this._agentEventQueue[0]
      if (this._agentStreamLive) {
        const now = Date.now()
        if (this.isVisibleActivityEvent(event) && now < this._nextActivityAt) {
          waitThen(this._nextActivityAt - now)
          return
        }
        if (WAIT_FOR_REVEAL_EVENTS.includes(event.type) && this._streamReveal) {
          if (!this._revealWaitStartedAt) this._revealWaitStartedAt = now
          if (now - this._revealWaitStartedAt < REVEAL_SETTLE_WAIT_MS) {
            waitThen(100)
            return
          }
        }
      }
      this._revealWaitStartedAt = 0
      this._agentEventQueue.shift()
      this.handleAgentEvent(event)
      if (this._agentStreamLive && this.isVisibleActivityEvent(event)) {
        this._nextActivityAt = Date.now() + ACTIVITY_STAGGER_MS
      }
    }
  },

  // ---------- 流式正文：匀速吐字 + 逐字由浅到深 ----------

  findMessageIndex(id) {
    const messages = this.data.messages
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].id === id) return i
    }
    return -1
  },

  // 同一时刻只渐显一个气泡；换气泡时上一个直接补全。
  ensureStreamReveal(id) {
    if (this._streamReveal && this._streamReveal.id !== id) this.flushStreamReveal()
    if (!this._streamReveal) this._streamReveal = { id, engine: createStreamReveal() }
    return this._streamReveal.engine
  },

  scheduleStreamRevealTick() {
    if (this._streamRevealTimer || this._isDestroyed || !this._streamReveal) return
    this._streamRevealTimer = setTimeout(() => this.runStreamRevealTick(), REVEAL_TICK_MS)
  },

  runStreamRevealTick() {
    this._streamRevealTimer = null
    const state = this._streamReveal
    if (!state || this._isDestroyed) return
    const index = this.findMessageIndex(state.id)
    if (index < 0) {
      this._streamReveal = null
      return
    }
    const now = Date.now()
    const frame = state.engine.tick(now)
    const message = this.data.messages[index]
    const advanced = frame.text !== message.text
    message.text = frame.text
    message.markdownNodes = frame.done
      ? renderMarkdown(frame.text)
      : renderRevealFrame(frame.text, state.engine, now, renderMarkdown)
    const patch = {
      [`messages[${index}].text`]: message.text,
      [`messages[${index}].markdownNodes`]: message.markdownNodes
    }
    if (message.isTyping) {
      const upcoming = Array.from(state.engine.target).slice(frame.shown, frame.shown + 2)
      message.streamReserveLine = shouldReserveStreamLine(frame.text, upcoming[0], upcoming)
      patch[`messages[${index}].streamReserveLine`] = message.streamReserveLine
    }
    this.setData(advanced ? { ...patch, ...this.getChatScrollUpdate() } : patch)
    if (frame.done) {
      this._streamReveal = null
      return
    }
    // 还在吐字或尾巴还没变深就继续；否则等下一次快照再唤醒
    if (frame.shown < frame.total || frame.fading) this.scheduleStreamRevealTick()
  },

  // 立即补全当前渐显气泡（换会话、换气泡、停止时）。
  flushStreamReveal() {
    if (this._streamRevealTimer) {
      clearTimeout(this._streamRevealTimer)
      this._streamRevealTimer = null
    }
    const state = this._streamReveal
    this._streamReveal = null
    if (!state || this._isDestroyed) return
    const index = this.findMessageIndex(state.id)
    if (index < 0) return
    const message = this.data.messages[index]
    const text = state.engine.target
    if (!text) return
    message.text = text
    message.markdownNodes = renderMarkdown(text)
    message.streamReserveLine = false
    this.setData({
      [`messages[${index}].text`]: text,
      [`messages[${index}].markdownNodes`]: message.markdownNodes,
      [`messages[${index}].streamReserveLine`]: false
    })
  },

  startAgentMockTimeline() {
    this._mockPlayer = playMockCourseAgentTimeline((event) => this.enqueueAgentEvent(event))
  },

  handleAgentEvent(event) {
    if (this._isDestroyed) return
    this._lastAgentEventId = Math.max(this._lastAgentEventId || 0, Number(event.id) || 0)
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    switch (event.type) {
      case 'session_start':
      case 'session_resumed': {
        this._agentSessionTerminal = false
        this._runThinkingId = ''
        // 会话首条提问不会以 user_message 回放：回放/恢复历史时据 session_start 补出用户气泡
        if (event.type === 'session_start') {
          const prompt = stripLearningAppendix(data.prompt)
          const lastUser = this.data.messages.slice().reverse().find((message) => message.role === 'user')
          if (prompt && !(lastUser && lastUser.text === prompt)) {
            this.insertAgentActivity(copyMessage({ id: `user-start-${event.id}`, role: 'user', text: prompt }))
          }
        }
        this.openThinkingActivity()
        this.renderAgentMessages()
        break
      }
      case 'user_message': {
        const text = stripLearningAppendix(data.text)
        let echoed = false
        for (let i = this.data.messages.length - 1; i >= 0; i -= 1) {
          const message = this.data.messages[i]
          if (message.role === 'user') { echoed = message.text === text; break }
        }
        if (!echoed && text) {
          this.insertAgentActivity(copyMessage({ id: `user-${event.id}`, role: 'user', text }))
        }
        this._activeQuestion = null
        this.markQuestionsAnswered(text)
        break
      }
      case 'tool_execution_start': {
        const toolName = String(data.toolName || 'tool')
        if (HIDDEN_ACTIVITY_TOOLS.includes(toolName)) break
        const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args) ? data.args : {}
        const label = presentToolLine(toolName, args)
        this.openThinkingActivity()
        this.upsertAgentActivity({
          kind: 'tool',
          id: `tool-${data.toolCallId || event.id}`,
          label,
          state: 'running',
          argsText: Object.keys(args).length ? JSON.stringify(args, null, 2) : '',
          resultText: '',
          traces: [],
          startedAt: Number(event.ts) || 0,
          durationText: ''
        })
        break
      }
      case 'trace': {
        const target = this.data.messages.slice().reverse().find((item) => item.kind === 'tool' && item.state === 'running')
        if (target) {
          target.traces = (target.traces || []).concat([String(data.message || '')]).slice(-40)
          this.renderAgentMessages()
        }
        break
      }
      case 'tool_execution_end': {
        if (HIDDEN_ACTIVITY_TOOLS.includes(String(data.toolName || ''))) break
        const item = this.data.messages.find((entry) => entry.kind === 'tool' && entry.id === `tool-${data.toolCallId}`)
        if (item) {
          item.state = data.isError ? 'failed' : 'done'
          item.durationText = formatAgentDuration(item.startedAt, event.ts)
          const result = data.result && typeof data.result === 'object' ? data.result : {}
          const parts = Array.isArray(result.content) ? result.content : []
          const text = parts
            .filter((block) => block && block.type === 'text')
            .map((block) => block.text || '')
            .join('\n')
          const fallback = result.details ? JSON.stringify(result.details, null, 2) : ''
          const resultText = text || fallback
          item.resultText = resultText.length > 20000 ? `${resultText.slice(0, 20000)}…` : resultText
          this.renderAgentMessages()
        }
        break
      }
      case 'user_question': {
        const question = String(data.question || '')
        if (!question) break
        this._activeQuestion = {
          question,
          options: (Array.isArray(data.options) ? data.options : []).map((option) => ({
            ...option,
            isConfirm: String(option && option.id) === CONFIRM_GENERATE_OPTION_ID
          })),
          multiSelect: data.multiSelect === true
        }
        this._questionSelections = {}
        const card = {
          kind: 'question',
          id: `question-${event.id}`,
          question,
          options: this._activeQuestion.options.map((option) => ({ ...option })),
          multiSelect: this._activeQuestion.multiSelect,
          answered: false
        }
        this.applyQuestionSelection(card, [])
        this.upsertAgentActivity(card)
        break
      }
      case 'thinking_end': {
        this.settleThinkingActivity()
        this.renderAgentMessages()
        break
      }
      case 'message_start': {
        if (data.message && data.message.role === 'assistant') {
          const messages = this.data.messages
          const last = messages[messages.length - 1]
          if (!last || last.role !== 'assistant' || !last.isTyping) {
            this.insertAgentActivity(copyMessage({ id: `assistant-${event.id}`, role: 'assistant', text: '', isTyping: true }))
          }
        }
        break
      }
      case 'message_update': {
        if (!data.message || data.message.role !== 'assistant') break
        const text = agentBlocksText(data.message)
        if (!text) break
        this.settleThinkingActivity()
        this.updateStreamingAssistant(text)
        break
      }
      case 'message_end': {
        const message = data.message
        if (message && message.role === 'toolResult' && typeof message.toolCallId === 'string') {
          const item = this.data.messages.find((entry) => entry.kind === 'tool' && entry.id === `tool-${message.toolCallId}`)
          if (item && item.state === 'running') {
            item.state = message.isError ? 'failed' : 'done'
            item.durationText = formatAgentDuration(item.startedAt, event.ts)
            this.renderAgentMessages()
          }
          break
        }
        if (!message || message.role !== 'assistant') break
        this.settleThinkingActivity()
        // 带工具调用的助手消息（含服务端预加载技能的 read）不是本轮终点：
        // 收束当前气泡但保持发送中，直到 session_end。
        const callsTools = Array.isArray(message.content) && message.content.some((block) => block && block.type === 'toolCall')
        this.finishAgentAssistantReply(agentBlocksText(message), { keepSending: callsTools })
        break
      }
      case 'stage_link':
      case 'course_link':
      case 'course_generation': {
        // 一门课只保留一张课程卡：建课时先出现，交给后台生成后原地变成「正在生成中」。
        const stageId = String(data.stageId || '')
        const id = stageId ? `stage-${stageId}` : `stage-${event.id}`
        const existing = this.data.messages.find((entry) => entry.id === id)
        const generating = event.type === 'course_generation' || Boolean(existing && existing.generating)
        this.upsertAgentActivity({
          kind: 'stage',
          id,
          stageId,
          title: String(data.title || (existing && existing.title) || '新课程'),
          url: String(data.url || (existing && existing.url) || ''),
          generating,
          subtitle: generating
            ? `课程正在生成中${Number(data.totalPages) > 0 ? ` · 共 ${Number(data.totalPages)} 页` : ''}`
            : '课程已创建，确认方案后开始生成',
          actionLabel: generating ? '查看进度' : '查看课程'
        })
        break
      }
      case 'session_interrupted': {
        this.upsertAgentActivity({
          kind: 'notice',
          id: `notice-${event.id}`,
          text: '连接短暂中断，正在恢复任务…',
          tone: 'warn'
        })
        break
      }
      case 'session_end': {
        const status = String(data.status || 'succeeded')
        this._agentSessionTerminal = true
        this.settleThinkingActivity()
        this.settleRunningTools(status === 'failed' ? 'failed' : 'done')
        this.finalizeThinkingSummary(status)
        if (status === 'failed') {
          this.upsertAgentActivity({
            kind: 'notice',
            id: `notice-${event.id}`,
            text: '本次任务未完成，可以重新发送再试一次。',
            tone: 'error'
          })
        }
        this.finishAgentAssistantReply()
        break
      }
      default:
        break
    }
  },

  // 活动项插在“正在输入的助手气泡”之前，保证工具过程先于正文出现。
  insertAgentActivity(item) {
    const messages = this.data.messages
    let insertAt = messages.length
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant' && messages[i].isTyping) { insertAt = i; break }
      if (messages[i].role) break
    }
    messages.splice(insertAt, 0, item)
    this.renderAgentMessages()
  },

  upsertAgentActivity(item) {
    const index = this.data.messages.findIndex((entry) => entry.id === item.id)
    if (index >= 0) {
      Object.assign(this.data.messages[index], item)
      this.renderAgentMessages()
      return
    }
    this.insertAgentActivity(item)
  },

  renderAgentMessages() {
    if (this._isDestroyed) return
    if (this._agentRenderTimer) return
    this._agentRenderTimer = setTimeout(() => {
      this._agentRenderTimer = null
      if (this._isDestroyed) return
      this.setData({
        messages: this.data.messages.slice(),
        ...this.getChatScrollUpdate()
      })
    }, AGENT_RENDER_THROTTLE_MS)
  },

  // 每轮 run 只用一张思考卡：正文开始时收起，之后再调工具就重新点亮同一张，不再另开新卡。
  openThinkingActivity() {
    const existing = this._runThinkingId && this.data.messages.find((item) => item.id === this._runThinkingId)
    if (existing) {
      if (!existing.streaming) {
        existing.streaming = true
        this.renderAgentMessages()
      }
      return
    }
    // 不能用时间戳：历史回放同一毫秒内会开出多张卡，列表 key 重复
    this._thinkingSeq = (this._thinkingSeq || 0) + 1
    const id = `thinking-${Date.now()}-${this._thinkingSeq}`
    this._runThinkingId = id
    const context = this.buildRunContext()
    this.insertAgentActivity({
      kind: 'thinking',
      id,
      streaming: true,
      context,
      preview: thinkingSummary(context, 'thinking')
    })
  },

  // 本轮 run 的话题：最近一条用户消息；若它是在回答问题卡，则记为「回答」。
  buildRunContext() {
    const messages = this.data.messages
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'user') continue
      const text = String(message.text || '')
      const answeredCard = messages.slice(0, i).reverse().find((item) => item.kind === 'question')
      const isAnswer = Boolean(answeredCard && answeredCard.answered && (
        answeredCard.answerText === text ||
        (answeredCard.options || []).some((option) => text.split('、').includes(option.label))
      ))
      return isAnswer ? { topic: '', answer: summarizeTopic(text, 12) } : { topic: summarizeTopic(text), answer: '' }
    }
    return { topic: '', answer: '' }
  },

  settleThinkingActivity() {
    let changed = false
    this.data.messages.forEach((item) => {
      if (item.kind === 'thinking' && item.streaming) {
        item.streaming = false
        // 正文开始输出时先给出暂定总结，run 结束时再按结果定稿
        item.preview = thinkingSummary(item.context, 'answer')
        changed = true
      }
    })
    if (changed) this.renderAgentMessages()
  },

  // run 结束：按这一轮的结果（提问 / 建课 / 回复 / 失败）给思考卡写一句总结。
  // 小字只概括「这一轮在想什么」，不搬运回复正文——那是答案本身，不是思考的总结。
  finalizeThinkingSummary(status) {
    const messages = this.data.messages
    const index = messages.findIndex((item) => item.id === this._runThinkingId)
    if (index < 0) return
    const after = messages.slice(index + 1)
    const phase = status === 'failed'
      ? 'failed'
      : after.some((item) => item.kind === 'stage')
        ? 'course'
        : after.some((item) => item.kind === 'question')
          ? 'question'
          : 'answer'
    const card = messages[index]
    card.preview = thinkingSummary(card.context, phase)
    this.renderAgentMessages()
  },

  // run 结束时仍显示运行中的工具一律收尾，避免状态点一直转。
  settleRunningTools(state) {
    let changed = false
    this.data.messages.forEach((item) => {
      if (item.kind === 'tool' && item.state === 'running') {
        item.state = state
        changed = true
      }
    })
    if (changed) this.renderAgentMessages()
  },

  // 已回答的问题卡保留题目和所选答案（题目里常带着 AI 出的小题，不能一答就消失）。
  markQuestionsAnswered(answerText) {
    let changed = false
    this.data.messages.forEach((item) => {
      if (item.kind === 'question' && !item.answered) {
        item.answered = true
        if (!(item.selectedIds && item.selectedIds.length) && answerText) {
          // 回放历史时按回答文字还原所选项；对不上的（用户自己打字）记为「我的回答」
          const parts = String(answerText).split('、')
          const matched = (item.options || []).filter((option) => parts.includes(option.label)).map((option) => option.id)
          if (matched.length && matched.length === parts.length) this.applyQuestionSelection(item, matched)
          else item.answerText = String(answerText)
        }
        changed = true
      }
    })
    if (changed) this.renderAgentMessages()
  },

  updateStreamingAssistant(text) {
    if (this._agentStreamLive) {
      const messages = this.data.messages
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== 'assistant') break
        if (message.isTyping || !message.text) {
          this.ensureStreamReveal(message.id).setTarget(text)
          this.scheduleStreamRevealTick()
          break
        }
      }
      return
    }
    this._agentStreamText = String(text || '')
    if (this._agentStreamFlush) return
    this._agentStreamFlush = setTimeout(() => {
      this._agentStreamFlush = null
      const next = this._agentStreamText
      this._agentStreamText = null
      if (this._isDestroyed || !next) return
      const messages = this.data.messages
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        if (message.role !== 'assistant') break
        if (message.isTyping || !message.text) {
          const previous = Array.from(message.text || '')
          const upcoming = Array.from(next)
          message.text = next
          message.markdownNodes = renderMarkdown(next)
          message.streamReserveLine = message.isTyping && shouldReserveStreamLine(
            next,
            upcoming[previous.length],
            upcoming.slice(previous.length, previous.length + 2)
          )
          break
        }
      }
      this.setData({ messages: messages.slice(), ...this.getChatScrollUpdate() })
    }, AGENT_RENDER_THROTTLE_MS)
  },

  finishAgentAssistantReply(text, { keepSending = false } = {}) {
    const messages = this.data.messages
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') break
      const reveal = this._streamReveal && this._streamReveal.id === message.id ? this._streamReveal.engine : null
      if (reveal && (reveal.target || text)) {
        // 正在渐显：不整段替换，交给渐显收尾（约 0.4 秒补完剩余文字）
        reveal.setTarget(typeof text === 'string' && text ? text : reveal.target, { final: true })
        this.scheduleStreamRevealTick()
      } else if (typeof text === 'string' && text) {
        message.text = text
        message.markdownNodes = renderMarkdown(text)
      }
      if (!message.text && message.isTyping && !(reveal && reveal.target)) {
        // 只输出工具与提问的 run：撤掉空打字气泡。
        messages.splice(i, 1)
      } else {
        message.isTyping = false
        message.streamReserveLine = false
        message.createdAt = message.createdAt || Date.now()
        message.createdAtLabel = message.createdAtLabel || formatReplyTime(message.createdAt)
      }
      break
    }
    if (keepSending) {
      this.setData({ messages: messages.slice(), ...this.getChatScrollUpdate() })
      return
    }
    this._agentActive = false
    this.setData({
      messages: messages.slice(),
      isSending: false,
      canSend: Boolean(String(this.data.inputValue || '').trim()),
      'model.currentState': this.data.model.states.completed,
      ...this.getChatScrollUpdate()
    })
  },

  // 选项卡片：点选只改变选中状态，统一由「确认」按钮提交（单选、多选一致）。
  // 选中态写在每个选项的 selected 上：WXML 表达式不支持 indexOf 等方法调用，
  // 真机上 selectedIds.indexOf(...) 恒为假，会导致点了没有任何反馈。
  findQuestionCard(questionId) {
    const messages = this.data.messages
    if (questionId) return messages.find((entry) => entry.id === questionId) || null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].kind === 'question' && !messages[i].answered) return messages[i]
    }
    return null
  },

  applyQuestionSelection(card, selectedIds) {
    const chosen = (card.options || []).filter((option) => selectedIds.includes(option.id)).map((option) => option.id)
    card.options = (card.options || []).map((option) => ({ ...option, selected: chosen.includes(option.id) }))
    card.selectedIds = chosen
    card.selectedCount = chosen.length
    card.confirmLabel = card.multiSelect && chosen.length ? `确认（已选 ${chosen.length} 项）` : '确认'
  },

  handleQuestionOptionTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const card = this.findQuestionCard(String(e.currentTarget.dataset.questionId || ''))
    if (!id || !card || card.kind !== 'question' || card.answered) return
    const current = card.selectedIds || []
    const next = card.multiSelect
      ? (current.includes(id) ? current.filter((item) => item !== id) : current.concat(id))
      : (current.includes(id) ? [] : [id])
    this.applyQuestionSelection(card, next)
    this.renderAgentMessages()
  },

  handleQuestionConfirm(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const card = this.findQuestionCard(String(dataset.questionId || ''))
    if (!card || card.answered) return
    if (!(card.selectedIds && card.selectedIds.length)) {
      wx.showToast({ title: card.multiSelect ? '请先选择至少一项' : '请先选择一项', icon: 'none' })
      return
    }
    if (this.data.isSending) {
      wx.showToast({ title: '请等当前回复完成', icon: 'none' })
      return
    }
    this.sendQuestionAnswer(card.selectedIds, card)
  },

  sendQuestionAnswer(optionIds, card) {
    const target = card || this.findQuestionCard('')
    if (!target || target.answered || this.data.isSending) return
    const labels = (target.options || [])
      .filter((option) => optionIds.includes(option.id))
      .map((option) => option.label)
    this._questionSelections = {}
    this.applyQuestionSelection(target, optionIds)
    target.answered = true
    this.sendMessage(labels.join('、') || '继续')
  },

  // 课程卡片就是这门课唯一的链接：点开落到「学习 › 我的课程」——还在生成就在那里看进度，
  // 已经生成好就直接进入课程学习。switchTab 不能带参数，聚焦哪门课通过 storage 交接。
  handleStageOpen(e) {
    const stageId = String(e.currentTarget.dataset.stageId || '')
    if (!/^stage-[A-Za-z0-9_-]{1,64}$/.test(stageId)) {
      wx.showToast({ title: '课程还在准备中，请稍后再试', icon: 'none' })
      return
    }
    rememberAgentCourseFocus(stageId)
    wx.switchTab({
      url: '/pages/learning/index',
      // 学习页打不开时（极少见）退回单课进度页，链接不至于点了没反应。
      fail: () => wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(stageId)}` })
    })
  },

  startFakeStreamReply(text, runToken) {
    const characters = Array.from(String(text || ''))
    let visibleCount = 0
    const revealNextChunk = () => {
      if (runToken !== this._agentRunToken || this._isDestroyed) return
      visibleCount = Math.min(characters.length, visibleCount + FAKE_STREAM_CHARS_PER_TICK)
      const partialText = characters.slice(0, visibleCount).join('')
      const messages = this.data.messages.slice()
      const lastMessage = messages[messages.length - 1]
      if (!lastMessage || lastMessage.role !== 'assistant') return
      lastMessage.text = partialText
      lastMessage.markdownNodes = renderMarkdown(partialText)
      lastMessage.isTyping = visibleCount < characters.length
      lastMessage.streamReserveLine = lastMessage.isTyping && shouldReserveStreamLine(
        partialText,
        characters[visibleCount],
        characters.slice(visibleCount, visibleCount + FAKE_STREAM_CHARS_PER_TICK)
      )
      this.setData({ messages, ...this.getChatScrollUpdate() })
      if (visibleCount >= characters.length) {
        this._fakeStreamTimer = null
        this.finishReply(partialText)
        return
      }
      this._fakeStreamTimer = setTimeout(revealNextChunk, FAKE_STREAM_INTERVAL)
    }
    this._fakeStreamTimer = setTimeout(revealNextChunk, FAKE_STREAM_INTERVAL)
  },

  finishReply(text) {
    const messages = this.data.messages.slice()
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant') return
    lastMessage.text = String(text || '')
    lastMessage.markdownNodes = renderMarkdown(lastMessage.text)
    lastMessage.isTyping = false
    lastMessage.streamReserveLine = false
    lastMessage.createdAt = Date.now()
    lastMessage.createdAtLabel = formatReplyTime(lastMessage.createdAt)
    this._agentActive = false
    this.setData({
      messages,
      isSending: false,
      canSend: Boolean(String(this.data.inputValue || '').trim()),
      'model.currentState': this.data.model.states.completed,
      ...this.getChatScrollUpdate()
    })
  },

  finishLocalFallback(prompt, error) {
    const preset = (this.data.model.presets || []).find((item) => item.prompt === prompt)
    const replyText = preset
      ? preset.reply
      : '这是一个很好的问题。你可以先把问题拆成一个最小步骤，写下已经知道的条件，再逐步检查自己的理解。'
    this.finishReply(replyText)
    if (error) {
      // 透出真实原因（登录缺失/凭证过期/网络），便于用户自助与排查。
      const reason = String(error && error.message || '').slice(0, 40)
      wx.showToast({ title: reason || 'AI 服务暂时不可用，已切换本地演示', icon: 'none' })
    }
    return error
  },

  finishFailedReply(error) {
    const messages = this.data.messages.slice()
    const lastMessage = messages[messages.length - 1]
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.text = '本次 AI 请求失败，请稍后重试。'
      lastMessage.markdownNodes = renderMarkdown(lastMessage.text)
      lastMessage.isTyping = false
      lastMessage.createdAt = Date.now()
      lastMessage.createdAtLabel = formatReplyTime(lastMessage.createdAt)
    }
    this._agentActive = false
    this.setData({
      messages,
      isSending: false,
      'model.currentState': this.data.model.states.failed,
      ...this.getChatScrollUpdate()
    })
    wx.showToast({ title: error && error.message || '本次 AI 请求失败', icon: 'none' })
  },

  cancelAgentRun(stopRemote) {
    this._agentRunToken += 1
    this.clearAgentStreamFlush()
    if (stopRemote && this._agentActive && this._agentSessionId && !this._agentMock) {
      cancelCourseAgentSession(this._agentSessionId).catch(() => {})
    }
    this._agentActive = false
  },

  clearReplyTimers() {
    if (this._replyTimer) clearTimeout(this._replyTimer)
    if (this._replyInterval) clearInterval(this._replyInterval)
    if (this._fakeStreamTimer) clearTimeout(this._fakeStreamTimer)
    this._replyTimer = null
    this._replyInterval = null
    this._fakeStreamTimer = null
  },

  handleMessageAction(e) {
    const messageId = e.currentTarget.dataset.id
    const action = e.currentTarget.dataset.action
    const index = this.data.messages.findIndex((message) => message.id === messageId)
    const message = index >= 0 ? this.data.messages[index] : null
    if (!message || message.role !== 'assistant' || !message.text) return

    if (action === 'copy') {
      wx.setClipboardData({
        data: message.text,
        success: () => wx.showToast({ title: '已复制回答', icon: 'none' })
      })
      return
    }
    if (action === 'like' || action === 'dislike') {
      const nextFeedback = message.feedback === action ? '' : action
      this.setData({ [`messages[${index}].feedback`]: nextFeedback })
      return
    }
    if (action === 'share') {
      wx.showToast({ title: '分享功能待接入', icon: 'none' })
    }
  },

  handleComposerTouchStart(e) {
    // AI 回复中也允许语音输入：识别结果先放进输入框，回复结束后再发送。
    if (this.data.inputValue || this._voiceTimer || this._asrBusy) return
    if (this.data.voiceMode && !(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.voiceTrigger)) return
    this._voiceTouching = true
    const touch = e && e.touches && e.touches[0]
    this._voiceStartY = touch ? touch.pageY : 0
    this._voiceCancel = false
    this._voiceTimer = setTimeout(() => {
      this._voiceTimer = null
      this._touchVoiceStarted = true
      this.requestVoicePermissionAndStart()
    }, VOICE_LONG_PRESS_DELAY)
  },

  handleComposerLongPress(e) {
    if (this.data.voiceMode && !(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.voiceTrigger)) return
    if (!this.data.voiceRecognizing && !this.data.inputValue && !this._asrBusy) {
      this._touchVoiceStarted = true
      this._voiceCancel = false
      this.requestVoicePermissionAndStart()
    }
  },

  requestVoicePermissionAndStart() {
    if (this.data.inputValue || this.data.voiceRecognizing || this._asrBusy) return
    if (this.data.microphonePermission === 'granted') {
      this.startVoiceDemo()
      return
    }
    if (this._permissionRequestPending) return

    this._permissionRequestPending = true
    const resolvePermission = (granted) => {
      this._permissionRequestPending = false
      if (granted) {
        this.setData({ microphonePermission: 'granted' })
        if (this._voiceTouching) this.startVoiceDemo()
        return
      }
      this.setData({ microphonePermission: 'denied' })
      this.showVoicePermissionRecovery()
    }
    const authorize = () => {
      if (!wx.authorize) {
        // The development tool may not expose the native prompt. Keep the
        // local visual demo available there, while real devices still ask.
        resolvePermission(true)
        return
      }
      wx.authorize({
        scope: 'scope.record',
        success: () => resolvePermission(true),
        fail: () => resolvePermission(false)
      })
    }

    if (!wx.getSetting) {
      authorize()
      return
    }
    wx.getSetting({
      success: (setting) => {
        const authSetting = setting && setting.authSetting ? setting.authSetting : {}
        if (authSetting['scope.record'] === true) {
          resolvePermission(true)
        } else if (authSetting['scope.record'] === false) {
          resolvePermission(false)
        } else {
          authorize()
        }
      },
      fail: authorize
    })
  },

  showVoicePermissionRecovery() {
    const composer = this.data.model.composer || {}
    if (!wx.showModal) {
      wx.showToast({ title: composer.permissionDeniedLabel || '需要麦克风权限', icon: 'none' })
      return
    }
    wx.showModal({
      title: composer.permissionTitle || '需要麦克风权限',
      content: composer.permissionContent || '开启后可展示语音输入动效，声音不会上传、保存或转写。',
      confirmText: composer.permissionConfirmText || '去设置',
      cancelText: composer.permissionCancelText || '暂不开启',
      success: (result) => {
        if (result.confirm && wx.openSetting) wx.openSetting({})
      }
    })
  },

  startVoiceDemo() {
    this.cancelComposerFocusRequest()
    this.setData({
      voiceHolding: true,
      voiceRecognizing: true,
      voiceCancel: false,
      voiceSoundActive: false,
      voiceBars: VOICE_BARS,
      inputFocus: false,
      keyboardHeight: 0
    })
    if (wx.hideKeyboard) wx.hideKeyboard()
    this.startRecorderCapture()
    this.startVoiceVisualizer()
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
    if (!this.data.voiceRecognizing) {
      this.setData({ voiceSoundActive: false, voiceBars: [] })
      return
    }
    const now = Date.now()
    const snapshot = this._pcmLevelMeter ? this._pcmLevelMeter.getSnapshot(now) : null
    const hasPcmHistory = Boolean(
      this._recorderActive &&
      this._pcmLevelAvailable &&
      snapshot
    )
    const hasLiveAudio = hasPcmHistory && snapshot.fresh
    // DevTools normally has no native PCM frame callback. Keep the visual demo
    // moving there, while fresh per-band RMS PCM data always takes priority on
    // a real device. Each bar is smoothed independently and releases quickly.
    const bars = hasPcmHistory ? createVoiceBars(snapshot.barLevels) : createFallbackVoiceBars(now)
    this.setData({
      voiceSoundActive: hasLiveAudio ? snapshot.level >= 0.06 : true,
      voiceBars: bars
    })
  },

  attachRecorderOwner() {
    const bridge = getRecorderBridge()
    if (bridge) bridge.attach(this)
    return bridge
  },

  startRecorderCapture() {
    const bridge = this.attachRecorderOwner()
    if (!bridge) {
      wx.showToast({ title: '当前环境暂不支持实时音量', icon: 'none' })
      return
    }
    this._recorderStartPending = true
    this._pcmLevelAvailable = false
    this._pcmLevelMeter.reset()
    this._asrChunks = []
    this._asrBytes = 0
    try {
      const sessionId = bridge.start(this, RECORDER_OPTIONS)
      if (sessionId == null) throw new Error('Recorder owner is not active')
    } catch (error) {
      this._recorderStartPending = false
      this._recorderSessionId = null
      wx.showToast({ title: '麦克风启动失败，请稍后重试', icon: 'none' })
    }
  },

  // 真实语音转文字：PCM 帧拼 WAV → multipart 上传课程服务转写 → 填入输入框/直接发送。
  // 走 wx.request（与课程智能体同一 request 合法域名），不依赖单独配置的 uploadFile 域名，也不写临时文件。
  transcribeVoice(chunks, sendDirectly) {
    this._asrBusy = true
    wx.showLoading({ title: '正在识别…', mask: true })
    const boundary = `----zhiluVoice${Date.now().toString(16)}`
    const body = buildVoiceMultipartBody(chunks, boundary)
    wx.request({
      url: ASR_TRANSCRIBE_URL,
      method: 'POST',
      header: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      data: body.buffer,
      dataType: 'text',
      responseType: 'text',
      timeout: 45000,
      success: res => {
        let payload = null
        try { payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data } catch (error) { payload = null }
        const text = payload && payload.success && (String(payload.text || '').trim() || String(payload.data && payload.data.text || '').trim()) || ''
        if (res.statusCode === 200 && text) this.finishVoiceAsr(sendDirectly, text)
        else if (res.statusCode === 200) this.finishVoiceAsr(sendDirectly, '', '没听清，请再试一次')
        else {
          console.warn('[agent-chat] 语音识别失败:', res.statusCode, payload && payload.code)
          this.finishVoiceAsr(sendDirectly, '', res.statusCode === 429 ? '识别太频繁，请稍后再试' : '语音识别暂不可用，请用文字输入')
        }
      },
      fail: error => {
        const errMsg = String(error && error.errMsg || '')
        console.warn('[agent-chat] 语音上传失败:', errMsg)
        const warning = /domain|合法域名/i.test(errMsg)
          ? '语音服务域名未配置，请用文字输入'
          : /timeout|超时/i.test(errMsg) ? '识别超时，请重试' : '网络异常，语音识别失败'
        this.finishVoiceAsr(sendDirectly, '', warning)
      }
    })
  },

  finishVoiceAsr(sendDirectly, text, warning) {
    if (this._isDestroyed) return
    wx.hideLoading()
    this._asrBusy = false
    if (text) {
      if (sendDirectly && !this.data.isSending) {
        this.sendMessage(text)
        return
      }
      this.setData({ voiceMode: false, inputValue: text, canSend: !this.data.isSending, inputActive: true })
      if (this.data.isSending) wx.showToast({ title: '已识别，AI 回复结束后可发送', icon: 'none' })
      return
    }
    if (warning) wx.showToast({ title: warning, icon: 'none' })
  },

  stopRecorderCapture(unloading = false) {
    const sessionId = this._recorderSessionId
    this._recorderStartPending = false
    this._recorderActive = false
    this._pcmLevelAvailable = false
    if (this._pcmLevelMeter) this._pcmLevelMeter.reset()
    if (recorderBridge) {
      if (unloading) recorderBridge.cancelOwner(this)
      else recorderBridge.stop(this, sessionId)
    }
    // Keep the session ID until the bridge confirms onStop; RecorderManager
    // callbacks do not carry an operation ID and clearing it early would make
    // the terminal callback impossible to match.
    if (unloading) this._recorderSessionId = null
  },

  _handleRecorderStart(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderStartPending = false
    if (!this.data.voiceRecognizing || !this._isPageVisible || this._isDestroyed) {
      if (recorderBridge) recorderBridge.stop(this, sessionId)
      return
    }
    this._recorderActive = true
    this._lastRecorderFrameAt = 0
    this.setData({ microphonePermission: 'granted' })
  },

  _handleRecorderFrame(result, sessionId) {
    if (sessionId !== this._recorderSessionId || !this._recorderActive) return
    const frameBuffer = result && result.frameBuffer
    // 收集 PCM 帧用于松手后的真实语音转写（上限约 60 秒）
    if (frameBuffer && frameBuffer.byteLength) {
      if (!this._asrChunks) this._asrChunks = []
      this._asrBytes = (this._asrBytes || 0) + frameBuffer.byteLength
      if (this._asrBytes <= 1920000) this._asrChunks.push(frameBuffer)
    }
    if (!this._pcmLevelMeter || !this._pcmLevelMeter.process(frameBuffer)) return
    this._pcmLevelAvailable = true
  },

  _handleRecorderStop(result, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderSessionId = null
    this._recorderStartPending = false
    this._recorderActive = false
    this._pcmLevelAvailable = false
    if (this._pcmLevelMeter) this._pcmLevelMeter.reset()
  },

  _handleRecorderError(error, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderSessionId = null
    this._recorderStartPending = false
    this._recorderActive = false
    this._pcmLevelAvailable = false
    if (this._pcmLevelMeter) this._pcmLevelMeter.reset()
    wx.showToast({ title: '麦克风启动失败，请稍后重试', icon: 'none' })
  },

  handleComposerTouchMove(e) {
    if (!this.data.voiceRecognizing || !this._voiceStartY) return
    const touch = e && e.touches && e.touches[0]
    if (!touch) return
    const voiceCancel = touch.pageY < this._voiceStartY - 60
    if (voiceCancel === this._voiceCancel) return
    this._voiceCancel = voiceCancel
    this.setData({ voiceCancel })
  },

  handleComposerTouchEnd() {
    if (this._voiceTimer) {
      clearTimeout(this._voiceTimer)
      this._voiceTimer = null
    }
    this._voiceTouching = false
    if (!this.data.voiceRecognizing && !this.data.voiceHolding) return
    this._ignoreNextComposerTap = true
    this._touchVoiceStarted = false
    const canceled = this._voiceCancel || this.data.voiceCancel
    this._voiceCancel = false
    this.stopVoiceVisualizer()
    this.stopRecorderCapture()
    const sendDirectly = !canceled && this.data.voiceMode
    const nextState = canceled ? {
      voiceHolding: false,
      voiceRecognizing: false,
      voiceCancel: false,
      voiceSoundActive: false,
      voiceBars: [],
      inputFocus: false,
      keyboardHeight: 0
    } : sendDirectly ? {
      voiceHolding: false,
      voiceRecognizing: false,
      voiceCancel: false,
      voiceSoundActive: false,
      voiceBars: [],
      inputActive: false,
      inputFocus: false,
      keyboardHeight: 0,
      inputValue: '',
      canSend: false
    } : {
      voiceHolding: false,
      voiceRecognizing: false,
      voiceCancel: false,
      voiceSoundActive: false,
      voiceBars: [],
      inputActive: true,
      inputFocus: false,
      keyboardHeight: 0,
      inputValue: '',
      canSend: false
    }
    this.setData(nextState, () => {
      if (canceled) return
      // 有真实录音时走语音转文字；失败回落演示文案
      const chunks = this._asrChunks || []
      this._asrChunks = []
      const bytes = chunks.reduce((sum, c) => sum + (c && c.byteLength || 0), 0)
      if (bytes >= 3200) {
        this.transcribeVoice(chunks, sendDirectly)
      } else {
        wx.showToast({ title: '说话时间太短，请重新长按', icon: 'none' })
      }
    })
  }
})
