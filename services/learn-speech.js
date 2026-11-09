// 诊断会议「朗读」（2026-10-10 用户要求：年纪小的孩子不认字，老师说的每句话下面都能点一下读出来）。
// 课程服务用后台的语音合成（优先豆包 / 火山引擎）把一句话读成 mp3（services/identity.js loadSpeechAudio），
// 这里把 mp3 存到本地用户目录（同一句话下次直接播，不再请求），用一个全局播放器播：点另一句会停掉正在读的。
// 不受手机静音键影响（obeyMuteSwitch: false）：孩子把手机调成静音也要能听见老师。

const { loadSpeechAudio } = require('./identity')

const state = { audio: null, playingKey: '', onChange: null }

function hashText(text) {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  return hash.toString(36) + '-' + text.length.toString(36)
}

function filePathFor(text) {
  return `${wx.env.USER_DATA_PATH}/speech-${hashText(text)}.mp3`
}

function fileExists(path) {
  try {
    wx.getFileSystemManager().accessSync(path)
    return true
  } catch (error) {
    return false
  }
}

async function speechFile(text) {
  const path = filePathFor(text)
  if (fileExists(path)) return path
  const data = await loadSpeechAudio(text)
  wx.getFileSystemManager().writeFileSync(path, data)
  return path
}

function player() {
  if (state.audio) return state.audio
  if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false })
  const audio = wx.createInnerAudioContext()
  const done = () => {
    const key = state.playingKey
    state.playingKey = ''
    if (key && state.onChange) state.onChange(key, '')
  }
  audio.onEnded(done)
  audio.onStop(done)
  audio.onError(() => {
    done()
    wx.showToast({ title: '朗读播放失败，请再点一次', icon: 'none' })
  })
  state.audio = audio
  return audio
}

/** 停掉正在读的（离开页面、开始录音时调）。 */
function stopSpeech() {
  if (state.audio && state.playingKey) state.audio.stop()
}

/**
 * 点一下读、再点一下停。key 是消息编号；onChange(key, status) 告诉页面这条的状态：'loading' | 'playing' | ''。
 * 页面只能有一个 onChange（诊断室），后注册的覆盖先注册的。
 */
async function toggleSpeech(key, text, onChange) {
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

module.exports = { toggleSpeech, stopSpeech, hashText }
