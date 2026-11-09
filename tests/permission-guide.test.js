// 麦克风、摄像头、相册权限的申请与被拒引导（utils/permission-guide.js，2026-10-06），
// 以及老师课前语音在共享录音桥换掉全局录音监听后仍能收到结束回调并上传。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { ensureScope, guideOnFailure, isCancel, isPrivacyError } = require('../utils/permission-guide')
const { createRecorderSessionBridge } = require('../utils/recorder-session-bridge')

const PRIVACY_UNAGREED = { errno: 104, errMsg: 'authorize:fail privacy permission is not authorized' }
const PRIVACY_UNDECLARED = { errno: 112, errMsg: 'chooseMedia:fail api scope is not declared in the privacy agreement' }

// 模拟微信：authSetting 是当前设置；authorize 给 true 表示用户点了允许，给错误对象表示失败；
// modal 'confirm' / 'cancel' 是用户在说明弹窗里点了哪个；afterSetting 是用户在设置页里改成的样子。
function installWx({ auth = {}, authorize, modal = 'confirm', afterSetting } = {}) {
  const current = { ...auth }
  const calls = { getSetting: 0, authorize: [], modals: [], openSetting: 0, openSettingInsideModal: null, appSetting: 0, toasts: [] }
  let insideModal = false
  global.wx = {
    getSetting(options) {
      calls.getSetting += 1
      options.success({ authSetting: { ...current } })
    },
    authorize(options) {
      calls.authorize.push(options.scope)
      if (authorize === true) {
        current[options.scope] = true
        options.success({ errMsg: 'authorize:ok' })
        return
      }
      const error = authorize || { errMsg: 'authorize:fail auth deny' }
      // 微信记下拒绝；隐私协议类失败不算用户拒绝了这项权限
      if (!isPrivacyError(error)) current[options.scope] = false
      options.fail(error)
    },
    showModal(options) {
      calls.modals.push(options)
      insideModal = true
      try {
        options.success({ confirm: modal === 'confirm', cancel: modal !== 'confirm' })
      } finally {
        insideModal = false
      }
    },
    openSetting(options) {
      calls.openSetting += 1
      // openSetting 必须在用户点击的那次回调里同步调用
      calls.openSettingInsideModal = insideModal
      if (afterSetting) Object.assign(current, afterSetting)
      options.success({ authSetting: { ...current } })
    },
    openAppAuthorizeSetting() { calls.appSetting += 1 },
    showToast(options) { calls.toasts.push(options.title) }
  }
  return calls
}

test.afterEach(() => { delete global.wx })

// ---------- ensureScope ----------

test('an already granted scope passes straight through without asking again', async () => {
  const calls = installWx({ auth: { 'scope.record': true } })
  assert.equal(await ensureScope('scope.record'), true)
  assert.deepEqual(calls.authorize, [])
  assert.equal(calls.modals.length, 0)
})

test('a scope never asked before shows the system prompt once and passes when allowed', async () => {
  const calls = installWx({ auth: {}, authorize: true })
  assert.equal(await ensureScope('scope.record'), true)
  assert.deepEqual(calls.authorize, ['scope.record'])
  assert.equal(calls.modals.length, 0)
})

test('a denied scope explains why, opens settings from the tap, and passes once it is switched on', async () => {
  const calls = installWx({ auth: { 'scope.record': false }, modal: 'confirm', afterSetting: { 'scope.record': true } })
  const granted = await ensureScope('scope.record', { title: '需要麦克风权限', content: '录课前语音要用麦克风' })
  assert.equal(granted, true)
  // 拒过的不再调 authorize（微信不会再弹框）
  assert.deepEqual(calls.authorize, [])
  assert.equal(calls.modals.length, 1)
  assert.equal(calls.modals[0].title, '需要麦克风权限')
  assert.equal(calls.modals[0].confirmText, '去设置')
  assert.equal(calls.openSetting, 1)
  assert.equal(calls.openSettingInsideModal, true)
})

test('declining the system prompt right away leads to the same settings guide', async () => {
  const calls = installWx({ auth: {}, modal: 'confirm', afterSetting: { 'scope.camera': true } })
  assert.equal(await ensureScope('scope.camera'), true)
  assert.deepEqual(calls.authorize, ['scope.camera'])
  assert.equal(calls.modals[0].title, '需要摄像头权限')
  assert.equal(calls.openSetting, 1)
})

test('cancelling the guide, or leaving settings without switching it on, stops there', async () => {
  const cancelled = installWx({ auth: { 'scope.record': false }, modal: 'cancel' })
  assert.equal(await ensureScope('scope.record'), false)
  assert.equal(cancelled.openSetting, 0)

  const unchanged = installWx({ auth: { 'scope.record': false }, modal: 'confirm' })
  assert.equal(await ensureScope('scope.record'), false)
  assert.equal(unchanged.openSetting, 1)
})

test('a privacy-agreement failure is explained instead of sending the user to settings', async () => {
  const calls = installWx({ auth: {}, authorize: PRIVACY_UNAGREED })
  assert.equal(await ensureScope('scope.record'), false)
  assert.equal(calls.openSetting, 0)
  assert.equal(calls.modals.length, 1)
  assert.equal(calls.modals[0].showCancel, false)
  assert.match(calls.modals[0].title, /隐私保护指引/)
  assert.match(calls.modals[0].content, /麦克风/)
})

// ---------- guideOnFailure ----------

test('a user cancel is silent', async () => {
  const calls = installWx()
  assert.equal(isCancel({ errMsg: 'chooseMedia:fail cancel' }), true)
  assert.equal(isCancel({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }), false)
  assert.equal(await guideOnFailure({ errMsg: 'chooseMedia:fail cancel' }, { scope: 'scope.camera' }), 'cancel')
  assert.equal(calls.modals.length, 0)
  assert.equal(calls.openSetting, 0)
})

test('privacy errors (104 not agreed, 112 not declared) never open settings', async () => {
  for (const error of [PRIVACY_UNAGREED, PRIVACY_UNDECLARED, { errMsg: 'saveImageToPhotosAlbum:fail api scope is not declared in the privacy agreement' }]) {
    const calls = installWx({ auth: { 'scope.writePhotosAlbum': false } })
    assert.equal(await guideOnFailure(error, { scope: 'scope.writePhotosAlbum' }), 'privacy')
    assert.equal(calls.openSetting, 0)
    assert.equal(calls.modals.length, 1)
    assert.equal(calls.modals[0].showCancel, false)
  }
  const undeclared = installWx()
  await guideOnFailure(PRIVACY_UNDECLARED, { scope: 'scope.camera' })
  assert.match(undeclared.modals[0].content, /没有声明摄像头权限/)
})

test('a denied album save is guided to settings and reports whether it was switched on', async () => {
  const calls = installWx({ auth: { 'scope.writePhotosAlbum': false }, afterSetting: { 'scope.writePhotosAlbum': true } })
  const kind = await guideOnFailure({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }, { scope: 'scope.writePhotosAlbum' })
  assert.equal(kind, 'granted')
  assert.equal(calls.modals[0].title, '需要相册权限')
  assert.equal(calls.openSettingInsideModal, true)

  installWx({ auth: { 'scope.writePhotosAlbum': false }, modal: 'cancel' })
  assert.equal(await guideOnFailure({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' }, { scope: 'scope.writePhotosAlbum' }), 'denied')
})

test('with several scopes (video recording) it guides to the one that was denied', async () => {
  const calls = installWx({ auth: { 'scope.camera': true, 'scope.record': false }, afterSetting: { 'scope.record': true } })
  const kind = await guideOnFailure({ errMsg: 'operateCamera:fail' }, [{ scope: 'scope.camera' }, { scope: 'scope.record' }])
  assert.equal(kind, 'granted')
  assert.equal(calls.modals[0].title, '需要麦克风权限')
})

test('a permission error while the mini program is authorized points to the phone system settings', async () => {
  const calls = installWx({ auth: { 'scope.record': true } })
  assert.equal(await guideOnFailure({ errMsg: 'operateRecorder:fail auth deny' }, { scope: 'scope.record' }), 'system')
  assert.equal(calls.openSetting, 0)
  assert.equal(calls.appSetting, 1)
  assert.match(calls.modals[0].content, /设置 → 微信/)

  const explicit = installWx({ auth: { 'scope.record': true } })
  assert.equal(await guideOnFailure({ errMsg: 'operateRecorder:fail:system permission denied' }, { scope: 'scope.record' }), 'system')
  assert.equal(explicit.appSetting, 1)
})

test('a failure that is not about permissions is left to the page', async () => {
  const calls = installWx({ auth: { 'scope.record': true } })
  assert.equal(await guideOnFailure({ errMsg: 'operateRecorder:fail:audio is recording, don\'t start record again' }, { scope: 'scope.record' }), 'other')
  assert.equal(await guideOnFailure({ errMsg: 'chooseMessageFile:fail' }, {}), 'other')
  assert.equal(calls.modals.length, 0)
})

// ---------- 老师课前语音：共享录音桥换掉全局监听后仍能收到 onStop ----------

const studentDetailSource = fs.readFileSync(path.join(__dirname, '../teacher/student-detail/index.js'), 'utf8')
const permissionGuideSource = fs.readFileSync(path.join(__dirname, '../utils/permission-guide.js'), 'utf8')

// 微信 RecorderManager：全局单例，onXxx 都是覆盖式的单个监听
function createRecorderManager() {
  const listeners = {}
  let current = null
  let count = 0
  const manager = {
    start(options) {
      count += 1
      const ext = options && options.format === 'mp3' ? 'mp3' : 'pcm'
      current = { tempFilePath: `wxfile://recording-${count}.${ext}` }
      if (listeners.Start) listeners.Start()
    },
    stop() {
      if (!current) {
        if (listeners.Error) listeners.Error({ errMsg: 'operateRecorder:fail:recorder not start' })
        return
      }
      const done = current
      current = null
      if (listeners.Stop) listeners.Stop({ tempFilePath: done.tempFilePath, duration: 3000 })
    },
    // 模拟原生回调（如录音中途报错）
    emit(name, payload) {
      if (name === 'Error' || name === 'Stop') current = null
      if (listeners[name]) listeners[name](payload)
    }
  }
  for (const name of ['Start', 'Stop', 'Error', 'FrameRecorded', 'Pause', 'Resume', 'InterruptionBegin', 'InterruptionEnd']) {
    manager[`on${name}`] = (handler) => { listeners[name] = handler }
  }
  return manager
}

function loadStudentDetail(manager, { auth = { 'scope.record': true }, modalConfirm = false, afterSetting } = {}) {
  let definition
  const current = { ...auth }
  const calls = { uploaded: [], saved: [], toasts: [], modals: [], openSetting: 0 }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
    showToast: (options) => calls.toasts.push(options.title),
    showModal: (options) => {
      calls.modals.push(options)
      if (options.success) options.success({ confirm: modalConfirm, cancel: !modalConfirm })
    },
    getSetting: (options) => options.success({ authSetting: { ...current } }),
    openSetting: (options) => {
      calls.openSetting += 1
      if (afterSetting) Object.assign(current, afterSetting)
      options.success({ authSetting: { ...current } })
    },
    getRecorderManager: () => manager
  }
  vm.runInNewContext(studentDetailSource, {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    wx,
    require(name) {
      if (name.endsWith('/utils/permission-guide')) {
        const module = { exports: {} }
        vm.runInNewContext(permissionGuideSource, { wx, module, exports: module.exports })
        return module.exports
      }
      if (name.endsWith('/identity')) {
        return {
          loadTeacherStudentProfile: async () => ({ profile: { displayName: '小鹿', grade: 8 }, invites: [] }),
          loadTeacherStudentAgentCourses: async () => ({ courses: [] }),
          loadTeacherStudentAssessments: async () => [],
          uploadTeacherInviteVoice: async (filePath, durationMs) => {
            calls.uploaded.push(filePath)
            return { fileId: String(calls.uploaded.length), durationMs }
          },
          saveTeacherInviteVoice: async (studentProfileId, inviteId, fileId) => {
            calls.saved.push({ inviteId, fileId })
            return { profile: { displayName: '小鹿', grade: 8 }, invites: [] }
          }
        }
      }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      if (name.endsWith('/services/share-cover')) return { prepareShareCover() {}, shareWithCover: (page, share) => share }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) target = target[parts.shift()]
        target[parts[0]] = value
      }
      if (callback) callback()
    }
  }
  page.onLoad({ studentProfileId: '9' })
  return { page, calls, auth: current }
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
const tapVoice = (page) => page.handleVoiceTap({ currentTarget: { dataset: { inviteId: '5' } } })

test('after the live room\'s recorder bridge took over the listeners, the next pre-class voice still stops and uploads', async () => {
  const manager = createRecorderManager()
  const { page, calls } = loadStudentDetail(manager)

  await tapVoice(page)
  assert.equal(page.data.recordingInviteId, '5')
  await tapVoice(page)
  await flush()
  assert.deepEqual(calls.uploaded, ['wxfile://recording-1.mp3'])

  // 老师进直播间说了一句：共享录音桥绑定自己的监听、录完、删掉自己的临时文件，然后离开
  const discarded = []
  const bridge = createRecorderSessionBridge(manager, { discardTemporaryRecording: (filePath) => discarded.push(filePath) })
  const liveRoom = { _isPageVisible: true, _isDestroyed: false, _handleRecorderStart() {}, _handleRecorderStop() {} }
  bridge.attach(liveRoom)
  bridge.start(liveRoom, { format: 'PCM' })
  bridge.stop(liveRoom)
  bridge.cancelOwner(liveRoom)
  assert.deepEqual(discarded, ['wxfile://recording-2.pcm'])
  assert.equal(bridge.phase, 'idle')

  // 回到学生详情再录：结束回调要回到本页，而不是落进录音桥被删掉
  await tapVoice(page)
  assert.equal(page.data.recordingInviteId, '5')
  await tapVoice(page)
  await flush()
  assert.equal(page.data.recordingInviteId, '')
  assert.deepEqual(calls.uploaded, ['wxfile://recording-1.mp3', 'wxfile://recording-3.mp3'])
  assert.deepEqual(calls.saved.map((item) => item.inviteId), ['5', '5'])
  assert.deepEqual(discarded, ['wxfile://recording-2.pcm'])

  // 录音桥之后再开始录音时会重新绑定自己的监听，直播间照常
  const stops = []
  liveRoom._handleRecorderStop = (result) => stops.push(result.tempFilePath)
  bridge.attach(liveRoom)
  bridge.start(liveRoom, { format: 'PCM' })
  bridge.stop(liveRoom)
  assert.equal(bridge.phase, 'idle')
  assert.deepEqual(discarded, ['wxfile://recording-2.pcm', 'wxfile://recording-4.pcm'])
})

test('a denied microphone is guided to settings before the pre-class voice starts', async () => {
  // 拒过麦克风、在说明弹窗里点「暂不开启」：不开始录
  const declined = loadStudentDetail(createRecorderManager(), { auth: { 'scope.record': false } })
  await tapVoice(declined.page)
  assert.equal(declined.calls.modals.length, 1)
  assert.equal(declined.calls.modals[0].title, '需要麦克风权限')
  assert.equal(declined.calls.modals[0].confirmText, '去设置')
  assert.equal(declined.calls.openSetting, 0)
  assert.equal(declined.page.data.recordingInviteId, '')

  // 点「去设置」并打开麦克风：回来直接开始录
  const enabled = loadStudentDetail(createRecorderManager(), { auth: { 'scope.record': false }, modalConfirm: true, afterSetting: { 'scope.record': true } })
  await tapVoice(enabled.page)
  assert.equal(enabled.calls.openSetting, 1)
  assert.equal(enabled.page.data.recordingInviteId, '5')
})

test('a recorder error resets the pre-class voice and points a mini-program denial to settings', async () => {
  const manager = createRecorderManager()
  const { page, calls, auth } = loadStudentDetail(manager)
  await tapVoice(page)
  assert.equal(page.data.recordingInviteId, '5')
  // 录音中途报错（不是权限问题）：界面退出「录音中」，只提示重录
  manager.emit('Error', { errMsg: 'operateRecorder:fail:interrupted' })
  await flush()
  assert.equal(page.data.recordingInviteId, '')
  assert.deepEqual(calls.toasts, ['录音失败，请重试'])
  assert.equal(calls.modals.length, 0)

  // 录音时报权限错误、设置里麦克风是关着的：弹窗引导去设置，不再只提示一句
  await tapVoice(page)
  auth['scope.record'] = false
  manager.emit('Error', { errMsg: 'operateRecorder:fail auth deny' })
  await flush()
  assert.equal(page.data.recordingInviteId, '')
  assert.equal(calls.modals.length, 1)
  assert.equal(calls.modals[0].confirmText, '去设置')
  assert.deepEqual(calls.toasts, ['录音失败，请重试'])
})

// ---------- 奖励结算页：选发票被拒 / 取消 / 失败 ----------

const withdrawPath = require.resolve('../agent/withdraw/index.js')

function loadWithdraw({ tapIndex, failure, auth = {} }) {
  const stubbed = []
  const stub = (file, exports) => {
    const resolved = require.resolve(file)
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }
    stubbed.push(resolved)
  }
  delete require.cache[withdrawPath]
  stub('../services/identity.js', { loadCurrentServiceContacts: async () => ({ status: 'ready', contacts: [] }) })
  stub('../services/settlement-service.js', { createSettlementKey: (prefix) => `${prefix}-key` })
  stub('../services/ui-assets.js', { attachUiAssets() {} })
  let definition = null
  global.Page = (page) => { definition = page }
  const calls = installWx({ auth })
  const picked = []
  Object.assign(global.wx, {
    showActionSheet: (options) => options.success({ tapIndex }),
    chooseMedia: (options) => { picked.push(['media', options.sourceType[0]]); options.fail(failure) },
    chooseMessageFile: (options) => { picked.push(['file']); options.fail(failure) }
  })
  require(withdrawPath)
  delete global.Page
  for (const resolved of stubbed) delete require.cache[resolved]
  const page = { data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls, picked }
}

test('invoice picking: a denied camera is guided to settings, a cancel is silent, other failures say so', async () => {
  const camera = loadWithdraw({ tapIndex: 2, failure: { errMsg: 'chooseMedia:fail auth deny' }, auth: { 'scope.camera': false } })
  camera.page.handleAddInvoice()
  await flush()
  assert.deepEqual(camera.picked, [['media', 'camera']])
  assert.equal(camera.calls.modals[0].title, '需要摄像头权限')
  assert.deepEqual(camera.calls.toasts, [])

  const cancelled = loadWithdraw({ tapIndex: 1, failure: { errMsg: 'chooseMedia:fail cancel' } })
  cancelled.page.handleAddInvoice()
  await flush()
  assert.equal(cancelled.calls.modals.length, 0)
  assert.deepEqual(cancelled.calls.toasts, [])

  const privacy = loadWithdraw({ tapIndex: 1, failure: PRIVACY_UNDECLARED })
  privacy.page.handleAddInvoice()
  await flush()
  assert.equal(privacy.calls.modals.length, 1)
  assert.equal(privacy.calls.openSetting, 0)
  assert.match(privacy.calls.modals[0].content, /相册/)

  const file = loadWithdraw({ tapIndex: 0, failure: { errMsg: 'chooseMessageFile:fail' } })
  file.page.handleAddInvoice()
  await flush()
  assert.deepEqual(file.picked, [['file']])
  assert.deepEqual(file.calls.toasts, ['没能打开聊天文件，请重试'])
})
