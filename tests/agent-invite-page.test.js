const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageSource = fs.readFileSync(path.join(__dirname, '../learning/agent-invite/index.js'), 'utf8')
const template = fs.readFileSync(path.join(__dirname, '../learning/agent-invite/index.wxml'), 'utf8')
const chatSource = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')

function invitePayload(overrides = {}, inviteOverrides = {}) {
  return {
    status: 'ready',
    online: false,
    serverNow: '',
    ...overrides,
    invite: {
      inviteId: '5',
      token: 'tk1',
      subject: '数学',
      scheduledOnlineAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: 'scheduled',
      sessionId: '',
      teacherName: '王老师',
      ...inviteOverrides
    }
  }
}

function loadPage({ payload = invitePayload(), currentUser = { profile: { nickname: '小鹿', avatar_url: '' } }, loadError, reminder = { templateId: '', flowId: '' }, subscribeResult = 'accept', calendar = 'ok', storage = {} } = {}) {
  let definition
  const calls = { toasts: [], navigations: [], intervals: 0, clearedIntervals: 0, subscribes: [], recorded: [], calendars: [] }
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    setInterval: () => { calls.intervals += 1; return 7 },
    clearInterval: () => { calls.clearedIntervals += 1 },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console,
    decodeURIComponent,
    encodeURIComponent,
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 44, windowHeight: 812, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, left: 283 }),
      showToast: (options) => calls.toasts.push(options.title),
      navigateTo: (options) => calls.navigations.push(options.url),
      navigateBack: () => calls.navigations.push('back'),
      switchTab: (options) => calls.navigations.push(options.url),
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value },
      requestSubscribeMessage: (options) => {
        calls.subscribes.push(options.tmplIds)
        options.success({ [options.tmplIds[0]]: subscribeResult })
      },
      addPhoneCalendar: calendar === 'unsupported' ? undefined : (options) => {
        calls.calendars.push(options)
        if (calendar === 'ok') options.success()
        else options.fail({ errMsg: calendar })
      }
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          loadTeacherAgentInvite: async () => {
            if (loadError) throw new Error(loadError)
            return payload
          },
          loadCurrentUser: async () => currentUser,
          invokeActionFlow: async (flow, args) => { calls.recorded.push({ flow, args }); return {} }
        }
      }
      if (name.endsWith('/config/index')) {
        return {
          SUBSCRIBE_TEMPLATES: { LIVE_MEETING_REMINDER: reminder.templateId },
          ACTION_FLOWS: { LIVE_MEETING_REMINDER: { id: reminder.flowId } }
        }
      }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      // 分享封面用真实模块：测试页面没有画布，画不出封面，卡片退回默认截图
      if (name.endsWith('/services/share-cover')) return require('../services/share-cover')
      throw new Error(`Unexpected import ${name}`)
    }
  })

  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (!key.includes('.')) { this.data[key] = value; continue }
        const parts = key.split('.')
        let target = this.data
        for (const part of parts.slice(0, -1)) target = target[part]
        target[parts[parts.length - 1]] = value
      }
    }
  }
  return { page, calls }
}

test('the student sees the teacher, subject and time from the invite', async () => {
  const { page } = loadPage()
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.model.teacher.name, '王老师')
  assert.equal(page.data.model.schedule.subjectLabel, '数学')
  assert.equal(page.data.model.participants[1].name, '小鹿')
})

test('an invite that belongs to someone else explains itself instead of erroring', async () => {
  const { page } = loadPage({ payload: { status: 'not_your_invite', invite: null } })
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'blocked')
  assert.match(page.data.stateTitle, /不是给你的/)
})

test('entering before the scheduled time opens the room to wait in, not a refusal toast', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.model.action.canEnter, true)
  assert.equal(page.data.model.action.label, '进入诊断室')
  page.handleEnter()
  assert.deepEqual(calls.toasts, [])
  assert.deepEqual(calls.navigations, ['/pages/diagnosis-room/index?inviteToken=tk1'])
})

test('once online, entering opens the chat carrying the invite token and nothing else', async () => {
  const { page, calls } = loadPage({ payload: invitePayload({}, { scheduledOnlineAt: new Date(Date.now() - 60 * 1000).toISOString() }) })
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.model.action.canEnter, true)
  // 不带 prompt：开场由老师（AI）先开口，不替学生预填第一句话
  assert.deepEqual(calls.navigations, [])
  page.handleEnter()
  assert.deepEqual(calls.navigations, ['/pages/diagnosis-room/index?inviteToken=tk1'])
})

test('a cancelled invite sends the student back to self-study', async () => {
  const { page, calls } = loadPage({ payload: invitePayload({}, { status: 'canceled' }) })
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.loadState, 'ready')
  page.handleEnter()
  assert.deepEqual(calls.navigations, ['/pages/learning/index'])
})

test('the countdown ticker runs only before the scheduled time', async () => {
  const waiting = loadPage()
  waiting.page.onLoad({ token: 'tk1' })
  await waiting.page.loadPage()
  assert.equal(waiting.calls.intervals, 1)
  waiting.page.onHide()
  assert.equal(waiting.calls.clearedIntervals, 1)

  const online = loadPage({ payload: invitePayload({}, { scheduledOnlineAt: new Date(Date.now() - 60 * 1000).toISOString() }) })
  online.page.onLoad({ token: 'tk1' })
  await online.page.loadPage()
  assert.equal(online.calls.intervals, 0)
})

test('re-sharing keeps the same student-facing path', async () => {
  const { page } = loadPage()
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.onShareAppMessage().path, '/learning/agent-invite/index?token=tk1')
})

test('the page reuses the M40 sheet markup and the chat writes the session back', () => {
  assert.match(template, /live-session-sheet/)
  assert.match(template, /<dev-reset-fab\s*\/>/)
  // 会话建立后必须回写到邀请，且失败不能打断学习
  assert.match(chatSource, /this\.markInviteSession\(this\._agentSessionId\)/)
  assert.match(chatSource, /markTeacherAgentSession\(this\._inviteToken, sessionId\)\.catch\(/)
})

test('the chat page forwards the teacher voice as the first message and can play it', () => {
  // 页面契约：带邀请进入时读这条邀请，语音等到老师上线那一刻才发出来，插在消息最前，播放器用完销毁
  assert.match(chatSource, /if \(this\._inviteToken\) \{\s*\n\s*this\.loadInviteRoom\(\)/)
  assert.match(chatSource, /buildInviteVoiceMessage\(payload\)/)
  assert.match(chatSource, /messages: opening\.concat\(this\.data\.messages\)/)
  assert.match(chatSource, /this\._voiceAudio\.destroy\(\)/)
  const chatTemplate = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  assert.match(chatTemplate, /item\.kind === 'voice'/)
  assert.match(chatTemplate, /bindtap="handleVoicePlay"/)
})

// ——— 会议开始前的两个提醒：订阅通知、添加到日历 ————————————————

test('before it starts, 添加到日历 sits beside 进入诊断室 and writes a real calendar entry', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ token: 'tk1' })
  page.onShow()
  await page.loadPage()
  assert.equal(page.data.model.showReminders, true)

  page.handleAddCalendar()
  assert.equal(calls.calendars.length, 1)
  const entry = calls.calendars[0]
  assert.equal(entry.title, '数学专属诊断会议')
  assert.equal(entry.startTime, Math.floor(page.data.model.startAt / 1000), '日历要的是秒，不是毫秒')
  assert.equal(entry.endTime - entry.startTime, 3600, '没有结束时间，按一小时占位')
  assert.equal(entry.alarm, true)
  assert.equal(entry.alarmOffset, 600, '开始前 10 分钟提醒')
  assert.match(entry.description, /知鹿学习/)
  assert.match(calls.toasts[0], /已加到日历/)
})

test('a denied calendar permission says where to turn it on; a plain cancel says nothing', async () => {
  const denied = loadPage({ calendar: 'addPhoneCalendar:fail auth deny' })
  denied.page.onLoad({ token: 'tk1' })
  await denied.page.loadPage()
  denied.page.handleAddCalendar()
  assert.match(denied.calls.toasts[0], /日历权限/)

  const canceled = loadPage({ calendar: 'addPhoneCalendar:fail cancel' })
  canceled.page.onLoad({ token: 'tk1' })
  await canceled.page.loadPage()
  canceled.page.handleAddCalendar()
  assert.deepEqual(canceled.calls.toasts, [], '用户自己取消不用提示')
})

test('an old WeChat without calendar support gets told, not a silent no-op', async () => {
  const { page, calls } = loadPage({ calendar: 'unsupported' })
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  page.handleAddCalendar()
  assert.match(calls.toasts[0], /不支持加日历/)
})

test('订阅通知 does not appear until both the template and the sender are in place', async () => {
  // 只有前端授权、没有后端到点发送，等于答应了学生却不兑现
  for (const reminder of [{ templateId: '', flowId: '' }, { templateId: 'tmpl-1', flowId: '' }, { templateId: '', flowId: 'flow-1' }]) {
    const { page } = loadPage({ reminder })
    page.onLoad({ token: 'tk1' })
    page.onShow()
    await page.loadPage()
    assert.equal(page.data.canSubscribe, false, JSON.stringify(reminder))
  }
})

test('once ready, subscribing asks WeChat and records the subscription for the sender', async () => {
  const { page, calls } = loadPage({ reminder: { templateId: 'tmpl-1', flowId: 'flow-1' } })
  page.onLoad({ token: 'tk1' })
  page.onShow()
  await page.loadPage()
  assert.equal(page.data.canSubscribe, true)

  page.handleSubscribe()
  assert.deepEqual(Array.from(calls.subscribes[0]), ['tmpl-1'])
  assert.equal(page.data.subscribed, true)
  assert.match(calls.toasts[0], /已订阅/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.recorded.length, 1, '点了允许要记到后端，到点才发得出去')
  assert.equal(calls.recorded[0].args.payload.operation, 'reminder.subscribe')
  assert.equal(calls.recorded[0].args.payload.token, 'tk1')
})

test('a declined subscription records nothing', async () => {
  const { page, calls } = loadPage({ reminder: { templateId: 'tmpl-1', flowId: 'flow-1' }, subscribeResult: 'reject' })
  page.onLoad({ token: 'tk1' })
  page.onShow()
  await page.loadPage()
  page.handleSubscribe()
  assert.equal(page.data.subscribed, false)
  assert.equal(calls.recorded.length, 0)
})

test('the reminders go away once the meeting is on', async () => {
  const { page } = loadPage({ payload: invitePayload({}, { scheduledOnlineAt: new Date(Date.now() - 60 * 1000).toISOString() }) })
  page.onLoad({ token: 'tk1' })
  await page.loadPage()
  assert.equal(page.data.model.showReminders, false)
})

// ——— 做完之后换成对勾，并且记住 ————————————————————————————

test('once added, the calendar button turns into a check and will not add a duplicate', async () => {
  const storage = {}
  const { page, calls } = loadPage({ storage })
  page.onLoad({ token: 'tk1' })
  page.onShow()
  await page.loadPage()
  assert.equal(page.data.calendarAdded, false)

  page.handleAddCalendar()
  assert.equal(page.data.calendarAdded, true)
  // 再点一次不会往日历里再加一条
  page.handleAddCalendar()
  assert.equal(calls.calendars.length, 1)
  assert.match(calls.toasts[calls.toasts.length - 1], /已经在日历里了/)

  // 回到这一页还是对勾
  const again = loadPage({ storage })
  again.page.onLoad({ token: 'tk1' })
  again.page.onShow()
  assert.equal(again.page.data.calendarAdded, true)
  // 别的会议不受影响
  const other = loadPage({ storage })
  other.page.onLoad({ token: 'tk2' })
  other.page.onShow()
  assert.equal(other.page.data.calendarAdded, false)
})

test('a subscription is remembered too, and a second tap does not ask WeChat again', async () => {
  const storage = {}
  const { page, calls } = loadPage({ storage, reminder: { templateId: 'tmpl-1', flowId: 'flow-1' } })
  page.onLoad({ token: 'tk1' })
  page.onShow()
  await page.loadPage()
  page.handleSubscribe()
  page.handleSubscribe()
  assert.equal(calls.subscribes.length, 1)
  assert.match(calls.toasts[calls.toasts.length - 1], /已经订阅过了/)

  const again = loadPage({ storage, reminder: { templateId: 'tmpl-1', flowId: 'flow-1' } })
  again.page.onLoad({ token: 'tk1' })
  again.page.onShow()
  assert.equal(again.page.data.subscribed, true)
})

test('both done states show a check, in the colour of their own button', () => {
  const template = fs.readFileSync(path.join(__dirname, '../learning/agent-invite/index.wxml'), 'utf8')
  assert.match(template, /subscribed \? '\/assets\/live-meeting\/check-orange\.svg' : '\/assets\/live-meeting\/bell\.svg'/)
  assert.match(template, /calendarAdded \? '\/assets\/live-meeting\/check-blue\.svg' : '\/assets\/live-meeting\/calendar-add\.svg'/)
  assert.match(template, /calendarAdded \? '已添加' : '添加到日历'/)
  assert.ok(!template.includes('bell-on.svg'), '橙色铃铛已换成对勾')
})
