const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/agent-chat/index.js')
const bridgePath = require.resolve('../utils/recorder-session-bridge.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 与微信一致：RecorderManager 全局单例，onXxx 为覆盖式单监听，回调异步触发。
function createRecorderManager() {
  const manager = { handlers: {}, starts: 0, stops: 0, recording: false }
  for (const name of ['Start', 'Stop', 'Error', 'FrameRecorded', 'Pause', 'Resume', 'InterruptionBegin', 'InterruptionEnd']) {
    manager['on' + name] = (callback) => { manager.handlers[name] = callback }
  }
  manager.emit = (name, payload) => { if (manager.handlers[name]) manager.handlers[name](payload) }
  manager.start = () => {
    manager.starts += 1
    manager.recording = true
    setTimeout(() => manager.emit('Start'), 5)
    manager.frameTimer = setInterval(() => {
      if (manager.recording) manager.emit('FrameRecorded', { frameBuffer: new Uint8Array(2048).fill(1).buffer })
    }, 10)
  }
  manager.stop = () => {
    manager.stops += 1
    manager.recording = false
    clearInterval(manager.frameTimer)
    setTimeout(() => manager.emit('Stop', { tempFilePath: 'wxfile://tmp.pcm' }), 5)
  }
  return manager
}

function loadPage(manager, overrides = {}) {
  delete require.cache[pagePath]
  let definition = null
  const calls = { uploads: [], toasts: [] }
  global.Page = (page) => { definition = page }
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getWindowInfo() {
      return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }
    },
    getMenuButtonBoundingClientRect() {
      return { left: 276, top: 26, width: 87, height: 32 }
    },
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
    showToast(options) { calls.toasts.push(options.title) },
    showLoading() {},
    hideLoading() {},
    request(options) {
      if (!/\/api\/asr\/transcribe$/.test(options.url)) return
      calls.uploads.push(options)
      setTimeout(() => {
        if (overrides.asrFail) options.fail({ errMsg: overrides.asrFail })
        else options.success({ statusCode: 200, data: JSON.stringify({ success: true, text: overrides.transcript || '分数怎么通分' }) })
      }, 5)
    },
    nextTick(callback) { callback() },
    hideKeyboard() {},
    getRecorderManager: () => manager,
    getSetting(options) { options.success({ authSetting: { 'scope.record': true } }) },
    getFileSystemManager() {
      return { unlinkSync() {}, unlink() {} }
    },
    uploadFile() { throw new Error('语音转写不应依赖 uploadFile 合法域名') },
    createSelectorQuery() {
      const query = { in: () => query, select: () => query, boundingClientRect: () => query, scrollOffset: () => query, fields: () => query, exec: (cb) => cb && cb([]) }
      return query
    }
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback() }
  return { page, calls }
}

async function holdToSpeak(page, ms = 120) {
  const event = { touches: [{ pageY: 600 }], currentTarget: { dataset: { voiceTrigger: 'true' } } }
  page.handleComposerTouchStart(event)
  await sleep(360)
  await sleep(ms)
  page.handleComposerTouchEnd()
  await sleep(60)
}

test('voice input still works while the home entry prompt is being answered, and keeps the transcript', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadPage(manager)
  // 首页带问题进入：页面会立即发送，AI 回复长时间进行中
  page.ensureAgentAccess = () => new Promise(() => {})
  page.onLoad({ prompt: encodeURIComponent('我想学会分数加减') })
  page.onShow()
  await sleep(450)
  assert.equal(page.data.isSending, true)

  page.handleVoiceButtonTap()
  assert.equal(page.data.voiceMode, true, '回复中也应能切换到语音模式')

  await holdToSpeak(page)
  assert.equal(manager.starts, 1, '回复中按住说话应启动录音')
  assert.equal(calls.uploads.length, 1, '松手后应上传录音转文字')
  assert.match(calls.uploads[0].url, /\/api\/asr\/transcribe$/)

  // 回复尚未结束，识别结果不能被丢弃：切回键盘并填入输入框，等待回复结束后发送
  assert.equal(page.data.voiceMode, false)
  assert.equal(page.data.inputValue, '分数怎么通分')
  assert.equal(page.data.canSend, false)
  assert.equal(page.data.messages.filter((message) => message.role === 'user').length, 1)
  page.onUnload()
})

test('voice transcript is sent directly once no reply is in progress', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadPage(manager, { transcript: '帮我出三道练习题' })
  page.onLoad({})
  page.onShow()
  let sent = ''
  page.sendMessage = (text) => { sent = text }
  page.handleVoiceButtonTap()
  await holdToSpeak(page)
  assert.equal(calls.uploads.length, 1)
  assert.equal(sent, '帮我出三道练习题')
  page.onUnload()
})

test('voice is posted with wx.request as multipart form data holding a valid WAV', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadPage(manager)
  page.onLoad({})
  page.onShow()
  page.sendMessage = () => {}
  page.handleVoiceButtonTap()
  await holdToSpeak(page)
  assert.equal(calls.uploads.length, 1)
  const request = calls.uploads[0]
  assert.equal(request.method, 'POST')
  const boundary = /^multipart\/form-data; boundary=(.+)$/.exec(request.header['content-type'])[1]
  const body = new Uint8Array(request.data)
  const raw = Buffer.from(body).toString('latin1')
  const headerEnd = raw.indexOf('\r\n\r\n') + 4
  assert.ok(raw.startsWith(`--${boundary}\r\n`))
  assert.match(raw.slice(0, headerEnd), /name="audio"; filename="voice\.wav"\r\nContent-Type: audio\/wav/)
  const closing = `\r\n--${boundary}--\r\n`
  assert.ok(raw.endsWith(closing))
  const wav = body.slice(headerEnd, body.length - closing.length)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const text = (offset) => String.fromCharCode(...wav.slice(offset, offset + 4))
  assert.equal(text(0), 'RIFF')
  assert.equal(view.getUint32(4, true), wav.byteLength - 8)
  assert.equal(text(8), 'WAVE')
  assert.equal(view.getUint32(16, true), 16)
  assert.equal(view.getUint32(40, true), wav.byteLength - 44)
  page.onUnload()
})

test('voice upload failures explain a missing domain instead of a generic message', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadPage(manager, { asrFail: 'request:fail url not in domain list' })
  page.onLoad({})
  page.onShow()
  page.sendMessage = () => {}
  page.handleVoiceButtonTap()
  await holdToSpeak(page)
  assert.equal(calls.uploads.length, 1)
  assert.ok(calls.toasts.includes('语音服务域名未配置，请用文字输入'))
  assert.equal(page._asrBusy, false)
  page.onUnload()
})

test('agent chat recording keeps working after another page overwrites the shared recorder callbacks', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadPage(manager)
  page.onLoad({})
  page.onShow()
  page.sendMessage = () => {}
  page.handleVoiceButtonTap()

  for (let round = 1; round <= 3; round += 1) {
    // 例如费曼验收录音页：直接在全局 RecorderManager 上注册自己的 onStop/onError
    manager.onStop(() => {})
    manager.onError(() => {})
    await holdToSpeak(page)
    assert.equal(manager.starts, round, `第 ${round} 次应能启动录音`)
    assert.equal(calls.uploads.length, round, `第 ${round} 次应能上传转写`)
  }
  page.onUnload()
})

function freshBridgeModule() {
  delete require.cache[bridgePath]
  return require(bridgePath)
}

function createOwner() {
  return { _isPageVisible: true, _isDestroyed: false, _recorderSessionId: null, started: 0, stopped: 0,
    _handleRecorderStart() { this.started += 1 }, _handleRecorderStop() { this.stopped += 1 } }
}

test('recorder bridge does not stop a recording another page started directly', async () => {
  const { createRecorderSessionBridge } = freshBridgeModule()
  const manager = createRecorderManager()
  const bridge = createRecorderSessionBridge(manager)
  const owner = createOwner()
  bridge.attach(owner)
  bridge.start(owner, {})
  await sleep(20)
  bridge.stop(owner, owner._recorderSessionId)
  await sleep(20)
  assert.equal(bridge.phase, 'idle')

  // 其他页面只覆盖 onStop/onError 后直接开始录音；bridge 残留的 onStart 不应把它停掉
  const foreignStops = []
  manager.onStop((result) => foreignStops.push(result))
  manager.onError(() => {})
  manager.start({})
  await sleep(20)
  assert.equal(manager.stops, 1, '其他页面的录音不应被停止')
  assert.equal(manager.recording, true)
  manager.stop()
  await sleep(20)
  assert.equal(foreignStops.length, 1)
  assert.equal(bridge.phase, 'idle', 'bridge 不应被卡在 stopping')

  bridge.start(owner, {})
  await sleep(20)
  assert.equal(owner.started, 2, '之后 bridge 仍可正常录音')
  bridge.stop(owner, owner._recorderSessionId)
  await sleep(20)
  assert.equal(bridge.phase, 'idle')
})

test('pages share one recorder bridge per RecorderManager', () => {
  const { getSharedRecorderBridge } = freshBridgeModule()
  const manager = createRecorderManager()
  global.wx = { getRecorderManager: () => manager }
  const first = getSharedRecorderBridge()
  assert.ok(first)
  assert.equal(getSharedRecorderBridge(), first)
  const otherManager = createRecorderManager()
  global.wx = { getRecorderManager: () => otherManager }
  assert.notEqual(getSharedRecorderBridge(), first)
  global.wx = {}
  assert.equal(getSharedRecorderBridge(), null)
})
