// 诊断会议「朗读」（2026-10-10 用户要求：年纪小的孩子不认字，老师说的每句话下面都能点一下读出来）。
// 课程服务用后台的语音合成（优先豆包 / 火山引擎）把一句话读成 mp3（services/identity.js loadSpeechAudio），
// 这里把 mp3 存到本地用户目录（同一句话下次直接播，不再请求），用一个全局播放器播：点另一句会停掉正在读的。
// 不受手机静音键影响（obeyMuteSwitch: false）：孩子把手机调成静音也要能听见老师。
//
// 当小老师（2026-11-17）：同学们一次说好几句、每句一个声音（voice = 同学 id），用 playSequence 按顺序读，
// 每句开始 / 结束告诉页面（高亮正在说话的同学）；读不出来的那句跳过接着读，不弹提示；开始录音、离开页面时停。
// 同一句话换个声音是另一份录音：本地文件名把声音算进去（不带声音的文件名和以前一样，诊断室的缓存照旧能用）。

const { loadSpeechAudio } = require('./identity')

const state = { audio: null, playingKey: '', onChange: null, loadingKey: '', sequence: null }

// 一句读不出来时，气泡照样亮出来，停一会儿让孩子看完再接下一句（按字数，最少 0.8 秒、最多 4 秒）
const SKIP_BASE_MS = 800
const SKIP_PER_CHAR_MS = 120
const SKIP_MAX_MS = 4000

function hashText(text) {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  return hash.toString(36) + '-' + text.length.toString(36)
}

function filePathFor(text, voice = '') {
  return `${wx.env.USER_DATA_PATH}/speech-${hashText(voice ? `${voice}|${text}` : text)}.mp3`
}

function fileExists(path) {
  try {
    wx.getFileSystemManager().accessSync(path)
    return true
  } catch (error) {
    return false
  }
}

async function speechFile(text, voice = '') {
  const path = filePathFor(text, voice)
  if (fileExists(path)) return path
  const data = voice ? await loadSpeechAudio(text, voice) : await loadSpeechAudio(text)
  wx.getFileSystemManager().writeFileSync(path, data)
  return path
}

// 播放器的结束 / 停止 / 出错：按顺序读的时候交给那一串，否则是诊断室点一句读一句（原来的行为）
function handleAudioEvent(type) {
  const sequence = state.sequence
  if (sequence && sequence.playing) {
    sequence.playing = false
    if (type !== 'stop') finishLine(sequence)
    return
  }
  const key = state.playingKey
  state.playingKey = ''
  if (key && state.onChange) state.onChange(key, '')
  if (type === 'error') wx.showToast({ title: '朗读播放失败，请再点一次', icon: 'none' })
}

function player() {
  if (state.audio) return state.audio
  if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false })
  const audio = wx.createInnerAudioContext()
  audio.onEnded(() => handleAudioEvent('ended'))
  audio.onStop(() => handleAudioEvent('stop'))
  audio.onError(() => handleAudioEvent('error'))
  state.audio = audio
  return audio
}

/** 停掉按顺序读的那一串（页面的 onDone 收到 stopped = true）。 */
function stopSequence() {
  const sequence = state.sequence
  if (!sequence) return
  state.sequence = null
  sequence.cancelled = true
  if (sequence.timer) clearTimeout(sequence.timer)
  sequence.timer = null
  if (sequence.playing && state.audio) {
    sequence.playing = false
    state.audio.stop()
  }
  const { onDone } = sequence.handlers
  if (onDone) onDone({ stopped: true })
}

/** 停掉正在读的（离开页面、开始录音时调）：点一下读的那句和按顺序读的那一串都停。 */
function stopSpeech() {
  stopSequence()
  if (state.audio && state.playingKey) state.audio.stop()
}

/**
 * 点一下读、再点一下停。key 是消息编号；onChange(key, status) 告诉页面这条的状态：'loading' | 'playing' | ''。
 * 页面只能有一个 onChange（诊断室），后注册的覆盖先注册的。
 */
async function toggleSpeech(key, text, onChange) {
  stopSequence()
  state.onChange = onChange
  if (state.playingKey === key) {
    stopSpeech()
    return
  }
  stopSpeech()
  const previous = state.playingKey
  if (previous) onChange(previous, '')
  onChange(key, 'loading')
  state.loadingKey = key
  try {
    const path = await speechFile(String(text || ''))
    if (state.loadingKey !== key) return // 等的时候又点了别的
    const audio = player()
    audio.src = path
    state.playingKey = key
    onChange(key, 'playing')
    audio.play()
  } catch (error) {
    if (state.loadingKey === key) onChange(key, '')
    wx.showToast({ title: (error && error.message) || '这句话暂时读不出来，请稍后再试。', icon: 'none' })
  } finally {
    if (state.loadingKey === key) state.loadingKey = ''
  }
}

// ——— 按顺序读一串 ————————————————————————————————————————

// 第 index 句的本地文件：读到这一句时顺手把下一句先取上，读得更连贯；取不到的给空串（跳过）
function lineFile(sequence, index) {
  if (index >= sequence.items.length) return Promise.resolve('')
  if (!sequence.files[index]) {
    const item = sequence.items[index] || {}
    sequence.files[index] = speechFile(String(item.text || ''), String(item.voice || '')).catch(() => '')
  }
  return sequence.files[index]
}

function finishLine(sequence) {
  if (sequence.cancelled) return
  const { onEnd } = sequence.handlers
  if (onEnd) onEnd(sequence.index)
  playLine(sequence, sequence.index + 1)
}

async function playLine(sequence, index) {
  if (sequence.cancelled) return
  sequence.index = index
  if (index >= sequence.items.length) {
    if (state.sequence === sequence) state.sequence = null
    const { onDone } = sequence.handlers
    if (onDone) onDone({ stopped: false })
    return
  }
  const path = await lineFile(sequence, index)
  if (sequence.cancelled) return
  lineFile(sequence, index + 1)
  const { onStart } = sequence.handlers
  if (onStart) onStart(index)
  if (!path) {
    const text = String((sequence.items[index] || {}).text || '')
    const wait = Math.min(SKIP_MAX_MS, SKIP_BASE_MS + text.length * SKIP_PER_CHAR_MS)
    sequence.timer = setTimeout(() => {
      sequence.timer = null
      finishLine(sequence)
    }, wait)
    return
  }
  const audio = player()
  audio.src = path
  sequence.playing = true
  audio.play()
}

/**
 * 按顺序读一串：items = [{ text, voice }]，handlers = { onStart(index), onEnd(index), onDone({ stopped }) }。
 * 会先停掉正在读的（点一下读的那句、上一串）。返回 { stop() }：停掉这一串（onDone 收到 stopped = true）。
 */
function playSequence(items, handlers = {}) {
  stopSpeech()
  const previous = state.playingKey
  if (previous && state.onChange) state.onChange(previous, '')
  state.playingKey = ''
  state.loadingKey = ''
  const sequence = { items: Array.isArray(items) ? items : [], handlers, files: [], index: -1, playing: false, cancelled: false, timer: null }
  state.sequence = sequence
  playLine(sequence, 0)
  return {
    stop() {
      if (state.sequence === sequence) stopSequence()
    }
  }
}

module.exports = { toggleSpeech, stopSpeech, playSequence, stopSequence, hashText, filePathFor }
