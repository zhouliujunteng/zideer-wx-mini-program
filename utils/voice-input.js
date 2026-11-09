// 按住说话：录音、电平条、PCM → WAV 上传课程服务转成文字。
//
// 交互与诊断室（pages/diagnosis-room）一致：按住「按住说话」开始录，上移取消，松手转文字。
// 诊断室页面里目前还留着自己的一份同样的实现（电平算法、WAV 拼装、转写请求），
// 老师端「直播间记录」（teacher/live-room）用这一份；改其中一边时对照另一边。

const {
  analyzePcm16LeFrame,
  smoothLevel,
  updateMicrophoneEnvelope,
  microphoneTargetLevel
} = require('./ai-voice-visualizer')
const { getSharedRecorderBridge } = require('./recorder-session-bridge')
const { COURSE_PORTAL_ORIGIN } = require('../config/index')

const ASR_TRANSCRIBE_URL = COURSE_PORTAL_ORIGIN + '/api/asr/transcribe'
// 按住这么久才开始录：手指只是碰一下不算
const VOICE_LONG_PRESS_DELAY = 320
const AUDIO_VISUALIZER_INTERVAL = 50
const MICROPHONE_FRAME_TIMEOUT = 800
// 不到 0.1 秒（16kHz × 2 字节）当成没说话；最多收约 60 秒
const VOICE_MIN_BYTES = 3200
const VOICE_MAX_BYTES = 1920000
const VOICE_SAMPLE_RATE = 16000
const RECORDER_OPTIONS = Object.freeze({
  duration: 600000,
  sampleRate: VOICE_SAMPLE_RATE,
  numberOfChannels: 1,
  format: 'PCM',
  frameSize: 2
})
const VOICE_BAR_COUNT = 42
const VOICE_BAR_MIN_HEIGHT = 4
const VOICE_BAR_MAX_HEIGHT = 54
// 自动增益后的响度在这以下当成房间底噪（安静房间约 -60 dBFS 时为 0，-50 dBFS 时只微微动）
const VOICE_LOUDNESS_GATE = 0.2

function clampVoiceValue(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

// 高度是 rpx 设计值，模板里写进 --bar-height，由 wxss 换算（大屏下才跟着固定比例）
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

// 开发者工具没有 PCM 帧回调：用一段合成的起伏让动效照样动；真机一律以实测电平为准
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

/**
 * 一帧的电平条目标高度（[0, 1]）：响度 × 位置轮廓 × 频谱起伏。
 * 42 根条 = 21 段频谱左右镜像，低频（人声最强处）在中间往两边走高频；
 * 轮廓让中间高、两边低，说话时整排像一道声波，频谱让每根条随每个字的音色各自起伏。
 */
function layoutVoiceBars(bands, loudness) {
  const half = VOICE_BAR_COUNT / 2
  return Array.from({ length: VOICE_BAR_COUNT }, (_, index) => {
    const fromCenter = index < half ? half - 1 - index : index - half
    const contour = 0.32 + 0.68 * Math.cos(fromCenter / half * Math.PI / 2)
    const band = clampVoiceValue(bands && bands[fromCenter])
    return loudness * contour * (0.6 + 0.4 * Math.sqrt(band))
  })
}

// 自动增益后的响度：低于门限当成房间底噪，条趴着不动；以上再拉开到 [0, 1]
function voiceLoudness(target) {
  return Math.pow(clampVoiceValue((target - VOICE_LOUDNESS_GATE) / (1 - VOICE_LOUDNESS_GATE)), 0.8)
}

// onLevel：每处理一帧回调一次 { level, peak, lastFrameAt, barLevels }（诊断室用它记录麦克风状态）
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
      const analysis = analyzePcm16LeFrame(frameBuffer, { bandCount: VOICE_BAR_COUNT / 2, sampleRate: VOICE_SAMPLE_RATE })
      if (!analysis.valid) return false
      const envelope = updateMicrophoneEnvelope(level, peak, analysis.rms)
      level = envelope.level
      peak = envelope.peak
      lastFrameAt = now
      // 条的高度不用 envelope.level：它回落很慢（为整体音量设计），说完一个字条还挂着。
      // 这里取本帧的目标响度，再用比它快的平滑，条才会跟着一个个字起伏。
      const targetBars = layoutVoiceBars(analysis.bands, voiceLoudness(microphoneTargetLevel(analysis.rms, peak)))
      barLevels = Array.from({ length: VOICE_BAR_COUNT }, (_, index) => smoothLevel(
        barLevels[index] || 0,
        targetBars[index] || 0,
        0.62,
        0.42
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

function voiceByteLength(chunks) {
  return (chunks || []).reduce((sum, chunk) => sum + (chunk && chunk.byteLength || 0), 0)
}

function discardTemporaryRecording(filePath) {
  if (!filePath || !wx.getFileSystemManager) return
  try {
    wx.getFileSystemManager().unlink({ filePath, fail() {} })
  } catch (error) {
    // 临时录音尽力清理，路径从不保留
  }
}

// 微信的 RecorderManager 是全局单例：与诊断室共用同一个 bridge，两页的录音不会互相串
function getRecorderBridge() {
  return getSharedRecorderBridge({ discardTemporaryRecording })
}

/**
 * 录好的 PCM 帧上传课程服务转成文字。走 wx.request（与课程服务同一个 request 合法域名），
 * 不依赖单独配置的 uploadFile 域名，也不写临时文件。
 * 永不 reject：成功给 { text }，失败给 { text: '', warning }（warning 可直接 toast）。
 */
function transcribeVoiceChunks(chunks, { logTag = 'voice-input' } = {}) {
  return new Promise((resolve) => {
    const boundary = `----zhiluVoice${Date.now().toString(16)}`
    const body = buildVoiceMultipartBody(chunks || [], boundary)
    wx.request({
      url: ASR_TRANSCRIBE_URL,
      method: 'POST',
      header: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      data: body.buffer,
      dataType: 'text',
      responseType: 'text',
      timeout: 45000,
      success: (res) => {
        let payload = null
        try { payload = typeof res.data === 'string' ? JSON.parse(res.data) : res.data } catch (error) { payload = null }
        const text = payload && payload.success && (String(payload.text || '').trim() || String(payload.data && payload.data.text || '').trim()) || ''
        if (res.statusCode === 200 && text) return resolve({ text, warning: '' })
        if (res.statusCode === 200) return resolve({ text: '', warning: '没听清，请再试一次' })
        console.warn(`[${logTag}] 语音识别失败:`, res.statusCode, payload && payload.code)
        resolve({ text: '', warning: res.statusCode === 429 ? '识别太频繁，请稍后再试' : '语音识别暂不可用，请用文字输入' })
      },
      fail: (error) => {
        const errMsg = String(error && error.errMsg || '')
        console.warn(`[${logTag}] 语音上传失败:`, errMsg)
        resolve({
          text: '',
          warning: /domain|合法域名/i.test(errMsg)
            ? '语音服务域名未配置，请用文字输入'
            : /timeout|超时/i.test(errMsg) ? '识别超时，请重试' : '网络异常，语音识别失败'
        })
      }
    })
  })
}

module.exports = {
  ASR_TRANSCRIBE_URL,
  VOICE_LONG_PRESS_DELAY,
  AUDIO_VISUALIZER_INTERVAL,
  VOICE_MIN_BYTES,
  VOICE_MAX_BYTES,
  RECORDER_OPTIONS,
  VOICE_BARS,
  createVoiceBars,
  createFallbackVoiceBars,
  createPcmLevelMeter,
  buildVoiceMultipartBody,
  voiceByteLength,
  getRecorderBridge,
  transcribeVoiceChunks
}
