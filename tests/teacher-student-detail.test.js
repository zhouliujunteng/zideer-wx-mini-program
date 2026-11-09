const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageSource = fs.readFileSync(path.join(__dirname, '../teacher/student-detail/index.js'), 'utf8')
const workspaceTemplate = fs.readFileSync(path.join(__dirname, '../teacher/workspace/index.wxml'), 'utf8')
const permissionGuideSource = fs.readFileSync(path.join(__dirname, '../utils/permission-guide.js'), 'utf8')

// 权限引导模块要和页面用同一个 wx：放进同一份模拟环境里执行
function loadPermissionGuide(wx) {
  const module = { exports: {} }
  vm.runInNewContext(permissionGuideSource, { wx, module, exports: module.exports })
  return module.exports
}

const DAY = 24 * 60 * 60 * 1000
function futureParts(offsetMs) {
  const future = new Date(Date.now() + offsetMs)
  return {
    date: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`,
    time: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`
  }
}

const PROFILE = {
  studentProfileId: '9',
  nickname: '小鹿',
  displayName: '小鹿',
  grade: 8,
  schoolStage: '初中',
  semester: '上学期',
  schoolName: '实验中学',
  textbookVersion: '人教版',
  regionDetail: '浙江省杭州市',
  profileCompleted: true,
  updatedAt: '2026-09-20T00:00:00Z'
}

function loadPage({ profile = PROFILE, invites = [], createResult, createError, detailsError, loadError, cancelResult, cancelError, confirmCancel = true } = {}) {
  let definition
  const state = { invites }
  const calls = { details: [], created: [], canceled: [], uploaded: [], voiceSaved: [], toasts: [], modals: [], navigations: [] }
  const recorder = { handlers: {} }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
    showToast: (options) => calls.toasts.push(options.title),
    showModal: (options) => {
      calls.modals.push(options.content)
      if (options.success) options.success({ confirm: confirmCancel, cancel: !confirmCancel })
    },
    navigateTo: (options) => calls.navigations.push(options.url),
    stopPullDownRefresh() {},
    // 麦克风已授权：课前语音直接开始录
    getSetting: (options) => options.success({ authSetting: { 'scope.record': true } }),
    getRecorderManager: () => ({
      start() { recorder.started = true },
      stop() { if (recorder.handlers.stop) recorder.handlers.stop({ tempFilePath: 'wxfile://voice.mp3', duration: 12000 }) },
      onStart(handler) { recorder.handlers.start = handler },
      onStop(handler) { recorder.handlers.stop = handler },
      onError(handler) { recorder.handlers.error = handler }
    })
  }
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    wx,
    require(name) {
      if (name.endsWith('/utils/permission-guide')) return loadPermissionGuide(wx)
      if (name.endsWith('/identity')) {
        return {
          loadTeacherStudentProfile: async () => {
            if (loadError) throw new Error(loadError)
            return { profile, invites: state.invites, serverNow: '' }
          },
          saveTeacherInviteDetails: async (studentProfileId, inviteId, meetingMinutes, meetingNote) => {
            calls.details.push({ studentProfileId, inviteId, meetingMinutes, meetingNote })
            if (detailsError) throw new Error(detailsError)
            state.invites = state.invites.map((item) => item.inviteId === inviteId ? { ...item, meetingMinutes, meetingNote } : item)
            return { profile, invites: state.invites }
          },
          loadTeacherStudentAgentCourses: async () => ({ courses: [] }),
          loadTeacherStudentAssessments: async () => [],
          uploadTeacherInviteVoice: async (filePath, durationMs) => {
            calls.uploaded.push({ filePath, durationMs })
            return { fileId: '77', sizeBytes: 1000, durationMs }
          },
          saveTeacherInviteVoice: async (studentProfileId, inviteId, fileId, durationMs) => {
            calls.voiceSaved.push({ studentProfileId, inviteId, fileId, durationMs })
            return { profile, invites: state.invites.map((item) => ({ ...item, hasVoice: true, voiceDurationMs: durationMs })) }
          },
          cancelTeacherAgentInvite: async (studentProfileId, inviteId) => {
            calls.canceled.push({ studentProfileId, inviteId })
            if (cancelError) throw new Error(cancelError)
            return cancelResult || { profile, invites: invites.map((item) => ({ ...item, status: 'canceled', effective: false })) }
          },
          createTeacherAgentInvite: async (input) => {
            calls.created.push(input)
            if (createError) throw Object.assign(new Error(createError), { code: 'x' })
            // 新预约让旧的全部作废；页面会重新拉一次，这里同步 mock 的列表
            state.invites = [{ inviteId: '7', subject: input.subjectLabel, scheduledOnlineAt: input.scheduledOnlineAt, status: 'scheduled', token: 'tknew', hasSession: false, isLatest: true, effective: true, supersededBy: '', hasVoice: false, voiceDurationMs: 0 }]
            return createResult || {
              inviteId: '7',
              token: 'tknew',
              subject: input.subjectLabel,
              scheduledOnlineAt: input.scheduledOnlineAt,
              status: 'scheduled',
              studentProfileId: input.studentProfileId,
              studentName: '小鹿',
              teacherName: '王老师',
              createdAt: ''
            }
          }
        }
      }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/daily-learning-view')) return require('../utils/daily-learning-view')
      if (name.endsWith('/services/share-cover')) return require('../services/share-cover')
      throw new Error(`Unexpected import ${name}`)
    }
  })

  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        if (!key.includes('.')) { this.data[key] = value; continue }
        const parts = key.split('.')
        let target = this.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts[parts.length - 1]] = value
      }
      if (callback) callback()
    }
  }
  return { page, calls }
}

const INVITE = { inviteId: '5', subject: '数学', scheduledOnlineAt: new Date(Date.now() + 3 * DAY).toISOString(), status: 'scheduled', token: 'tk5', hasSession: false, isLatest: true, effective: true, supersededBy: '', hasVoice: true, voiceDurationMs: 42000, meetingMinutes: 45, meetingNote: '分数应用题' }

test('the profile tab is read-only and shows the six fields from the real profile', async () => {
  const { page } = loadPage()
  page.onLoad({ studentProfileId: '9', publicId: '121400', name: '%E5%B0%8F%E9%B9%BF' })
  assert.equal(page.data.profile.displayName, '小鹿')
  await page.loadPage()
  assert.deepEqual([...page.data.profileRows.map((row) => `${row.label}:${row.value}`)], [
    '学生称呼:小鹿', '学段:初中', '年级:初二 · 上学期', '教材版本:人教版', '学校:实验中学', '所在地区:浙江省杭州市'
  ])
  assert.equal(page.data.headerMeta, '初二 · ID 121400')
  // 老师不能再改档案：页面上没有保存入口
  assert.equal(typeof page.handleSave, 'undefined')
  const template = fs.readFileSync(path.join(__dirname, '../teacher/student-detail/index.wxml'), 'utf8')
  assert.match(template, /档案信息由学生本人维护，老师仅支持查看内容/)
  assert.doesNotMatch(template, /<input[^>]*data-field="(nickname|schoolName|regionDetail)"/)
})

test('tabs switch between profile, appointment and learning', async () => {
  const { page } = loadPage()
  page.onLoad({ studentProfileId: '9' })
  assert.equal(page.data.activeTab, 'profile')
  page.handleTabChange({ currentTarget: { dataset: { id: 'learning' } } })
  assert.equal(page.data.activeTab, 'learning')
  assert.equal(page.data.tabMotion, 'tab-content-enter-from-right')
  page.handleTabChange({ currentTarget: { dataset: { id: 'appointment' } } })
  assert.equal(page.data.tabMotion, 'tab-content-enter-from-left')
  page.handleTabChange({ currentTarget: { dataset: { id: 'nope' } } })
  assert.equal(page.data.activeTab, 'appointment')
})

test('opening from the service-account meeting-done notice lands on learning with a group reminder', () => {
  const { page } = loadPage()
  page.onLoad({ studentProfileId: '9', tab: 'learning', from: 'meeting_done' })
  assert.equal(page.data.activeTab, 'learning')
  assert.equal(page.data.meetingDoneHint, true)
  page.dismissMeetingDoneHint()
  assert.equal(page.data.meetingDoneHint, false)
  const template = fs.readFileSync(path.join(__dirname, '../teacher/student-detail/index.wxml'), 'utf8')
  assert.match(template, /wx:if="\{\{meetingDoneHint\}\}"[\s\S]*服务群里和学生互动/)

  const plain = loadPage().page
  plain.onLoad({ studentProfileId: '9', tab: 'appointment' })
  assert.equal(plain.data.activeTab, 'appointment')
  assert.equal(plain.data.meetingDoneHint, false)
  const unknown = loadPage().page
  unknown.onLoad({ studentProfileId: '9', tab: 'nope' })
  assert.equal(unknown.data.activeTab, 'profile')
})

test('an invite needs a future time', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  page.openSheet()
  page.handleFormPicker({ currentTarget: { dataset: { field: 'date' } }, detail: { value: '2020-01-01' } })
  page.handleFormPicker({ currentTarget: { dataset: { field: 'time' } }, detail: { value: '09:00' } })
  await page.handleCreateInvite()
  assert.equal(calls.created.length, 0)
  assert.match(page.data.formError, /晚于现在/)
  assert.equal(page.data.sheetVisible, true)
})

test('meeting length must be between 5 minutes and 8 hours', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  const when = futureParts(2 * DAY)
  page.handleFormPicker({ currentTarget: { dataset: { field: 'date' } }, detail: { value: when.date } })
  page.handleDurationInput({ detail: { value: '3' } })
  await page.handleCreateInvite()
  assert.match(page.data.formError, /5 分钟到 8 小时/)
  page.handleDurationInput({ detail: { value: '9' } })
  page.handleFormPicker({ currentTarget: { dataset: { field: 'durationUnit' } }, detail: { value: 1 } })
  await page.handleCreateInvite()
  assert.match(page.data.formError, /5 分钟到 8 小时/)
  assert.equal(calls.created.length, 0)
})

test('creating an invite sends subject and time, saves length and note, then lists it', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  page.openSheet()
  const when = futureParts(2 * DAY)
  page.handleFormPicker({ currentTarget: { dataset: { field: 'subject' } }, detail: { value: 2 } })
  page.handleFormPicker({ currentTarget: { dataset: { field: 'date' } }, detail: { value: when.date } })
  page.handleFormPicker({ currentTarget: { dataset: { field: 'time' } }, detail: { value: '19:30' } })
  page.handleDurationInput({ detail: { value: '1' } })
  page.handleFormPicker({ currentTarget: { dataset: { field: 'durationUnit' } }, detail: { value: 1 } })
  page.handleNoteInput({ detail: { value: '分数应用题' } })
  await page.handleCreateInvite()
  assert.equal(calls.created.length, 1)
  assert.equal(calls.created[0].subjectLabel, '英语')
  const sentAt = new Date(calls.created[0].scheduledOnlineAt)
  assert.equal(sentAt.getHours(), 19)
  assert.equal(sentAt.getMinutes(), 30)
  assert.deepEqual({ ...calls.details[0] }, { studentProfileId: '9', inviteId: '7', meetingMinutes: 60, meetingNote: '分数应用题' })
  const record = page.data.invites[0]
  assert.equal(record.title, '分数应用题 · 英语')
  assert.equal(record.dateLabel, '后天')
  assert.equal(record.timeLabel, '19:30')
  assert.match(record.subtitle, /^1小时 · /)
  // 没录课前语音之前不能分享
  assert.equal(record.canShare, false)
  assert.equal(record.shareHint, '录好课前语音后可分享')
  assert.equal(record.showVoice, true)
  assert.match(calls.modals[0], /先在预约记录里录一段课前语音/)
  // 表单收起并重置
  assert.equal(page.data.sheetClosing, true)
  assert.equal(page.data.form.note, '')
})

test('a failed length/note save keeps the created invite and says so', async () => {
  const { page, calls } = loadPage({ detailsError: '暂不支持这个操作。' })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  const when = futureParts(2 * DAY)
  page.handleFormPicker({ currentTarget: { dataset: { field: 'date' } }, detail: { value: when.date } })
  await page.handleCreateInvite()
  assert.equal(calls.created.length, 1)
  assert.match(calls.modals[0], /会议时长和说明没有保存上，不影响预约本身/)
})

test('a rejected invite shows the backend reason in the form', async () => {
  const { page } = loadPage({ createError: '这名学生已不在你的名下。' })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  const when = futureParts(2 * DAY)
  page.handleFormPicker({ currentTarget: { dataset: { field: 'date' } }, detail: { value: when.date } })
  await page.handleCreateInvite()
  assert.match(page.data.formError, /不在你的名下/)
  assert.equal(page.data.creating, false)
})

test('sharing an invite leads with the student name, grade, subject and start time', async () => {
  const { page } = loadPage()
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  const share = page.onShareAppMessage({ target: { dataset: { token: 'tk1', subject: '数学', scheduledAt: '2026-09-22T19:30:00+08:00' } } })
  assert.equal(share.path, '/learning/agent-invite/index?token=tk1')
  assert.equal(share.title, '【小鹿】初二数学专属诊断会议，19:30开始')
  const fallback = page.onShareAppMessage({})
  assert.equal(fallback.path, '/pages/home/index')
})

test('record cards follow the design: note · subject, relative day, length · state', async () => {
  const { page } = loadPage({ invites: [
    INVITE,
    { ...INVITE, inviteId: '4', isLatest: false, effective: false, supersededBy: '5', meetingNote: '', meetingMinutes: 0, hasVoice: false }
  ] })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  const [latest, replaced] = page.data.invites
  assert.equal(latest.title, '分数应用题 · 数学')
  assert.equal(latest.subtitle, '45分钟 · 生效中 · 待上线')
  assert.equal(latest.canShare, true)
  assert.equal(latest.voiceText, '课前语音 42 秒')
  assert.equal(replaced.title, '数学专属诊断会议')
  assert.equal(replaced.subtitle, '已被新的预约取代')
  assert.equal(replaced.canShare, false)
  assert.equal(replaced.shareHint, '不可分享')
  // 被取代又没录过语音的旧预约不再挂语音卡
  assert.equal(replaced.showVoice, false)
  assert.equal(page.data.headerMeta, '初二 · 最近陪跑 数学')
})

test('state reads 即将开始 within the hour, 已结束 once closed, and ended invites cannot be cancelled', async () => {
  const soon = { ...INVITE, scheduledOnlineAt: new Date(Date.now() + 20 * 60 * 1000).toISOString() }
  const closed = { ...INVITE, inviteId: '3', status: 'closed' }
  const { page } = loadPage({ invites: [soon, closed] })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  assert.match(page.data.invites[0].subtitle, /即将开始/)
  assert.match(page.data.invites[1].subtitle, /已结束/)
  assert.equal(page.data.invites[1].canCancel, false)
  assert.equal(page.data.invites[1].showVoice, false)
})

test('cancelling asks first and warns that live links will stop working', async () => {
  const { page, calls } = loadPage({ invites: [INVITE] })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  await page.handleCancelInvite({ currentTarget: { dataset: { inviteId: '5', latest: true } } })
  assert.match(calls.modals[0], /链接学生都打不开/)
  assert.deepEqual({ ...calls.canceled[0] }, { studentProfileId: '9', inviteId: '5' })
  assert.equal(page.data.invites[0].canShare, false)
  assert.equal(page.data.invites[0].subtitle, '45分钟 · 已取消')
})

test('declining the confirmation cancels nothing', async () => {
  const { page, calls } = loadPage({ confirmCancel: false, invites: [INVITE] })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  await page.handleCancelInvite({ currentTarget: { dataset: { inviteId: '5', latest: true } } })
  assert.equal(calls.canceled.length, 0)
})

test('a failed profile read keeps the reason and a retry', async () => {
  const { page } = loadPage({ loadError: '只有服务老师可以查看和修改学生档案。' })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /服务老师/)
})

test('the workspace links each student row to the detail page', () => {
  assert.match(workspaceTemplate, /bindtap="openStudent"/)
  assert.match(workspaceTemplate, /data-student-profile-id="\{\{item\.studentProfileId\}\}"/)
})

test('recording a voice uploads it and attaches it to that invite', async () => {
  const { page, calls } = loadPage({ invites: [{ ...INVITE, hasVoice: false, voiceDurationMs: 0 }] })
  page.onLoad({ studentProfileId: '9' })
  await page.loadPage()
  assert.equal(page.data.invites[0].canShare, false)
  assert.equal(page.data.invites[0].voiceText, '还没录课前语音')

  await page.handleVoiceTap({ currentTarget: { dataset: { inviteId: '5' } } })
  assert.equal(page.data.recordingInviteId, '5')
  await page.handleVoiceTap({ currentTarget: { dataset: { inviteId: '5' } } })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual({ ...calls.uploaded[0] }, { filePath: 'wxfile://voice.mp3', durationMs: 12000 })
  assert.deepEqual({ ...calls.voiceSaved[0] }, { studentProfileId: '9', inviteId: '5', fileId: '77', durationMs: 12000 })
})

test('design icons come from the backend asset table, not the package', () => {
  const template = fs.readFileSync(path.join(__dirname, '../teacher/student-detail/index.wxml'), 'utf8')
  assert.match(template, /UA\.src\(ui, item\.icon\)/)
  assert.match(template, /UA\.src\(ui, '\/assets\/student-service\/video-camera\.svg'\)/)
  assert.match(pageSource, /'\/assets\/student-service\/folder\.svg'/)
})
