const { getAiVoiceConversationModel } = require('../../services/mock-service')
const {
  SUPPORTED_VOICE_STATES,
  analyzePcm16LeFrame,
  smoothLevel,
  updateMicrophoneEnvelope,
  createVoiceActivityBars,
  getAuraMotion,
  getStateVisualTarget,
  getDemoSpeakingLevel
} = require('../../utils/ai-voice-visualizer')
const { getSharedRecorderBridge } = require('../../utils/recorder-session-bridge')

const AURA_DPR_LIMIT = 2
const AURA_POINT_COUNT = 42
const AUDIO_VISUALIZER_INTERVAL = 50
const MICROPHONE_FRAME_TIMEOUT = 800
const TRANSCRIPT_USER_INTERVAL = 34
const TRANSCRIPT_ASSISTANT_INTERVAL = 40
const TRANSCRIPT_MESSAGE_DELAY = 200
const TRANSCRIPT_MIN_HEIGHT_RPX = 188
const TRANSCRIPT_MAX_HEIGHT_RPX = 520
const TRANSCRIPT_REMEASURE_DELAY = 42
const DEBUG_SHEET_CLOSE_DURATION = 260

// Base library 3.17.2's declarations accept uppercase `PCM`; device practice
// and working Mini Program implementations interpret its frameBuffer as signed
// 16-bit PCM. Parse it explicitly as little-endian instead of relying on the
// platform byte order of Int16Array. Target iOS/Android regression remains part
// of release verification, and compressed formats must never enter this path.
const RECORDER_FORMAT = 'PCM'
const RECORDER_OPTIONS = Object.freeze({
  duration: 600000,
  sampleRate: 16000,
  numberOfChannels: 1,
  format: RECORDER_FORMAT,
  // 2KB PCM frames keep the local visual response closer to the user's voice
  // while remaining small enough for the recorder callback cadence.
  frameSize: 2
})
const RECORDER_FRAMES_ARE_PCM16_LE = RECORDER_FORMAT === 'PCM'

let recorderBridge = null

function discardTemporaryRecording(filePath) {
  if (!filePath || !wx.getFileSystemManager) return
  try {
    // RecorderManager always returns a platform-managed temporary result on
    // stop. The app never reads, plays, saves, uploads, or logs this path.
    wx.getFileSystemManager().unlink({ filePath, fail() {} })
  } catch (error) {
    // Cleanup is best effort; suppress path-bearing errors for privacy.
  }
}

/**
 * RecorderManager is shared by the Mini Program and has no operation IDs in
 * callbacks. All pages share one bridge, which serializes start/stop and retains
 * each initiating owner/session until onStop confirms physical termination.
 * This prevents late callbacks from mutating a newer conversation.
 */
function getRecorderBridge() {
  if (!recorderBridge) recorderBridge = getSharedRecorderBridge({ discardTemporaryRecording })
  return recorderBridge
}

function getWindowMetrics() {
  return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
}

function getNavigationMetrics() {
  const windowInfo = getWindowMetrics()
  const windowWidth = windowInfo.windowWidth || 375
  const menuButton = wx.getMenuButtonBoundingClientRect
    ? wx.getMenuButtonBoundingClientRect()
    : {
        left: windowWidth - 92,
        top: (windowInfo.statusBarHeight || 20) + 6,
        width: 87,
        height: 32
      }
  const statusBarHeight = windowInfo.statusBarHeight || 20
  const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
  const safeArea = windowInfo.safeArea || {}
  const safeAreaBottom = Math.max(
    0,
    (windowInfo.screenHeight || windowInfo.windowHeight || 0) - (safeArea.bottom || windowInfo.windowHeight || 0)
  )

  return {
    windowWidth,
    windowHeight: windowInfo.windowHeight || 667,
    statusBarHeight,
    navigationBarHeight,
    contentTop: statusBarHeight + navigationBarHeight,
    menuButtonTop: menuButton.top,
    menuButtonHeight: menuButton.height,
    moreButtonRight: windowWidth - menuButton.left + 8,
    safeAreaBottom
  }
}

function decodePrompt(value) {
  if (typeof value !== 'string' || !value) return value
  try {
    return decodeURIComponent(value)
  } catch (error) {
    return value
  }
}

function createPcmLevelMeter(onLevel) {
  let level = 0
  let peak = 0.012
  let lastFrameAt = 0

  return {
    reset() {
      level = 0
      peak = 0.012
      lastFrameAt = 0
    },

    process(frameBuffer, now = Date.now()) {
      if (!RECORDER_FRAMES_ARE_PCM16_LE) return false
      const analysis = analyzePcm16LeFrame(frameBuffer)
      if (!analysis.valid) return false

      const envelope = updateMicrophoneEnvelope(level, peak, analysis.rms)
      level = envelope.level
      peak = envelope.peak
      lastFrameAt = now
      if (typeof onLevel === 'function') onLevel({ level, peak, lastFrameAt })
      return true
    },

    getSnapshot(now = Date.now()) {
      const fresh = Boolean(lastFrameAt && now - lastFrameAt <= MICROPHONE_FRAME_TIMEOUT)
      if (lastFrameAt && !fresh) level = smoothLevel(level, 0, 0.5, 0.12)
      return { level, peak, lastFrameAt, fresh }
    }
  }
}

Page({
  data: {
    model: {},
    currentState: {},
    voiceState: 'idle',
    stateOrigin: 'system',
    stateOriginLabel: '',
    currentStateDescription: '',
    transcriptEntries: [],
    compactTranscriptStartIndex: 0,
    transcriptStyle: 'height: 94px;',
    subtitleEnabled: true,
    subtitlesExpanded: false,
    transcriptScrollTop: 0,
    debugSheetVisible: false,
    debugSheetClosing: false,
    recorderActive: false,
    micDesired: false,
    microphonePermission: 'unknown',
    audioLevelMode: 'waiting',
    audioLevelModeLabel: '',
    waveformBars: createVoiceActivityBars(0),
    micAriaLabel: '开启麦克风',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    menuButtonTop: 26,
    menuButtonHeight: 32,
    moreButtonRight: 100,
    safeAreaBottom: 0,
    auraSize: 236
  },

  onLoad(options = {}) {
    this._isDestroyed = false
    this._isPageVisible = true
    this._pageReady = false
    this._didInitializeReadyPage = false
    this._didAttemptInitialPermission = false
    this._permissionGeneration = 0
    this._demoGeneration = 0
    this._layoutGeneration = 0
    this._canvasInitGeneration = 0
    this._canvasInitRetryCount = 0
    this._demoTimers = new Set()
    this._typingTimers = new Set()
    this._typingGeneration = 0
    this._resumeTypingAfterShow = false
    this._microphoneLevel = 0
    this._microphonePeak = 0.012
    this._pcmLevelAvailable = false
    this._pcmLevelMeter = createPcmLevelMeter((snapshot) => {
      this._microphoneLevel = snapshot.level
      this._microphonePeak = snapshot.peak
      this._lastRecorderFrameAt = snapshot.lastFrameAt
    })
    this._lastRecorderFrameAt = 0
    this._audioVisualizerTimer = null
    this._audioVisualizerGeneration = 0
    this._transcriptLayoutTimer = null
    this._transcriptLayoutGeneration = 0
    this._auraInputLevel = 0
    this._lastWaveformSignature = ''
    this._recorderStartPending = false
    this._recorderSessionId = null
    this._permissionRequestPending = false
    this._openingMicrophoneSettings = false
    this._resumePermissionAfterSettings = false
    this._visualCurrent = getStateVisualTarget('idle')
    this._visualEnergy = 0

    const model = getAiVoiceConversationModel(
      options.conversationId,
      options.state,
      decodePrompt(options.prompt)
    )
    const initialTranscriptEntries = this.createTranscriptEntries(model.conversation)
    const metrics = getNavigationMetrics()
    const auraSize = this.getAuraSize(metrics, true)
    this.setData({
      ...metrics,
      auraSize,
      transcriptStyle: this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX, metrics.windowWidth),
      model,
      currentState: model.currentState,
      voiceState: model.voiceState,
      currentStateDescription: model.currentState.description,
      compactTranscriptStartIndex: this.getFirstTranscriptTurnStartIndex(initialTranscriptEntries),
      audioLevelModeLabel: model.waveform && model.waveform.levelModes
        ? model.waveform.levelModes.waiting
        : '',
      transcriptEntries: initialTranscriptEntries
        .map((entry) => ({ ...entry, displayText: '' })),
      micAriaLabel: model.controls[0].offLabel
    })
  },

  onReady() {
    this._pageReady = true
    this.initializeReadyPage()
  },

  onShow() {
    this._isPageVisible = true
    if (this._pageReady) {
      this.initializeReadyPage()
      this.attachRecorderOwner()
      this.startAuraAnimation()
      this.startAudioVisualizerTicker()
    }
    if (this._resumeTypingAfterShow && this._didInitializeReadyPage) {
      this._resumeTypingAfterShow = false
      const conversation = this.data.model.conversation
      if (conversation) this.typeConversationTranscript(conversation)
    }
    if (this._resumePermissionAfterSettings) {
      this._resumePermissionAfterSettings = false
      this.reconcileMicrophoneSetting()
    }
  },

  onHide() {
    this._isPageVisible = false
    if (this._openingMicrophoneSettings) {
      // Native settings can hide the page. Keep that permission operation alive,
      // but still stop and release any recorder session before leaving view.
      this.stopForPageExit(false, { preserveSettingsOperation: true })
      return
    }
    this.stopForPageExit(false)
  },

  onUnload() {
    this._isDestroyed = true
    this._isPageVisible = false
    this.stopForPageExit(true)
    this._canvasInitGeneration += 1
    this._canvas = null
  },

  onResize() {
    if (this._isDestroyed) return
    const metrics = getNavigationMetrics()
    const auraSize = this.getAuraSize(metrics, this.data.subtitleEnabled)
    this.setData({
      ...metrics,
      auraSize,
      ...(!this.data.subtitlesExpanded
        ? { transcriptStyle: this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX, metrics.windowWidth) }
        : {})
    }, () => {
      this.scheduleCanvasRemeasure(0)
      this.scheduleTranscriptRemeasure(0)
    })
  },

  initializeReadyPage() {
    if (
      !this._pageReady ||
      this._didInitializeReadyPage ||
      !this._isPageVisible ||
      this._isDestroyed
    ) return

    // onReady can race onHide during native navigation. Defer the entire one-time
    // setup until the page is visible again rather than attaching a hidden owner
    // or permanently skipping the transcript, canvas, and permission startup.
    this._didInitializeReadyPage = true
    this.initializeAuraCanvas()
    this.startAudioVisualizerTicker()
    const conversation = this.data.model.conversation
    if (conversation) this.typeConversationTranscript(conversation)
    this.attachRecorderOwner()
    if (!this._didAttemptInitialPermission) {
      this._didAttemptInitialPermission = true
      this.enableMicrophone({ automatic: true })
    }
  },

  getAuraSize(metrics, subtitleEnabled) {
    const sideLimit = metrics.windowWidth * 0.84
    const stageHeight = metrics.windowHeight - metrics.contentTop - 156 - (metrics.safeAreaBottom || 0)
    // Subtitles now overlay the stage rather than participating in layout, so
    // Aura geometry stays identical when captions are toggled.
    const heightLimit = Math.max(180, stageHeight - 86)
    return Math.round(Math.max(180, Math.min(sideLimit, heightLimit, 330)))
  },

  attachRecorderOwner() {
    const bridge = getRecorderBridge()
    if (bridge) bridge.attach(this)
    return bridge
  },

  detachRecorderOwner() {
    if (recorderBridge) recorderBridge.detach(this)
  },

  stopForPageExit(unloading, options = {}) {
    if (!options.preserveSettingsOperation) this._permissionGeneration += 1
    this.cancelDebugSequence()
    if (!unloading && this._typingTimers && this._typingTimers.size) {
      this._resumeTypingAfterShow = true
    }
    this.cancelTypingAnimations()
    this.clearUiTimers()
    this.cancelAuraAnimation()
    this.resetAudioVisualizer({ updateData: !unloading })
    // Cancellation lives in the module bridge so a late onStart is stopped
    // even after this page has detached or been destroyed.
    if (recorderBridge) recorderBridge.cancelOwner(this)
    this._recorderStartPending = false
    this._recorderSessionId = null
    this._permissionRequestPending = false
    if (!unloading) {
      this.setData({
        recorderActive: false,
        micDesired: false,
        audioLevelMode: 'waiting',
        audioLevelModeLabel: this.getAudioLevelModeLabel('waiting'),
        micAriaLabel: this.data.model.controls ? this.data.model.controls[0].offLabel : '开启麦克风'
      })
      this.setVoiceState('paused', 'system')
    } else {
      this.data.recorderActive = false
      this.data.micDesired = false
    }
  },

  clearUiTimers() {
    if (this._debugSheetCloseTimer) clearTimeout(this._debugSheetCloseTimer)
    if (this._layoutTimer) clearTimeout(this._layoutTimer)
    if (this._frameSupportTimer) clearTimeout(this._frameSupportTimer)
    this.stopAudioVisualizerTicker()
    this.stopTranscriptRemeasure()
    this._debugSheetCloseTimer = null
    this._layoutTimer = null
    this._frameSupportTimer = null
  },

  getAudioLevelModeLabel(mode = this.data.audioLevelMode) {
    const labels = this.data.model.waveform && this.data.model.waveform.levelModes
    return labels && labels[mode] ? labels[mode] : ''
  },

  setAudioLevelMode(mode) {
    const audioLevelModeLabel = this.getAudioLevelModeLabel(mode)
    if (this.data.audioLevelMode === mode && this.data.audioLevelModeLabel === audioLevelModeLabel) return
    const updates = { audioLevelMode: mode, audioLevelModeLabel }
    if (this.data.voiceState === 'recording' && this.data.stateOrigin !== 'debug') {
      const recordingState = this.data.model.states && this.data.model.states.recording
      if (recordingState) {
        updates.currentStateDescription = mode === 'neutral' && recordingState.neutralDescription
          ? recordingState.neutralDescription
          : recordingState.description
      }
    }
    this.setData(updates)
  },

  resolveMicrophoneVisualLevel(now = Date.now()) {
    if (!this.data.recorderActive || !this._recorderSessionId || !this._pcmLevelAvailable || !this._pcmLevelMeter) return 0
    const snapshot = this._pcmLevelMeter.getSnapshot(now)
    this._microphoneLevel = snapshot.level
    this._microphonePeak = snapshot.peak
    if (!snapshot.fresh) {
      if (this.data.audioLevelMode === 'live') this.setAudioLevelMode('neutral')
      return 0
    }
    if (this.data.audioLevelMode !== 'live') this.setAudioLevelMode('live')
    return snapshot.level
  },

  updateAudioVisualizer(now = Date.now()) {
    let level = this.resolveMicrophoneVisualLevel(now)
    if (!level && !this.data.recorderActive && this.data.voiceState === 'speaking' && this.data.stateOrigin === 'debug') {
      const startedAt = this._demoSpeakingStartedAt || now
      level = getDemoSpeakingLevel(now - startedAt, this._demoSpeakingSeed)
    }
    this._auraInputLevel = level
    const waveformBars = createVoiceActivityBars(level)
    const signature = waveformBars.map((bar) => `${bar.height}:${bar.opacity}`).join('|')
    if (signature !== this._lastWaveformSignature) {
      this._lastWaveformSignature = signature
      this.setData({ waveformBars })
    }
    return level
  },

  startAudioVisualizerTicker() {
    if (this._audioVisualizerTimer || !this._isPageVisible || this._isDestroyed) return
    const generation = ++this._audioVisualizerGeneration
    const tick = () => {
      if (
        generation !== this._audioVisualizerGeneration ||
        !this._isPageVisible ||
        this._isDestroyed
      ) return
      this._audioVisualizerTimer = null
      this.updateAudioVisualizer(Date.now())
      if (generation !== this._audioVisualizerGeneration) return
      this._audioVisualizerTimer = setTimeout(
        tick,
        AUDIO_VISUALIZER_INTERVAL
      )
    }
    this.updateAudioVisualizer(Date.now())
    this._audioVisualizerTimer = setTimeout(
      tick,
      AUDIO_VISUALIZER_INTERVAL
    )
  },

  stopAudioVisualizerTicker() {
    this._audioVisualizerGeneration += 1
    if (this._audioVisualizerTimer) clearTimeout(this._audioVisualizerTimer)
    this._audioVisualizerTimer = null
  },

  resetAudioVisualizer(options = {}) {
    this._microphoneLevel = 0
    this._microphonePeak = 0.012
    this._auraInputLevel = 0
    if (this._pcmLevelMeter) this._pcmLevelMeter.reset()
    this._pcmLevelAvailable = false
    this._lastRecorderFrameAt = 0
    const waveformBars = createVoiceActivityBars(0)
    const signature = waveformBars
      .map((bar) => `${bar.height}:${bar.opacity}`)
      .join('|')
    const waveformChanged = signature !== this._lastWaveformSignature
    this._lastWaveformSignature = signature
    if (options.updateData !== false && waveformChanged) {
      this.setData({ waveformBars })
    }
  },

  setVoiceState(state, origin, extraData = {}) {
    const safeState = SUPPORTED_VOICE_STATES.includes(state) ? state : 'idle'
    const stateModel = this.data.model.states && this.data.model.states[safeState]
      ? this.data.model.states[safeState]
      : this.data.model.currentState
    let description = stateModel ? stateModel.description : ''
    if (safeState === 'recording' && this.data.audioLevelMode === 'neutral' && stateModel.neutralDescription) {
      description = stateModel.neutralDescription
    }
    this.setData({
      voiceState: safeState,
      stateOrigin: origin,
      stateOriginLabel: origin === 'debug' ? this.data.model.debugPanel.demoBadge : '',
      currentState: stateModel,
      currentStateDescription: description,
      ...extraData
    })
  },

  toggleSubtitles() {
    // Captions are an overlay; toggling them must not resize or move the Aura.
    this.setData({ subtitleEnabled: !this.data.subtitleEnabled })
  },

  toggleTranscriptExpansion() {
    const subtitlesExpanded = !this.data.subtitlesExpanded
    this.setData({
      subtitlesExpanded,
      transcriptStyle: subtitlesExpanded
        ? ''
        : this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX),
      // Reset on collapse so reopening the compact view starts with a predictable
      // three-line window. Expanded mode retains native finger scrolling.
      ...(subtitlesExpanded ? {} : { transcriptScrollTop: 0 })
    }, () => {
      if (!subtitlesExpanded) this.scheduleTranscriptRemeasure(0)
    })
  },

  createTranscriptEntries(conversation) {
    if (!conversation) return []
    if (Array.isArray(conversation.messages)) {
      return conversation.messages.map((message, index) => ({
        id: message.id || `message-${index}`,
        role: message.role === 'user' ? 'user' : 'assistant',
        text: String(message.text || '')
      }))
    }
    return [
      { id: 'legacy-user', role: 'user', text: String(conversation.userText || '') },
      { id: 'legacy-assistant', role: 'assistant', text: String(conversation.assistantText || '') }
    ]
  },

  getFirstTranscriptTurnStartIndex(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].role === 'user') return index
    }
    return 0
  },

  beginTranscriptTurn(entryIndex) {
    const updates = { compactTranscriptStartIndex: entryIndex }
    if (!this.data.subtitlesExpanded) {
      updates.transcriptScrollTop = 0
      updates.transcriptStyle = this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX)
    }
    this.setData(updates, () => {
      if (!this.data.subtitlesExpanded) this.scheduleTranscriptRemeasure(0)
    })
  },

  typeConversationTranscript(conversation) {
    const entries = this.createTranscriptEntries(conversation)
    this._resumeTypingAfterShow = false
    this.cancelTypingAnimations()
    this.setData({
      transcriptEntries: entries.map((entry) => ({ ...entry, displayText: '' })),
      compactTranscriptStartIndex: this.getFirstTranscriptTurnStartIndex(entries),
      transcriptScrollTop: 0,
      transcriptStyle: this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX)
    }, () => this.scheduleTranscriptRemeasure(0))
    this.typeTranscriptEntries(entries)
  },

  typeTranscriptEntries(entries, entryIndex = 0) {
    if (entryIndex >= entries.length) return
    const entry = entries[entryIndex]
    if (entry.role === 'user') this.beginTranscriptTurn(entryIndex)
    const delay = entryIndex ? TRANSCRIPT_MESSAGE_DELAY : 0
    const timer = setTimeout(() => {
      this._typingTimers.delete(timer)
      this.typeTranscriptEntry(
        entryIndex,
        entry.text,
        entry.role === 'user'
          ? TRANSCRIPT_USER_INTERVAL
          : TRANSCRIPT_ASSISTANT_INTERVAL,
        () => {
          this.typeTranscriptEntries(entries, entryIndex + 1)
        }
      )
    }, delay)
    this._typingTimers.add(timer)
  },

  typeTranscriptEntry(entryIndex, text, interval, complete) {
    const generation = this._typingGeneration
    const characters = Array.from(text || '')
    let characterIndex = 0
    const revealNext = () => {
      if (generation !== this._typingGeneration || this._isDestroyed || !this._isPageVisible) return
      characterIndex += 1
      const updates = {
        [`transcriptEntries[${entryIndex}].displayText`]: characters.slice(0, characterIndex).join('')
      }
      // The compact transcript only renders the current turn. A numeric
      // top greater than the content height is clamped by scroll-view to its end;
      // users can still drag freely, while expansion preserves their position.
      if (!this.data.subtitlesExpanded && (
        characterIndex === 1 ||
        characterIndex === characters.length ||
        characterIndex % 8 === 0
      )) {
        updates.transcriptScrollTop = this.nextTranscriptScrollTop()
      }
      this.setData(updates, () => this.scheduleTranscriptRemeasure())
      if (characterIndex >= characters.length) {
        if (typeof complete === 'function') complete()
        return
      }
      const timer = setTimeout(() => {
        this._typingTimers.delete(timer)
        revealNext()
      }, interval)
      this._typingTimers.add(timer)
    }
    if (characters.length) revealNext()
    else if (typeof complete === 'function') complete()
  },

  nextTranscriptScrollTop() {
    const current = Number(this.data.transcriptScrollTop) || 0
    return current >= 1000000 ? 1000000 : current + 10000
  },

  getTranscriptStyle(heightRpx, windowWidth) {
    const width = Number(windowWidth) || getWindowMetrics().windowWidth || 375
    const heightPx = Math.round((Number(heightRpx) || TRANSCRIPT_MIN_HEIGHT_RPX) * width / 750 * 10) / 10
    return `height: ${heightPx}px;`
  },

  getTranscriptHeightBounds() {
    const metrics = getNavigationMetrics()
    const width = metrics.windowWidth || 375
    const minPx = TRANSCRIPT_MIN_HEIGHT_RPX * width / 750
    const maxRpxPx = TRANSCRIPT_MAX_HEIGHT_RPX * width / 750
    const stageHeight = Math.max(0, metrics.windowHeight - metrics.contentTop - 156 - (metrics.safeAreaBottom || 0))
    const maxAvailablePx = Math.max(minPx, stageHeight * 0.78)
    return {
      minPx,
      maxPx: Math.min(maxRpxPx, maxAvailablePx),
      width
    }
  },

  scheduleTranscriptRemeasure(delay = TRANSCRIPT_REMEASURE_DELAY) {
    if (
      this.data.subtitlesExpanded ||
      !this.data.subtitleEnabled ||
      typeof wx === 'undefined' ||
      !wx.createSelectorQuery ||
      this._isDestroyed ||
      !this._isPageVisible
    ) return
    const generation = ++this._transcriptLayoutGeneration
    if (this._transcriptLayoutTimer) clearTimeout(this._transcriptLayoutTimer)
    this._transcriptLayoutTimer = setTimeout(() => {
      this._transcriptLayoutTimer = null
      if (
        generation !== this._transcriptLayoutGeneration ||
        this.data.subtitlesExpanded ||
        this._isDestroyed ||
        !this._isPageVisible
      ) return
      const query = wx.createSelectorQuery().in(this)
      const selection = query.select('.transcript-list')
      if (!selection || !selection.boundingClientRect) return
      selection.boundingClientRect((rect) => {
        if (
          generation !== this._transcriptLayoutGeneration ||
          this.data.subtitlesExpanded ||
          this._isDestroyed ||
          !this._isPageVisible
        ) return
        const bounds = this.getTranscriptHeightBounds()
        const contentHeight = Number(rect && rect.height) || bounds.minPx
        const heightPx = Math.max(bounds.minPx, Math.min(bounds.maxPx, contentHeight))
        const nextStyle = `height: ${Math.round(heightPx * 10) / 10}px;`
        if (nextStyle !== this.data.transcriptStyle) {
          this.setData({ transcriptStyle: nextStyle })
        }
      }).exec()
    }, Math.max(0, Number(delay) || 0))
  },

  stopTranscriptRemeasure() {
    this._transcriptLayoutGeneration += 1
    if (this._transcriptLayoutTimer) clearTimeout(this._transcriptLayoutTimer)
    this._transcriptLayoutTimer = null
  },

  scheduleCanvasRemeasure(delay) {
    const generation = ++this._layoutGeneration
    if (this._layoutTimer) clearTimeout(this._layoutTimer)
    this._layoutTimer = setTimeout(() => {
      this._layoutTimer = null
      if (generation !== this._layoutGeneration || !this._isPageVisible || this._isDestroyed) return
      this.initializeAuraCanvas()
    }, delay)
  },

  openDebugSheet() {
    if (this._debugSheetCloseTimer) clearTimeout(this._debugSheetCloseTimer)
    this._debugSheetCloseTimer = null
    this.setData({ debugSheetVisible: true, debugSheetClosing: false })
  },

  closeDebugSheet() {
    if (!this.data.debugSheetVisible || this.data.debugSheetClosing) return
    this.setData({ debugSheetClosing: true })
    this._debugSheetCloseTimer = setTimeout(() => {
      this._debugSheetCloseTimer = null
      if (this._isDestroyed) return
      this.setData({ debugSheetVisible: false, debugSheetClosing: false })
    }, DEBUG_SHEET_CLOSE_DURATION)
  },

  stopTap() {},

  selectPreset(event) {
    const presetId = event.currentTarget.dataset.id
    const preset = (this.data.model.presets || []).find((item) => item.id === presetId)
    if (!preset) return

    this.closeDebugSheet()
    this.cancelDebugSequence()
    const generation = this._demoGeneration
    const entries = [
      { id: `${preset.id}-user`, role: 'user', text: preset.userText },
      { id: `${preset.id}-assistant`, role: 'assistant', text: preset.assistantText }
    ]
    this.cancelTypingAnimations()
    this.setData({
      transcriptEntries: entries.map((entry) => ({ ...entry, displayText: '' })),
      compactTranscriptStartIndex: this.getFirstTranscriptTurnStartIndex(entries),
      transcriptScrollTop: 0,
      transcriptStyle: this.getTranscriptStyle(TRANSCRIPT_MIN_HEIGHT_RPX)
    }, () => this.scheduleTranscriptRemeasure(0))
    this.typeTranscriptEntry(
      0,
      preset.userText,
      TRANSCRIPT_USER_INTERVAL
    )
    this.setVoiceState('transcribing', 'debug')
    this.scheduleDebugStep(generation, 720, () => this.setVoiceState('thinking', 'debug'))
    this.scheduleDebugStep(generation, 1880, () => {
      this._demoSpeakingStartedAt = Date.now()
      this._demoSpeakingSeed = preset.id
      this.typeTranscriptEntry(
        1,
        preset.assistantText,
        TRANSCRIPT_ASSISTANT_INTERVAL
      )
      this.setVoiceState('speaking', 'debug')
    })
    const speakingDuration = Math.max(
      6200,
      Array.from(preset.assistantText || '').length *
        TRANSCRIPT_ASSISTANT_INTERVAL +
        2400
    )
    this.scheduleDebugStep(generation, speakingDuration, () => this.settleAfterDebugSequence())
  },

  selectDebugState(event) {
    const state = event.currentTarget.dataset.state
    if (!SUPPORTED_VOICE_STATES.includes(state)) return
    this.cancelDebugSequence()
    this.cancelTypingAnimations()
    if (state === 'speaking') {
      this._demoSpeakingStartedAt = Date.now()
      this._demoSpeakingSeed = `state-${state}`
    }
    this.setVoiceState(state, 'debug')
  },

  scheduleDebugStep(generation, delay, callback) {
    const timer = setTimeout(() => {
      this._demoTimers.delete(timer)
      if (generation !== this._demoGeneration || this._isDestroyed || !this._isPageVisible) return
      callback()
    }, delay)
    this._demoTimers.add(timer)
  },

  cancelTypingAnimations() {
    this._typingGeneration += 1
    this._typingTimers.forEach((timer) => clearTimeout(timer))
    this._typingTimers.clear()
  },

  cancelDebugSequence() {
    this._demoGeneration += 1
    this._demoTimers.forEach((timer) => clearTimeout(timer))
    this._demoTimers.clear()
    this._demoSpeakingStartedAt = 0
    this._demoSpeakingSeed = ''
  },

  settleAfterDebugSequence() {
    this.cancelDebugSequence()
    if (this.data.recorderActive && this.data.micDesired) {
      this.setVoiceState('recording', 'microphone')
    } else if (this.data.microphonePermission === 'denied') {
      this.setVoiceState('permission-denied', 'system')
    } else {
      this.setVoiceState(this.data.micDesired ? 'interrupted' : 'paused', 'system')
    }
  },

  toggleMicrophone() {
    // A debug preview may also display `requesting-permission`; only private
    // operation truth can make this tap a cancellation rather than a real start.
    if (this.data.recorderActive || this._recorderStartPending || this._permissionRequestPending) {
      this.disableMicrophone()
      return
    }
    if (this.data.microphonePermission === 'denied') {
      this.showPermissionRecovery()
      return
    }
    this.enableMicrophone({ automatic: false })
  },

  enableMicrophone({ automatic }) {
    const model = this.data.model
    if (!wx.getRecorderManager || !model || !model.states) {
      this.setData({
        micDesired: false,
        micAriaLabel: model.controls ? model.controls[0].retryLabel : '重新尝试开启麦克风'
      })
      this.setVoiceState('failed', 'system', {
        currentStateDescription: model.errors ? model.errors.unsupportedRecorder : ''
      })
      return
    }

    this.cancelDebugSequence()
    const generation = ++this._permissionGeneration
    this._permissionRequestPending = true
    this.setData({ micDesired: true, micAriaLabel: model.controls[0].onLabel })
    this.setVoiceState('requesting-permission', 'system')

    const handleSetting = (setting) => {
      if (!this.isPermissionRequestCurrent(generation)) return
      const authSetting = setting && setting.authSetting ? setting.authSetting : {}
      if (authSetting['scope.record'] === true) {
        this._permissionRequestPending = false
        this.setData({ microphonePermission: 'granted' })
        this.startRecorder(generation)
        return
      }
      if (authSetting['scope.record'] === false) {
        this._permissionRequestPending = false
        this.setData({
          microphonePermission: 'denied',
          micDesired: false,
          micAriaLabel: model.controls[0].retryLabel
        })
        this.setVoiceState('permission-denied', 'system')
        if (automatic) this.showPermissionRecovery()
        return
      }
      this.authorizeMicrophone(generation)
    }

    if (!wx.getSetting) {
      this.authorizeMicrophone(generation)
      return
    }
    wx.getSetting({
      success: handleSetting,
      fail: () => {
        if (this.isPermissionRequestCurrent(generation)) this.authorizeMicrophone(generation)
      }
    })
  },

  authorizeMicrophone(generation) {
    if (!wx.authorize) {
      this.startRecorder(generation)
      return
    }
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        if (!this.isPermissionRequestCurrent(generation)) return
        this._permissionRequestPending = false
        this.setData({ microphonePermission: 'granted' })
        this.startRecorder(generation)
      },
      fail: () => {
        if (!this.isPermissionRequestCurrent(generation)) return
        this._permissionRequestPending = false
        this.setData({
          microphonePermission: 'denied',
          micDesired: false,
          micAriaLabel: this.data.model.controls[0].retryLabel
        })
        this.setVoiceState('permission-denied', 'system')
        this.showPermissionRecovery()
      }
    })
  },

  isPermissionRequestCurrent(generation) {
    return generation === this._permissionGeneration &&
      this._isPageVisible &&
      !this._isDestroyed &&
      this.data.micDesired
  },

  showPermissionRecovery() {
    if (this._permissionDialogVisible || this._isDestroyed) return
    const dialog = this.data.model.permissionDialog
    if (!wx.showModal) return
    this._permissionDialogVisible = true
    wx.showModal({
      title: dialog.title,
      content: dialog.content,
      confirmText: dialog.confirmText,
      cancelText: dialog.cancelText,
      success: (result) => {
        if (result.confirm) this.openMicrophoneSettings()
      },
      complete: () => { this._permissionDialogVisible = false }
    })
  },

  openMicrophoneSettings() {
    if (!wx.openSetting) {
      wx.showToast({ title: this.data.model.errors.settingsUnavailable, icon: 'none' })
      return
    }
    const generation = ++this._permissionGeneration
    this._openingMicrophoneSettings = true
    wx.openSetting({
      success: (setting) => {
        if (generation !== this._permissionGeneration || this._isDestroyed) return
        const granted = Boolean(setting.authSetting && setting.authSetting['scope.record'])
        this.setData({
          microphonePermission: granted ? 'granted' : 'denied',
          ...(!granted ? { micAriaLabel: this.data.model.controls[0].retryLabel } : {})
        })
        if (this._isPageVisible) {
          if (granted) this.enableMicrophone({ automatic: false })
          else this.setVoiceState('permission-denied', 'system')
        } else {
          this._resumePermissionAfterSettings = true
        }
      },
      complete: () => {
        this._openingMicrophoneSettings = false
      }
    })
  },

  reconcileMicrophoneSetting() {
    if (!wx.getSetting || this._isDestroyed || !this._isPageVisible) return
    const generation = ++this._permissionGeneration
    wx.getSetting({
      success: (setting) => {
        if (
          generation !== this._permissionGeneration ||
          this._isDestroyed ||
          !this._isPageVisible ||
          this.data.micDesired ||
          this.data.recorderActive ||
          this._recorderStartPending
        ) return
        const granted = Boolean(setting.authSetting && setting.authSetting['scope.record'])
        this.setData({
          microphonePermission: granted ? 'granted' : 'denied',
          ...(!granted ? { micAriaLabel: this.data.model.controls[0].retryLabel } : {})
        })
        if (granted) this.enableMicrophone({ automatic: false })
        else this.setVoiceState('permission-denied', 'system')
      }
    })
  },

  startRecorder(generation) {
    if (!this.isPermissionRequestCurrent(generation)) return
    this._permissionRequestPending = false
    const bridge = this.attachRecorderOwner()
    if (!bridge) {
      this.setData({
        micDesired: false,
        micAriaLabel: this.data.model.controls[0].retryLabel
      })
      this.setVoiceState('failed', 'system')
      return
    }
    this._recorderStartPending = true
    this.resetAudioVisualizer()
    this.setAudioLevelMode('waiting')
    try {
      // bridge.start assigns the token before invoking RecorderManager so even
      // synchronous test doubles cannot race the page's callback guard.
      const sessionId = bridge.start(this, RECORDER_OPTIONS)
      if (sessionId == null) throw new Error('Recorder owner is not active')
    } catch (error) {
      this._recorderStartPending = false
      this._recorderSessionId = null
      this.resetAudioVisualizer()
      this.setAudioLevelMode('waiting')
      this.setData({
        micDesired: false,
        recorderActive: false,
        micAriaLabel: this.data.model.controls[0].retryLabel
      })
      this.setVoiceState('failed', 'system', {
        currentStateDescription: this.data.model.errors.startFailed
      })
    }
  },

  disableMicrophone() {
    this._permissionGeneration += 1
    this._permissionRequestPending = false
    this.cancelDebugSequence()
    // Captions are local preset content, independent of microphone truth. Turning
    // capture off must not truncate the typewriter or blank later messages.
    const sessionId = this._recorderSessionId
    this._resumeTypingAfterShow = false
    this._recorderStartPending = false
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('paused', 'system')
    if (recorderBridge) recorderBridge.stop(this, sessionId)
  },

  _handleRecorderStart(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._recorderStartPending = false
    if (!this.data.micDesired || !this._isPageVisible) {
      if (recorderBridge) recorderBridge.stop(this, sessionId)
      return
    }
    this._lastRecorderFrameAt = 0
    this.setData({
      recorderActive: true,
      microphonePermission: 'granted',
      micAriaLabel: this.data.model.controls[0].onLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('recording', 'microphone')

    if (this._frameSupportTimer) clearTimeout(this._frameSupportTimer)
    this._frameSupportTimer = setTimeout(() => {
      this._frameSupportTimer = null
      if (!this.data.recorderActive || this._pcmLevelAvailable || this._isDestroyed) return
      this.setAudioLevelMode('neutral')
    }, 1400)
  },

  _handleRecorderFrame(result, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    if (!RECORDER_FRAMES_ARE_PCM16_LE || !this.data.recorderActive) return
    const frameBuffer = result && result.frameBuffer

    // Collapse each S16LE frame to an RMS scalar immediately. The adaptive peak
    // mirrors a Web-Audio analyser's normalization role while remaining entirely
    // local to RecorderManager; no raw audio enters Page.data or survives here.
    if (!this._pcmLevelMeter || !this._pcmLevelMeter.process(frameBuffer)) return
    this._pcmLevelAvailable = true
    if (this._frameSupportTimer) clearTimeout(this._frameSupportTimer)
    this._frameSupportTimer = null
    this.setAudioLevelMode('live')
  },

  _handleRecorderStop(result, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this.cancelDebugSequence()
    if (this._frameSupportTimer) clearTimeout(this._frameSupportTimer)
    this._frameSupportTimer = null
    this._recorderSessionId = null
    this._recorderStartPending = false
    this.resetAudioVisualizer()
    this.setAudioLevelMode('waiting')
    if (!this.data.recorderActive && !this.data.micDesired) return

    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('interrupted', 'system')
  },

  _handleRecorderError(error, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this.cancelDebugSequence()
    if (this._frameSupportTimer) clearTimeout(this._frameSupportTimer)
    this._frameSupportTimer = null
    this._recorderStartPending = false
    this._recorderSessionId = null
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].retryLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('failed', 'system', {
      currentStateDescription: this.data.model.errors.startFailed
    })
  },

  _handleRecorderPause(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this.cancelDebugSequence()
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('interrupted', 'system')
    // A pause can be emitted independently of interruption callbacks. Terminate
    // the bridge session now so the next explicit microphone tap can drain a new
    // start instead of queueing forever behind a paused global recorder.
    if (recorderBridge) recorderBridge.stop(this, sessionId)
  },

  _handleRecorderResume(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this.cancelDebugSequence()
    // Some systems can resume the shared recorder automatically. Stop it again:
    // returning from an interruption must require an explicit microphone tap.
    if (recorderBridge) recorderBridge.stop(this, sessionId)
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('interrupted', 'system')
  },

  _handleRecorderInterruptionBegin(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    this._permissionGeneration += 1
    this._permissionRequestPending = false
    this.cancelDebugSequence()
    // System interruption changes recorder truth, not the centralized captions.
    // Keep any active transcript typewriter running while the page stays visible.
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('interrupted', 'system')
    if (recorderBridge) recorderBridge.stop(this, sessionId)
  },

  _handleRecorderInterruptionEnd(payload, sessionId) {
    if (sessionId !== this._recorderSessionId) return
    // Deliberately do not restart capture after calls, alarms, or other system
    // interruptions. The state text and microphone button provide recovery.
    this.resetAudioVisualizer()
    this.setData({
      recorderActive: false,
      micDesired: false,
      micAriaLabel: this.data.model.controls[0].offLabel
    })
    this.setAudioLevelMode('waiting')
    this.setVoiceState('interrupted', 'system')
  },

  initializeAuraCanvas() {
    if (!this._pageReady || !this._isPageVisible) return
    const generation = ++this._canvasInitGeneration
    const query = wx.createSelectorQuery().in(this)
    query.select('#ai-voice-aura').fields({ node: true, size: true })
    query.exec((result) => {
      if (generation !== this._canvasInitGeneration || this._isDestroyed || !this._isPageVisible) return
      const info = result && result[0]
      if (!info || !info.node || !info.width || !info.height) {
        if (this._canvasInitRetryCount < 2) {
          const retryDelay = this._canvasInitRetryCount ? 240 : 80
          this._canvasInitRetryCount += 1
          this.scheduleCanvasRemeasure(retryDelay)
        }
        return
      }

      this._canvasInitRetryCount = 0
      this.cancelAuraAnimation()
      const windowInfo = getWindowMetrics()
      const pixelRatio = Math.min(windowInfo.pixelRatio || 1, AURA_DPR_LIMIT)
      const context = info.node.getContext('2d')
      info.node.width = Math.round(info.width * pixelRatio)
      info.node.height = Math.round(info.height * pixelRatio)
      context.scale(pixelRatio, pixelRatio)
      this._canvas = {
        node: info.node,
        context,
        width: info.width,
        height: info.height,
        pixelRatio
      }
      this._animationStartedAt = Date.now()
      this._lastDrawAt = this._animationStartedAt
      this.startAuraAnimation()
    })
  },

  startAuraAnimation() {
    if (!this._canvas || !this._isPageVisible || this._auraFrameHandle != null) return
    this.requestAuraFrame()
  },

  requestAuraFrame() {
    if (!this._canvas || !this._isPageVisible || this._isDestroyed || this._auraFrameHandle != null) return
    const draw = () => {
      this._auraFrameHandle = null
      this._auraFrameType = null
      if (!this._canvas || !this._isPageVisible || this._isDestroyed) return
      this.drawAura(Date.now())
      this.requestAuraFrame()
    }
    if (this._canvas.node.requestAnimationFrame) {
      this._auraFrameType = 'raf'
      this._auraFrameHandle = this._canvas.node.requestAnimationFrame(draw)
    } else {
      this._auraFrameType = 'timer'
      this._auraFrameHandle = setTimeout(draw, 16)
    }
  },

  cancelAuraAnimation() {
    if (this._auraFrameHandle == null) return
    if (this._auraFrameType === 'raf' && this._canvas && this._canvas.node.cancelAnimationFrame) {
      this._canvas.node.cancelAnimationFrame(this._auraFrameHandle)
    } else {
      clearTimeout(this._auraFrameHandle)
    }
    this._auraFrameHandle = null
    this._auraFrameType = null
  },

  getAuraEnergy(target) {
    const input = this._auraInputLevel || 0
    // State supplies only a restrained ambient presence. The independently
    // ticked microphone scalar owns the visible response and is never re-read by RAF.
    const ambientEnergy = target.energy * (input > 0 ? 0.05 : 0.12)
    this._visualEnergy = smoothLevel(
      this._visualEnergy,
      Math.min(1, ambientEnergy + input * 0.92),
      0.58,
      0.12
    )
    return this._visualEnergy
  },

  drawAura(now) {
    const canvas = this._canvas
    if (!canvas) return
    const { context, width, height } = canvas
    const elapsed = (now - (this._animationStartedAt || now)) / 1000
    const delta = Math.min(0.05, Math.max(0.001, (now - (this._lastDrawAt || now)) / 1000))
    this._lastDrawAt = now

    const target = getStateVisualTarget(this.data.voiceState)
    Object.keys(target).forEach((key) => {
      const follow = 1 - Math.pow(0.002, delta)
      this._visualCurrent[key] += (target[key] - this._visualCurrent[key]) * follow
    })
    const energy = this.getAuraEnergy(this._visualCurrent)
    const centerX = width / 2
    const centerY = height / 2
    const baseRadius = Math.min(width, height) * 0.35 * this._visualCurrent.radius
    const motion = getAuraMotion(
      energy,
      this._visualCurrent.deformation,
      Math.sin(elapsed * (1.12 + this._visualCurrent.pace * 0.72))
    )

    context.clearRect(0, 0, width, height)
    const glow = context.createRadialGradient(centerX, centerY, baseRadius * 0.15, centerX, centerY, baseRadius * 1.45)
    glow.addColorStop(0, `rgba(225, 166, 249, ${0.12 + this._visualCurrent.glow * 0.16 + energy * 0.1})`)
    glow.addColorStop(0.52, `rgba(255, 190, 222, ${0.1 + this._visualCurrent.glow * 0.11 + energy * 0.07})`)
    glow.addColorStop(1, 'rgba(183, 224, 255, 0)')
    context.fillStyle = glow
    context.beginPath()
    context.arc(centerX, centerY, baseRadius * 1.48, 0, Math.PI * 2)
    context.fill()

    const layers = [
      { scale: 1.06, phase: 0.2, color: [177, 218, 255], alpha: 0.5, offsetX: 0.08, offsetY: -0.04 },
      { scale: 0.98, phase: 1.9, color: [229, 170, 250], alpha: 0.52, offsetX: -0.08, offsetY: 0.04 },
      { scale: 0.9, phase: 3.7, color: [255, 177, 215], alpha: 0.44, offsetX: 0.02, offsetY: 0.1 },
      { scale: 0.78, phase: 5.1, color: [219, 190, 255], alpha: 0.32, offsetX: -0.03, offsetY: -0.08 }
    ]
    context.globalCompositeOperation = 'screen'
    layers.forEach((layer, layerIndex) => {
      this.drawAuraLayer({
        context,
        centerX: centerX + baseRadius * layer.offsetX,
        centerY: centerY + baseRadius * layer.offsetY,
        radius: baseRadius * layer.scale * motion.pulse,
        elapsed,
        energy,
        motion,
        layer,
        layerIndex
      })
    })
    context.globalCompositeOperation = 'source-over'
  },

  drawAuraLayer({ context, centerX, centerY, radius, elapsed, energy, motion, layer, layerIndex }) {
    const pace = this._visualCurrent.pace * motion.paceMultiplier
    const deformation = motion.deformation
    const points = []
    for (let index = 0; index < AURA_POINT_COUNT; index += 1) {
      const angle = index / AURA_POINT_COUNT * Math.PI * 2
      const harmonic =
        Math.sin(angle * 2 + elapsed * pace * 0.8 + layer.phase) * 0.42 +
        Math.sin(angle * 3 - elapsed * pace * 1.15 + layer.phase * 1.7) * 0.33 +
        Math.sin(angle * 5 + elapsed * pace * 0.52 + layer.phase * 0.7) * 0.25
      const localRadius = radius * (1 + harmonic * deformation)
      points.push({
        x: centerX + Math.cos(angle) * localRadius,
        y: centerY + Math.sin(angle) * localRadius
      })
    }

    const first = points[0]
    const last = points[points.length - 1]
    context.beginPath()
    context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length]
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2)
    })
    context.closePath()

    const gradient = context.createRadialGradient(
      centerX - radius * 0.28,
      centerY - radius * 0.32,
      radius * 0.08,
      centerX,
      centerY,
      radius * 1.16
    )
    const [red, green, blue] = layer.color
    gradient.addColorStop(0, `rgba(${Math.min(255, red + 30)}, ${Math.min(255, green + 24)}, 255, ${layer.alpha + 0.13})`)
    gradient.addColorStop(0.56, `rgba(${red}, ${green}, ${blue}, ${layer.alpha})`)
    gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, ${Math.max(0.06, layer.alpha - 0.22)})`)
    context.fillStyle = gradient
    context.shadowColor = `rgba(${red}, ${green}, ${blue}, ${0.16 + energy * 0.14})`
    context.shadowBlur = 16 + this._visualCurrent.glow * 20 + layerIndex * 2
    context.fill()
    context.shadowBlur = 0
  },

  endConversation() {
    this._permissionGeneration += 1
    this._permissionRequestPending = false
    this._resumeTypingAfterShow = false
    this.cancelDebugSequence()
    this.cancelTypingAnimations()
    this.clearUiTimers()
    this.cancelAuraAnimation()
    this.resetAudioVisualizer()
    this.setAudioLevelMode('waiting')
    if (recorderBridge) recorderBridge.cancelOwner(this)
    this._recorderStartPending = false
    this._recorderSessionId = null
    this.setData({ recorderActive: false, micDesired: false })

    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/me/index' })
  }
})
