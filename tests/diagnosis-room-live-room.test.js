const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 诊断室：学生从老师的预约分享页进对话页。到点前只能看不能发；到点后老师的课前语音先出来，
// 再由 AI 以老师身份、照着这门学科的摸底诊断表开场。
const pagePath = require.resolve('../pages/diagnosis-room/index.js')
const identityPath = require.resolve('../services/identity.js')
const assessmentPath = require.resolve('../services/assessment.js')
const roomPath = require.resolve('../services/live-room-service.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const at = (iso) => new Date(iso).getTime()

const SCHEDULED = '2026-09-22T19:00:00+08:00'

function invitePayload(invite = {}, extra = {}) {
  return {
    status: 'ready',
    online: false,
    serverNow: '2026-09-22T18:50:00+08:00',
    ...extra,
    invite: {
      inviteId: '5',
      token: 'tk1',
      subject: '数学',
      scheduledOnlineAt: SCHEDULED,
      status: 'scheduled',
      sessionId: '',
      teacherName: '王老师',
      voiceUrl: 'https://cdn.example.com/voice.mp3',
      voiceDurationMs: 12000,
      ...invite
    }
  }
}

const DIAGNOSIS = {
  status: 'ready',
  subject: '数学',
  subjectKey: 'math',
  counts: { notMastered: 1, reinforce: 1, mastered: 1, pending: 0 },
  notMastered: [{ name: '二次函数图像', tier: 'A', right: 1, total: 4 }],
  reinforce: [{ name: '一次函数', tier: 'B', right: 2, total: 4 }],
  mastered: [{ name: '平面直角坐标系', tier: 'C', right: 4, total: 4 }],
  untested: []
}

function stubModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports, children: [], paths: [] }
}

function loadPage({ payload = invitePayload(), inviteError = null, diagnosis = DIAGNOSIS, roomReplies = [], storage = {} } = {}) {
  delete require.cache[pagePath]
  const calls = { toasts: [], invites: 0, diagnosisFor: [], marked: [], audio: [], syncs: [], closes: [] }
  stubModule(roomPath, {
    isConfigured: () => true,
    closeStudentRoom: async (request) => {
      calls.closes.push(request)
      return { status: 'ready', closed: true, closedReason: request.reason, messages: [], lastId: request.since, serverNow: '' }
    },
    syncStudentRoom: async (request) => {
      calls.syncs.push(request)
      const next = roomReplies.shift()
      if (next instanceof Error) throw next
      return next || { status: 'ready', serverNow: '', messages: [], lastId: request.since }
    }
  })
  stubModule(identityPath, {
    loadTeacherAgentInvite: async (token) => {
      calls.invites += 1
      if (inviteError) throw new Error(inviteError)
      return payload
    },
    markTeacherAgentSession: async (token, sessionId) => { calls.marked.push([token, sessionId]); return { status: 'ready' } },
    loadLearnerBaseline: async () => null
  })
  stubModule(assessmentPath, {
    loadSubjectDiagnosis: async (subject) => { calls.diagnosisFor.push(subject); return diagnosis }
  })

  let definition = null
  global.Page = (page) => { definition = page }
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast: (options) => calls.toasts.push(options.title),
    showLoading() {}, hideLoading() {}, hideKeyboard() {},
    nextTick: (callback) => callback(),
    request() {},
    getRecorderManager: () => ({ onStart() {}, onStop() {}, onError() {}, onFrameRecorded() {}, onPause() {}, onResume() {}, onInterruptionBegin() {}, onInterruptionEnd() {}, start() {}, stop() {} }),
    getSetting: (options) => options.success({ authSetting: {} }),
    getFileSystemManager: () => ({ unlinkSync() {}, unlink() {} }),
    createInnerAudioContext: () => {
      const audio = { src: '', onEnded() {}, onStop() {}, onError() {}, play: () => calls.audio.push(['play', audio.src]), pause: () => calls.audio.push(['pause', audio.src]), destroy() {} }
      return audio
    },
    createSelectorQuery: () => {
      const query = { in: () => query, select: () => query, boundingClientRect: () => query, scrollOffset: () => query, fields: () => query, exec: (cb) => cb && cb([]) }
      return query
    }
  }
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  // 与微信一致：支持 'a.b' 与 'list[0].b' 两种写法的按路径更新
  page.setData = (patch, callback) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = String(key).replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts[parts.length - 1]] = value
    }
    if (callback) callback()
  }
  // 不真的去连课程智能体：只记录发出去的开场词
  const prompts = []
  page.startAgentReply = (text) => { prompts.push(text) }
  page.ensureAgentAccess = () => Promise.resolve({})
  return { page, calls, prompts }
}

// t.after 兜底销毁：断言失败时也要把页面的定时器停掉，否则测试进程挂着不退出。
async function enterRoom(t, options, now) {
  const { page, calls, prompts } = loadPage(options)
  t.after(() => page.onUnload())
  page.onLoad({ inviteToken: 'tk1' })
  page.liveNow = () => now
  page._isPageVisible = true
  await sleep(5)
  return { page, calls, prompts }
}

test('walking in early shows the waiting state instead of an empty chat', async (t) => {
  const { page, calls, prompts } = await enterRoom(t, {}, at('2026-09-22T18:52:00+08:00'))
  assert.equal(page.data.liveMode, true)
  assert.equal(page.data.liveRoom.phase, 'waiting')
  assert.equal(page.data.liveRoom.waitingTitle, '等待会议开始中')
  assert.match(page.data.liveRoom.waitingHint, /^距离诊断会议开始还有/)
  // 老师还没上线：既没有语音，也没有 AI 开场
  assert.deepEqual(page.data.messages, [])
  assert.deepEqual(prompts, [])
  assert.deepEqual(calls.audio, [])
})

test('while waiting the student can type, but the message is held back with the reason', async (t) => {
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T18:52:00+08:00'))
  page.setData({ inputValue: '老师我想问二次函数' })
  page.sendMessage('老师我想问二次函数')
  assert.deepEqual(page.data.messages, [], '老师没上线时不能把学生的话发出去')
  assert.equal(page.data.inputValue, '老师我想问二次函数', '打好的字要留在输入框里')
  assert.equal(page.data.isSending, false)
  assert.deepEqual(calls.toasts, ['会议还没开始，开始后就能发消息'])
})

test('at the scheduled time the teacher voice arrives unplayed, then the AI opens as that teacher', async (t) => {
  const { page, calls, prompts } = await enterRoom(t, {}, at('2026-09-22T18:59:30+08:00'))
  assert.equal(page.data.liveRoom.phase, 'waiting')

  page.liveNow = () => at('2026-09-22T19:00:01+08:00')
  page.syncLiveRoom()
  await sleep(5)

  assert.equal(page.data.liveRoom.phase, 'online')
  assert.equal(page.data.messages[0].kind, 'notice')
  assert.equal(page.data.messages[0].text, '王老师已上线')
  assert.equal(page.data.messages[1].kind, 'voice')
  assert.equal(page.data.messages[1].label, '王老师的课前语音')
  // 没听过的语音带红点，所以不能替学生自动播——自动播就等于替他听了
  assert.equal(page.data.messages[1].unread, true)
  assert.deepEqual(calls.audio, [])

  page.handleVoicePlay({ currentTarget: { dataset: { id: 'invite-voice' } } })
  assert.deepEqual(calls.audio, [['play', 'https://cdn.example.com/voice.mp3']])
  assert.equal(page.data.messages[1].unread, false, '听过之后红点消掉')

  assert.equal(calls.diagnosisFor[0], '数学', '开场前要先读这门学科的摸底诊断表')
  assert.equal(prompts.length, 1)
  assert.match(prompts[0], /王老师/)
  assert.match(prompts[0], /二次函数图像、一次函数/)
  assert.match(prompts[0], /ask_user/)
  assert.match(prompts[0], /不要排课/)
  // 学生看不到这条指令，也没有替他发一句「我们开始吧」
  assert.ok(!page.data.messages.some((item) => item.role === 'user'))
})

test('walking in after the scheduled time opens straight away', async (t) => {
  const { page, calls, prompts } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  assert.equal(page.data.liveRoom.phase, 'online')
  assert.deepEqual(page.data.messages.map((item) => item.kind), ['notice', 'voice'])
  assert.equal(prompts.length, 1)
  assert.equal(calls.diagnosisFor.length, 1)
  // 上线之后就能正常发言了（开场这一轮跑完，和平时回复结束一样解除发送中）
  page.setData({ isSending: false })
  page.sendMessage('我想搞懂二次函数')
  assert.equal(page.data.messages.filter((item) => item.role === 'user').length, 1)
})

test('coming back to a meeting already started resumes it instead of opening a second time', async (t) => {
  const resumed = []
  const { page, prompts } = await enterRoom(t,
    { payload: invitePayload({ status: 'active', sessionId: 'sess-7' }) },
    at('2026-09-22T19:30:00+08:00')
  )
  page.resumeAgentSession = (id, options) => resumed.push([id, options])
  page.onUnload()
  // 恢复由 loadInviteRoom 触发，这里直接核对状态：会话已接上、开场不再重放
  assert.equal(page._agentSessionId, 'sess-7')
  assert.deepEqual(prompts, [])
})

test('an invite that cannot be read offers a retry, never the open chat page', async (t) => {
  const { page, calls, prompts } = await enterRoom(t, { inviteError: '网络开小差' }, at('2026-09-22T19:30:00+08:00'))
  // 读不到邀请也不能退回通用对话：随便带个 inviteToken 就能跟 AI 聊，等于没有入口限制
  assert.equal(page.data.liveMode, true)
  assert.equal(page.data.liveRoom.blocked, true)
  assert.equal(page.data.liveRoom.retryable, true)
  page.sendMessage('随便问一句')
  assert.deepEqual(page.data.messages, [])
  assert.deepEqual(prompts, [])
  page.retryInviteRoom()
  await sleep(5)
  assert.equal(calls.invites, 2)
})

test('while the invite is still loading nothing can be sent', async (t) => {
  const { page, prompts } = loadPage()
  t.after(() => page.onUnload())
  page.onLoad({ inviteToken: 'tk1' })
  page.sendMessage('抢在邀请读出来之前说话')
  assert.deepEqual(page.data.messages, [])
  assert.deepEqual(prompts, [])
})

test('a refused invite says why, and never opens the room', async (t) => {
  const { page, prompts } = await enterRoom(t, { payload: { status: 'not_your_invite', invite: null } }, at('2026-09-22T19:30:00+08:00'))
  assert.equal(page.data.liveMode, true)
  assert.equal(page.data.liveRoom.blocked, true)
  assert.match(page.data.liveRoom.stateTitle, /不是给你的/)
  assert.deepEqual(prompts, [])
})

test('the meeting shows only what a teacher would say: no thinking cards, no tool steps', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.insertAgentActivity({ kind: 'thinking', id: 'thinking-1', streaming: true })
  page.insertAgentActivity({ kind: 'tool', id: 'tool-1', label: '调用 search_chats', state: 'running' })
  page.insertAgentActivity({ kind: 'question', id: 'q-1', question: '今天先解决哪个？', options: [] })
  const kinds = page.data.messages.map((item) => item.kind).filter(Boolean)
  assert.ok(!kinds.includes('thinking'), '学生不该看到思考卡')
  assert.ok(!kinds.includes('tool'), '学生不该看到工具调用')
  assert.ok(kinds.includes('question'), '选择框要留着')
})

test('the teacher types a whole message at a time, shown as 正在回复中 until it is done', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: false })
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.ensureAgentAccess = () => new Promise(() => {})
  page.startAgentReply('随便什么')
  const typing = page.data.messages[page.data.messages.length - 1]
  assert.equal(typing.isTyping, true)
  assert.equal(typing.typingLabel, '王老师正在回复中…')

  // 流式片段一律不落到气泡上：老师不会一个字一个字往外蹦
  page.updateStreamingAssistant('小鹿，我看')
  await sleep(160)
  assert.equal(page.data.messages[page.data.messages.length - 1].text, '')

  page.finishAgentAssistantReply('小鹿，我看了你的数学摸底。')
  assert.equal(page.data.messages[page.data.messages.length - 1].text, '小鹿，我看了你的数学摸底。')
  assert.equal(page.data.messages[page.data.messages.length - 1].isTyping, false)
})

test('what the student and the AI say is written into the meeting record', async (t) => {
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: false })
  page.sendMessage('我想搞懂二次函数')
  page.queueRoomMessage('ai', 'a-7', '好，我们先从图像开始。')
  await page.syncRoom()
  const appended = calls.syncs[calls.syncs.length - 1].append
  assert.deepEqual(appended.map((item) => item.sender), ['student', 'ai'])
  assert.equal(appended[0].content, '我想搞懂二次函数')
  assert.equal(appended[1].clientKey, 'a-7')
})

test('a line the teacher types himself reaches the student as the teacher, and is reported read', async (t) => {
  const { page, calls } = await enterRoom(t, {
    roomReplies: [{
      status: 'ready',
      serverNow: '',
      lastId: '12',
      messages: [
        { id: '11', sender: 'teacher', kind: 'voice', content: '课前语音', readAt: '', createdAt: '' },
        { id: '12', sender: 'teacher', kind: 'text', content: '这里我补一句：先别急着算。', readAt: '', createdAt: '' }
      ]
    }]
  }, at('2026-09-22T19:30:00+08:00'))
  // 进房时已经同步过一次，老师那句话这时就在屏幕上了
  const last = page.data.messages[page.data.messages.length - 1]
  // 学生只面对一个老师：老师亲自打的字和 AI 的回复长得一模一样
  assert.equal(last.role, 'assistant')
  assert.equal(last.text, '这里我补一句：先别急着算。')
  assert.equal(last.roomId, '12')
  // 语音行只用来认 id，不重复渲染成一条文字
  assert.ok(!page.data.messages.some((item) => item.text === '课前语音'))

  await page.syncRoom()
  const second = calls.syncs[calls.syncs.length - 1]
  assert.deepEqual(second.readIds, ['12'], '显示出来就算学生看到了，如实报给老师')
  assert.equal(second.since, '12')
})

test('a failed sync keeps the record instead of dropping it', async (t) => {
  const { page, calls } = await enterRoom(t, { roomReplies: [null, new Error('断网')] }, at('2026-09-22T19:30:00+08:00'))
  page.queueRoomMessage('student', 'u-1', '在吗')
  await page.syncRoom()
  await page.syncRoom()
  const appended = calls.syncs[calls.syncs.length - 1].append
  assert.deepEqual(appended.map((item) => item.content), ['在吗'], '网络抖一下不该把这句话弄丢')
})

test('the opening prompt is never shown as something the student said', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  // 服务端把建会话时发出去的开场词回放回来：诊断室里这句是系统按学情拼的，不是学生说的
  page.handleAgentEvent({
    id: 1,
    type: 'session_start',
    data: { prompt: '你是这位学生的数学老师…（含学习选项与摸底基本盘）' }
  })
  assert.ok(!page.data.messages.some((item) => item.role === 'user'), '诊断室里不该凭空出现学生气泡')

  // 学生自己打的字照常显示
  page.setData({ isSending: false })
  page.sendMessage('我想搞懂二次函数')
  const mine = page.data.messages.filter((item) => item.role === 'user')
  assert.equal(mine.length, 1)
  assert.equal(mine[0].text, '我想搞懂二次函数')
})

test('in the room the teacher name and avatar stack above the bubble, not beside it', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  // .agent-message 本身是横向 flex，老师消息必须显式改成纵向，否则头像会跑到气泡左边
  assert.match(template, /is-live-stacked/)
  assert.match(styles, /\.agent-message\.is-live-stacked \{[^}]*flex-direction: column/)
  assert.match(styles, /\.agent-message\.is-live-stacked \{[^}]*align-items: flex-start/)
})

test('the student never sees AI or agent wording, not even when the backend fails', async (t) => {
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))

  // 这条就是客户遇到的：课程智能体返回 502，原文案会把「智能体」和 HTTP 码摆到学生面前
  page.finishFailedReply(Object.assign(new Error('课程智能体请求失败（HTTP 502）'), { statusCode: 502 }))
  const shown = calls.toasts[calls.toasts.length - 1]
  assert.ok(shown, '失败时仍要给学生一句解释')
  assert.doesNotMatch(shown, /AI|智能体|HTTP|502|模型|接口|服务端/i, `学生不该看到系统口径：${shown}`)
  assert.match(shown, /老师/)
  // 留在对话里的那条气泡同样是老师的口吻，不是系统报错
  const bubble = page.data.messages[page.data.messages.length - 1]
  assert.doesNotMatch(bubble.text, /AI|智能体|请求失败/i, `气泡不该写成系统报错：${bubble.text}`)

  // 其他系统味道的提示同样被挡住
  page.notifyStudent('AI 服务暂时不可用，已切换本地演示')
  assert.doesNotMatch(calls.toasts[calls.toasts.length - 1], /AI|智能体/i)
  page.notifyStudent('会话已失效，请重新开始')
  assert.doesNotMatch(calls.toasts[calls.toasts.length - 1], /会话/)

  // 本来就干净的提示原样保留，不要无差别替换
  page.notifyStudent('说话时间太短，请重新长按')
  assert.equal(calls.toasts[calls.toasts.length - 1], '说话时间太短，请重新长按')
})

test('the room never shows the agent chrome: no AI notice, no history, no new-chat', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  // 输入区下方那行在诊断室里换成自己的说明，「内容由AI生成」只留给普通对话页
  assert.match(template, /liveMode \? \(liveRoom\.phase === 'waiting' \? liveRoom\.sendBlockedHint : liveRoom\.composerNote\)/)
  // 新建对话与历史列表属于智能体对话页，诊断室里不给入口
  assert.match(template, /wx:if="\{\{!liveMode\}\}" class="agent-new-chat-button"/)
  assert.match(template, /wx:if="\{\{!liveMode\}\}" class="agent-history-button"/)
  // 欢迎页在诊断室里不出现（回放上一次对话时也先画骨架，不闪欢迎页）
  assert.match(template, /wx:if="\{\{!messages\.length && !liveMode && !restoring\}\}" class="agent-welcome"/)
})

test('while the teacher is replying the send key never turns into a stop button', async (t) => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  assert.ok(!/agent-stop-icon/.test(template), '学生不能打断老师：模板里不再有停止键')
  assert.ok(!/is-sending/.test(template))

  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: false })
  page.sendMessage('老师我想问二次函数')
  assert.equal(page.data.isSending, true)
  const before = page.data.messages.length
  calls.toasts.length = 0
  page.handleSendOrStop()
  // 按了也掐不断老师：回复照常进行，只提示等一等
  assert.equal(page.data.isSending, true)
  assert.equal(page.data.messages.length, before)
  assert.deepEqual(calls.toasts, ['老师正在回复，请稍等'])
})

test('no raw backend message can reach a toast without passing the filter', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const source = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')
  // 动态内容（后端 message / reason / notice）必须走 notifyStudent，否则 502 这类原文又会漏到学生眼前
  const rawDynamic = source.match(/wx\.showToast\(\{\s*title:\s*(error|reason|notice)\b/g) || []
  assert.deepEqual(rawDynamic, [], '后端文案必须经 notifyStudent 过滤')
  // 页面里也不该再有带 AI/智能体字样的硬编码 toast
  const rawWording = (source.match(/wx\.showToast\(\{[^}]*\}/g) || []).filter((call) => /AI|智能体|模型/i.test(call))
  assert.deepEqual(rawWording, [], '不该有带 AI/智能体字样的提示')
})

test('after two silent minutes the teacher asks whether the student is still there', async (t) => {
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page._lastStudentAt = at('2026-09-22T19:30:00+08:00')

  // 一分钟：什么都不做
  page.liveNow = () => at('2026-09-22T19:31:00+08:00')
  page.checkIdle()
  assert.ok(!page.data.messages.some((item) => item.text === '你好，同学，还在吗？'))

  // 两分钟：老师问一句，并且这句话进会议记录，老师那边看得到
  page.liveNow = () => at('2026-09-22T19:32:00+08:00')
  page.checkIdle()
  const asked = page.data.messages.filter((item) => item.text === '你好，同学，还在吗？')
  assert.equal(asked.length, 1)
  assert.equal(asked[0].role, 'assistant')
  await page.syncRoom()
  const appended = calls.syncs[calls.syncs.length - 1].append
  assert.ok(appended.some((item) => item.content === '你好，同学，还在吗？'))

  // 再过两分钟不会重复催
  page.liveNow = () => at('2026-09-22T19:34:00+08:00')
  page.checkIdle()
  assert.equal(page.data.messages.filter((item) => item.text === '你好，同学，还在吗？').length, 1)
})

test('after thirty silent minutes the room closes, says why, and tells the teacher', async (t) => {
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page._lastStudentAt = at('2026-09-22T19:30:00+08:00')
  page._idlePrompted = true

  page.liveNow = () => at('2026-09-22T20:00:00+08:00')
  page.checkIdle()

  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.match(page.data.liveRoom.closedReason, /30 分钟/)
  // 「会议已结束」由模板固定跟在最后一条消息后面（和开场的「已上线」对称），具体原因在下面那张结束卡里
  assert.equal(page.data.liveRoom.closedNotice, '会议已结束')
  assert.ok(!page.data.messages.some((item) => item.text === '会议已结束'), '不再作为一条消息塞进列表')
  // 结束状态写回后端：老师在自己的记录里看得到原因，学生换设备也是同一个结论
  assert.equal(calls.closes.length, 1)
  assert.equal(calls.closes[0].token, 'tk1')
  assert.match(calls.closes[0].reason, /30 分钟/)

  // 关了之后发不出去，提示说明原因
  page.setData({ isSending: false })
  page.sendMessage('还能说话吗')
  assert.match(calls.toasts[calls.toasts.length - 1], /已结束/)
  assert.ok(!page.data.messages.some((item) => item.text === '还能说话吗'))
})

test('a student who reopens a closed invite does not get a fresh session', async (t) => {
  // 同一台手机：两次进入共用一份本地存储
  const storage = {}
  const { page } = await enterRoom(t, { storage }, at('2026-09-22T19:30:00+08:00'))
  page._lastStudentAt = at('2026-09-22T19:30:00+08:00')
  page._idlePrompted = true
  page.liveNow = () => at('2026-09-22T20:00:00+08:00')
  page.checkIdle()
  assert.ok(Object.values(storage).some((value) => /30 分钟/.test(String(value))), '关闭状态要留下来')

  // 再进一次：仍然是已结束，而不是又开一场
  const again = await enterRoom(t, { storage }, at('2026-09-22T20:05:00+08:00'))
  assert.equal(again.page.data.liveRoom.phase, 'closed')
  assert.match(again.page.data.liveRoom.closedReason, /30 分钟/)
  assert.deepEqual(again.prompts, [], '已结束的会议不该再让 AI 开场')
})

test('two replies in a row: neither is left hidden by the other', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.ensureAgentAccess = () => new Promise(() => {})
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.setData({ isSending: false })

  page.startAgentReply('第一条')
  const first = page.data.messages[page.data.messages.length - 1]
  page.setData({ isSending: false })
  page.startAgentReply('第二条')
  const second = page.data.messages[page.data.messages.length - 1]
  assert.notEqual(first.id, second.id)
  // 曾经共用一个计时器：第二条一来就把第一条的清掉，第一条永远停在 display:none
  assert.equal(page.data.messages.filter((item) => item.pending).length, 2)

  page.revealPendingMessage(first.id)
  page.revealPendingMessage(second.id)
  assert.deepEqual(page.data.messages.filter((item) => item.pending), [])
})

test('when the turn ends, nothing is left hidden even if a timer was lost', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({
    isSending: true,
    messages: [{ id: 'a1', role: 'assistant', text: '老师说的第一句', pending: true }]
  })
  page.clearLiveTypingTimers()
  page.handleAgentEvent({ id: 9, type: 'session_end', data: { status: 'succeeded' } })
  assert.deepEqual(page.data.messages.filter((item) => item.pending), [], '本轮结束还挂着的一律放出来')
})

test('the teacher speaks in plain words, not in markdown', async (t) => {
  const { page } = await enterRoom(t, {
    roomReplies: [{
      status: 'ready', serverNow: '', lastId: '20',
      messages: [{ id: '20', sender: 'teacher', kind: 'text', content: '先看**二次函数**的顶点式', readAt: '', createdAt: '' }]
    }]
  }, at('2026-09-22T19:30:00+08:00'))
  const last = page.data.messages[page.data.messages.length - 1]
  assert.equal(last.text, '先看二次函数的顶点式', '记号在进 data 之前就剥掉了')
})

test('a room closed elsewhere closes here too, on the next sync', async (t) => {
  const { page } = await enterRoom(t, {
    roomReplies: [{ status: 'ready', serverNow: '', messages: [], lastId: '0', closed: true, closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。' }]
  }, at('2026-09-22T19:30:00+08:00'))
  await page.syncRoom()
  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.match(page.data.liveRoom.closedReason, /30 分钟/)
  // 收场提示由模板显示；原因跟着 closedReason 走，卡片里看得到
  assert.equal(page.data.liveRoom.closedNotice, '会议已结束')
})

test('an invite already closed on the server opens as closed, with the server reason', async (t) => {
  const { page, prompts } = await enterRoom(t, {
    payload: invitePayload({ status: 'closed' }, { closed: true, closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。', closedAt: '2026-09-22T20:00:00Z' })
  }, at('2026-09-22T20:30:00+08:00'))
  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.match(page.data.liveRoom.closedReason, /30 分钟/)
  assert.deepEqual(prompts, [], '已结束的会议不该再让 AI 开场')
})

test('the student gets a few silent seconds before 老师正在回复中 shows up', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.ensureAgentAccess = () => new Promise(() => {})
  page.setData({ isSending: false })

  page.startAgentReply('学生刚说完话')
  const bubble = page.data.messages[page.data.messages.length - 1]
  // 挂起期间整条不出现：不能学生一发完就蹦「老师正在输入」
  assert.equal(bubble.pending, true)
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  assert.match(template, /\{\{item\.pending \? 'is-pending' : ''\}\}/)
  const style = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  assert.match(style, /\.agent-message\.is-pending \{ display: none; \}/)

  // 「不可见」是危险状态，所以两道兜底都必须在：每条各自的计时器 + 本轮结束时统一放出
  const source = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')
  assert.match(source, /_liveTypingTimers\[messageId\]/)
  assert.match(source, /revealAllPendingMessages\(\)/)

  page.revealPendingMessage(bubble.id)
  assert.equal(page.data.messages[page.data.messages.length - 1].pending, false)
})

test('every reply takes 8 to 20 seconds; the first 3 to 5 show nothing, then 正在回复中', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.ensureAgentAccess = () => new Promise(() => {})
  const timers = []
  const realSetTimeout = global.setTimeout
  const realRandom = Math.random
  t.after(() => { global.setTimeout = realSetTimeout; Math.random = realRandom })
  global.setTimeout = (fn, ms) => { timers.push(ms); return realSetTimeout(fn, ms) }

  for (const [random, quiet, hold] of [[0, 3000, 8000], [0.9999999, 5000, 20000]]) {
    Math.random = () => random
    timers.length = 0
    page.setData({ isSending: false })
    const before = Date.now()
    page.startAgentReply('学生刚说完话')
    const after = Date.now()
    assert.ok(timers.includes(quiet), `前 ${quiet / 1000} 秒不显示`)
    assert.ok(page._liveReplyHoldUntil >= before + hold && page._liveReplyHoldUntil <= after + hold, `${hold / 1000} 秒后才出话`)
    page.clearLiveTypingTimers()
  }
  global.setTimeout = realSetTimeout
  Math.random = realRandom
})

test('a reply that comes back early waits for its moment, then shows all at once', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.ensureAgentAccess = () => new Promise(() => {})
  page.setData({ isSending: false })
  page.sendMessage('老师我想问二次函数')
  await sleep(320)
  const bubble = page.data.messages[page.data.messages.length - 1]
  assert.equal(bubble.isTyping, true)
  // 把十几秒的等待缩短到 120ms 来测
  page._liveReplyHoldUntil = Date.now() + 120
  page.enqueueAgentEvent({ id: 11, type: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: '我们先看顶点式。' }] } } })
  // 重连回放的同一条只收一次
  page.enqueueAgentEvent({ id: 11, type: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: '我们先看顶点式。' }] } } })
  page.enqueueAgentEvent({ id: 12, type: 'session_end', data: { status: 'succeeded' } })
  assert.equal(page._agentEventQueue.length, 2)
  await sleep(30)
  // AI 已经写完了，但没到点：学生这边仍是「正在回复中」，也还不能说下一句
  assert.equal(page.data.messages[page.data.messages.length - 1].isTyping, true)
  assert.equal(page.data.messages[page.data.messages.length - 1].text, '')
  assert.equal(page.data.isSending, true)
  await sleep(200)
  const reply = page.data.messages[page.data.messages.length - 1]
  assert.equal(reply.text, '我们先看顶点式。')
  assert.equal(reply.isTyping, false)
  assert.equal(reply.pending, false, '到点时还挂着的也一并放出来')
  assert.equal(page.data.isSending, false)
  assert.equal(page.data.messages.filter((item) => item.text === '我们先看顶点式。').length, 1)
})

test('the opening when the teacher comes online is not held as a reply, and says 正在输入', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.startAgentReply = Object.getPrototypeOf(page).startAgentReply
  page.ensureAgentAccess = () => new Promise(() => {})
  page.setData({ isSending: false })
  page._liveReplyHoldUntil = 0
  page.startAgentReply('开场词', { opening: true })
  const bubble = page.data.messages[page.data.messages.length - 1]
  assert.equal(bubble.typingLabel, '王老师正在输入…')
  assert.equal(bubble.pending, true)
  assert.ok(!page._liveReplyHoldUntil, '开场不是在回学生的话，不压出话时间')
  const source = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')
  assert.match(source, /\}\), \{ opening: true \}\)/, '开场要以 opening 发出')
})

test('once the student confirms and building starts, the teacher says one line and the meeting ends', async (t) => {
  const { HANDOFF_TEXT, HANDOFF_CLOSE_REASON } = require('../services/live-room-view')
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page._agentActive = true
  page._agentSessionId = 'sess-1'
  page.setData({ isSending: true, messages: [{ id: 'a1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' }] })
  // 没问完学生就建课：服务端拒绝（isError），会议照常继续
  page.handleAgentEvent({ id: 2, type: 'tool_execution_start', data: { toolName: 'create_folder', toolCallId: 'c8', args: {} } })
  page.handleAgentEvent({ id: 3, type: 'tool_execution_end', data: { toolName: 'create_folder', toolCallId: 'c8', isError: true } })
  assert.notEqual(page.data.liveRoom.phase, 'closed')
  assert.ok(!page.data.messages.some((item) => item.text === HANDOFF_TEXT))

  page.handleAgentEvent({ id: 4, type: 'tool_execution_end', data: { toolName: 'create_folder', toolCallId: 'c9', isError: false } })

  // 「正在输入」收掉，换成老师的收场话；会议结束，告诉他去「我的课程」看
  assert.deepEqual(page.data.messages.map((item) => item.text), [HANDOFF_TEXT])
  assert.equal(page.data.isSending, false)
  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.equal(page.data.liveRoom.closedReason, HANDOFF_CLOSE_REASON)
  assert.match(HANDOFF_TEXT, /我的课程/)

  // 后面的建课过程（课程卡、每节小结）学生都不再看到
  page.handleAgentEvent({ id: 6, type: 'course_generation', data: { stageId: 'AbC123', title: '第1节', totalPages: 6 } })
  page.handleAgentEvent({ id: 7, type: 'message_start', data: { message: { role: 'assistant' } } })
  assert.equal(page.data.messages.length, 1)

  // 先把收场话写进会议记录，再关房间
  await sleep(5)
  assert.ok(calls.syncs.some((request) => request.append.some((item) => item.content === HANDOFF_TEXT)))
  assert.equal(calls.closes.length, 1)
  assert.equal(calls.closes[0].reason, HANDOFF_CLOSE_REASON)

  // 离开页面只断开本端，不能把后台正在建的课停掉
  assert.equal(page._agentActive, false)
  const cancels = []
  const original = page.cancelAgentRun
  page.cancelAgentRun = function (stopRemote) { cancels.push(stopRemote); return original.call(this, stopRemote) }
  page.onUnload()
  assert.deepEqual(cancels, [false])
})

test('the build tool skips the reply hold: leaving mid-build never cancels it, and success closes the meeting at once', async (t) => {
  const { HANDOFF_TEXT } = require('../services/live-room-view')
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page._agentActive = true
  page._agentSessionId = 'sess-1'
  page.setData({ isSending: true, messages: [{ id: 'a1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' }] })
  // 学生刚确认：老师的回复还压在十几秒的出话节拍里
  page._liveReplyHoldUntil = Date.now() + 15000
  page.enqueueAgentEvent({ id: 10, type: 'message_update', data: { assistantMessageEvent: { type: 'text_delta', delta: '好，那就按这个安排' } } })
  page.enqueueAgentEvent({ id: 11, type: 'tool_execution_start', data: { toolName: 'start_course_generation', toolCallId: 'c1', args: {} } })
  assert.equal(page._meetingBuildStarted, true)
  assert.notEqual(page.data.liveRoom.phase, 'closed', '只是开始建课，还不收场')
  // 这时点返回：只断开本端，不取消服务端建课
  const cancels = []
  const original = page.cancelAgentRun
  page.cancelAgentRun = function (stopRemote) { cancels.push(stopRemote); return original.call(this, stopRemote) }
  page.onUnload()
  assert.deepEqual(cancels, [false])

  // 另开一场：建课成功的结果不等出话节拍，立刻收场，「正在回复」随之消失
  const second = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  second.page._agentActive = true
  second.page._agentSessionId = 'sess-2'
  second.page.setData({ isSending: true, messages: [{ id: 'b1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' }] })
  second.page._liveReplyHoldUntil = Date.now() + 15000
  second.page.enqueueAgentEvent({ id: 21, type: 'tool_execution_start', data: { toolName: 'create_folder', toolCallId: 'c2', args: {} } })
  second.page.enqueueAgentEvent({ id: 22, type: 'tool_execution_end', data: { toolName: 'create_folder', toolCallId: 'c2', isError: false } })
  assert.equal(second.page.data.isSending, false)
  assert.equal(second.page.data.liveRoom.phase, 'closed')
  assert.deepEqual(second.page.data.messages.map((item) => item.text), [HANDOFF_TEXT])
  assert.ok(calls)
})

test('a rejected build in the queue does not mark the build as started', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page._liveReplyHoldUntil = Date.now() + 15000
  page.enqueueAgentEvent({ id: 31, type: 'tool_execution_start', data: { toolName: 'create_stage', toolCallId: 'c3', args: {} } })
  page.enqueueAgentEvent({ id: 32, type: 'tool_execution_end', data: { toolName: 'create_stage', toolCallId: 'c3', isError: true } })
  assert.equal(page._meetingBuildStarted, false)
  assert.notEqual(page.data.liveRoom.phase, 'closed')
})

test('the send key never turns into a stop button and the meeting room hides course progress', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.js'), 'utf8')
  assert.ok(!/共 \$\{/.test(source), '课程卡不再写共几页')
  assert.match(source, /定制课程已梳理，等待制作中/)
})

test('a line the teacher types mid-reply does not swallow what the AI is writing', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({
    isSending: true,
    messages: [
      // 本轮 AI 正在写的气泡
      { id: 'a1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' },
      // 轮询把老师刚打的字追加在后面——它已经写完了，不是本轮的回复
      { id: 'teacher-32', role: 'assistant', text: '你好', roomId: '32' }
    ]
  })
  page.finishAgentAssistantReply('我看了你八年级数学的摸底。')
  assert.equal(page.data.messages[1].text, '你好', '老师那条不能被 AI 的正文覆盖')
  assert.equal(page.data.messages[0].text, '我看了你八年级数学的摸底。', 'AI 的正文要落在自己的气泡上')
  assert.equal(page.data.messages[0].isTyping, false)
})

// ——— 家长旁听 ————————————————————————————————
// 绑定了这名学生的家长能进同一间诊断室，但只能看：发不了言、不建会话、也不替孩子标已读。
// 这几条后端都是强制的（scripts/mp-teacher/live-room.js），这里盯的是前端不要自作主张。

function guardianPayload() {
  return invitePayload({ status: 'active', sessionId: 'sess-7' }, { viewer: 'guardian' })
}

test('a bound guardian can watch the room but never drives it', async (t) => {
  const { page, calls, prompts } = await enterRoom(t, {
    payload: guardianPayload(),
    roomReplies: [{
      status: 'ready', serverNow: '', viewer: 'guardian', lastId: '14',
      messages: [
        { id: '12', sender: 'teacher', kind: 'text', content: '先别急着算', readAt: '', createdAt: '' },
        { id: '13', sender: 'student', kind: 'text', content: '二次函数', readAt: '', createdAt: '' },
        { id: '14', sender: 'ai', kind: 'text', content: '那我们从图像开始', readAt: '', createdAt: '' }
      ]
    }]
  }, at('2026-09-22T19:30:00+08:00'))

  assert.equal(page.data.liveRoom.observer, true)
  // 整场对话都看得到：孩子说的摆右边，老师和 AI 摆左边——和孩子自己看到的一致
  const spoken = page.data.messages.filter((item) => item.roomId)
  assert.deepEqual(spoken.map((item) => item.role), ['assistant', 'user', 'assistant'])
  assert.deepEqual(spoken.map((item) => item.text), ['先别急着算', '二次函数', '那我们从图像开始'])
  // 不开场、不建会话
  assert.deepEqual(prompts, [])
  assert.deepEqual(calls.diagnosisFor, [])
  assert.equal(page._agentSessionId, '')
})

test('a guardian sees the plan and question cards the child saw, not raw record text', async (t) => {
  const { encodeRoomCard, questionRecordText } = require('../utils/room-card-record')
  const { buildCoursePlanCard, coursePlanRecordText } = require('../utils/course-plan-card')
  const plan = buildCoursePlanCard({ seriesTitle: '二次函数', lessons: [{ lesson: 1, title: '图像与开口', knowledgePoint: '开口方向' }] }, { id: 'plan-1' })
  const question = { kind: 'question', question: '哪一步卡住了？', multiSelect: false, options: [{ id: 'a', label: '画图' }, { id: 'b', label: '求顶点' }] }
  const { page } = await enterRoom(t, {
    payload: guardianPayload(),
    roomReplies: [{
      status: 'ready', serverNow: '', viewer: 'guardian', lastId: '22',
      messages: [
        { id: '21', sender: 'ai', kind: 'text', content: encodeRoomCard(questionRecordText(question), question), readAt: '', createdAt: '' },
        { id: '22', sender: 'ai', kind: 'text', content: encodeRoomCard(coursePlanRecordText(plan), plan), readAt: '', createdAt: '' }
      ]
    }]
  }, at('2026-09-22T19:30:00+08:00'))
  const cards = page.data.messages.filter((item) => item.roomId)
  assert.deepEqual(cards.map((item) => item.kind), ['question', 'plan'])
  assert.equal(cards[0].readonly, true, '家长不能替孩子作答')
  assert.deepEqual(cards[0].options.map((option) => option.label), ['画图', '求顶点'])
  assert.equal(cards[1].title, '二次函数')
  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'a', questionId: cards[0].id } } })
  assert.ok(!cards[0].selectedIds || !cards[0].selectedIds.length)
})

test('the student writes the question card and the confirmed plan into the record as cards', async (t) => {
  const { decodeRoomCard } = require('../utils/room-card-record')
  const { page, calls } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.handleAgentEvent({ id: 41, type: 'user_question', data: { question: '哪一步卡住了？', options: [{ id: 'a', label: '画图' }], multiSelect: false } })
  await page.syncRoom()
  const appended = calls.syncs[calls.syncs.length - 1].append
  const record = appended.find((item) => item.clientKey === 'question-41')
  assert.ok(record, '选择题写进了会议记录')
  assert.equal(decodeRoomCard(record.content).card.question, '哪一步卡住了？')
})

test('a guardian cannot speak, and nothing he does reaches the record', async (t) => {
  const { page, calls } = await enterRoom(t, { payload: guardianPayload() }, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: false })
  page.sendMessage('孩子你快回答呀')
  assert.ok(!page.data.messages.some((item) => item.text === '孩子你快回答呀'), '家长的话不进对话')
  assert.deepEqual(calls.toasts, ['家长旁听中，这里由孩子和老师对话'])

  page.queueRoomMessage('student', 'g-1', '家长冒充孩子')
  page.reportLiveRead('invite-voice')
  await page.syncRoom()
  const last = calls.syncs[calls.syncs.length - 1]
  assert.deepEqual(last.append, [], '家长写不进会议记录')
  assert.deepEqual(last.readIds, [], '已读说的是孩子看到了，不是家长看到了')
})

test('the composer is not even shown to a guardian, or on a refused / unreadable invite', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  assert.match(template, /<view wx:if="\{\{!liveRoom\.observer && !liveRoom\.blocked\}\}" class="agent-composer/)
})

test('when the meeting ends the conversation gets a short closing line, like the one that opened it', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.applyClosedRoom('你超过 30 分钟没有说话，这场诊断已经自动结束了。')

  // 开场是「王老师已上线」，收场是「会议已结束」——同一种灰色小提示，一头一尾
  const notices = page.data.messages.filter((item) => item.kind === 'notice')
  assert.equal(notices[0].text, '王老师已上线')
  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.equal(page.data.liveRoom.closedNotice, '会议已结束')
  assert.match(page.data.liveRoom.closedReason, /30 分钟/)

  // 收场提示与结束卡片都在对话之后，学生不用往上翻；收场提示在卡片前
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  const list = template.indexOf('class="agent-message-list"')
  const marker = template.indexOf('{{liveRoom.closedNotice}}')
  const card = template.indexOf('class="live-room-closed"')
  assert.ok(list > 0 && list < marker && marker < card, '对话 → 会议已结束 → 结束卡片')
})

test('the teacher is told the course is not real until the last build step runs', () => {
  const { buildLiveSessionOpening } = require('../utils/live-session-brief')
  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report', subject: '数学' } })
  // 2026-09-22 线上实测：模型走完 create_stage、set_roster 就停了，学生的「我的课程」里一条都没有
  assert.match(text, /start_course_generation/)
  assert.match(text, /只建 stage、只 set_roster 不算建课/)
})

test('a registered course plan is shown to the student as a card and logged for the teacher', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: true, messages: [{ id: 'a1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' }] })
  const plan = (title) => ({ seriesTitle: title, lessons: [{ lesson: 1, title: '退位减法', knowledgePoint: '个位不够减', outline: '第1页 借1当10', prerequisites: [] }] })
  // 2026-10-04 线上实测：模型只登记方案不说话，学生直接被问「这样安排可以吗？」
  page.handleAgentEvent({ id: 2, type: 'tool_execution_start', data: { toolName: 'propose_course_plan', toolCallId: 'p1', args: plan('退位减法过关') } })
  const card = page.data.messages.find((item) => item.kind === 'plan')
  assert.equal(card.label, '课程安排')
  assert.equal(card.title, '退位减法过关')
  // 卡片排在「正在输入」气泡前面
  assert.equal(page.data.messages[page.data.messages.length - 1].isTyping, true)
  page.handleAgentEvent({ id: 3, type: 'tool_execution_end', data: { toolName: 'propose_course_plan', toolCallId: 'p1', isError: false } })
  assert.ok((page._roomAppend || []).some((item) => item.clientKey === 'plan-p1' && /【课程安排】退位减法过关/.test(item.content)))

  // 登记被拒的方案撤掉，不写进记录；之后再登记的是「调整后的课程安排」
  page.handleAgentEvent({ id: 4, type: 'tool_execution_start', data: { toolName: 'propose_course_plan', toolCallId: 'p2', args: plan('坏的') } })
  page.handleAgentEvent({ id: 5, type: 'tool_execution_end', data: { toolName: 'propose_course_plan', toolCallId: 'p2', isError: true } })
  assert.ok(!page.data.messages.some((item) => item.id === 'plan-p2'))
  assert.ok(!(page._roomAppend || []).some((item) => item.clientKey === 'plan-p2'))
  page.handleAgentEvent({ id: 6, type: 'tool_execution_start', data: { toolName: 'propose_course_plan', toolCallId: 'p3', args: plan('退位减法过关（调整）') } })
  assert.equal(page.data.messages.find((item) => item.id === 'plan-p3').label, '调整后的课程安排')
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  assert.match(template, /wx:elif="\{\{item\.kind === 'plan'\}\}"/)
})

test('the teacher is told the plan card is the only way the student sees the outline', () => {
  const { buildLiveSessionOpening } = require('../utils/live-session-brief')
  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report', subject: '数学' } })
  assert.match(text, /「课程安排」卡片/)
  assert.match(text, /不许只登记不说话/)
  assert.match(text, /没登记过方案就不能问「这样安排可以吗」/)
})

test('during the meeting nothing sits under the composer', () => {
  const { COMPOSER_NOTE } = require('../services/live-room-view')
  assert.equal(COMPOSER_NOTE, '')
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  // 空串的说明不渲染那一行
  assert.match(template, /liveRoom\.phase === 'waiting' \|\| liveRoom\.composerNote\)\}\}" class="agent-composer-note"/)
})

test('the building steps do not make 正在输入 flicker over and over', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: true, messages: [{ id: 'a1', role: 'assistant', text: '', isTyping: true, typingLabel: '王老师正在输入…' }] })
  // 建课那几步会连发好几条只带工具调用的助手消息
  page.handleAgentEvent({ id: 2, type: 'message_start', data: { message: { role: 'assistant' } } })
  page.handleAgentEvent({ id: 3, type: 'message_start', data: { message: { role: 'assistant' } } })
  const typing = page.data.messages.filter((item) => item.isTyping)
  assert.equal(typing.length, 1, '每轮只留一个「正在输入」，不来回闪')
})

test('the room never hands out a course card for a stage that is not being built', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  page.setData({ isSending: true, messages: [] })

  // create_stage 只是建了教室，课还没开始生成：这时候给链接，学生点进去什么都没有
  page.handleAgentEvent({ id: 5, type: 'stage_link', data: { stageId: 'AbC123', title: '分数的初步认识', url: 'https://x' } })
  assert.deepEqual(page.data.messages.filter((item) => item.kind === 'stage'), [], '没开始生成就不给课程卡')

  // start_course_generation 真的开跑了，卡片才出现
  page.handleAgentEvent({ id: 6, type: 'course_generation', data: { stageId: 'AbC123', title: '分数的初步认识', totalPages: 6 } })
  const cards = page.data.messages.filter((item) => item.kind === 'stage')
  assert.equal(cards.length, 1)
  assert.equal(cards[0].generating, true)

  // 之后的 stage_link 只是更新同一张卡，不再新开
  page.handleAgentEvent({ id: 7, type: 'stage_link', data: { stageId: 'AbC123', title: '分数的初步认识', url: 'https://x' } })
  assert.equal(page.data.messages.filter((item) => item.kind === 'stage').length, 1)
})

test('the room plans a series of lessons, not a single one, and only after more probing', () => {
  const { buildLiveSessionOpening } = require('../utils/live-session-brief')
  const text = buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report', subject: '数学' } })
  assert.match(text, /系列课程，不是一堂课/)
  assert.match(text, /3 到 10 节/)
  // 先多问几轮，问题都在最终确认之前问完；确认之后一句话都不再说，直接建课
  assert.match(text, /再聊几轮/)
  assert.match(text, /所有要问他的，都在他最终确认之前问完/)
  // 顺序：总纲 + 每节小纲（登记）→ 拿纲里的知识点问 → 调整、再登记 → 最终确认 → 建课
  const order = ['第一步：一次出总纲和每节小纲，用 propose_course_plan 登记', '「课程安排」卡片', '第二步：拿纲里的知识点去问他', '多选的 ask_user', '按结果调整方案', '再调用一次 propose_course_plan 登记调整后的最终方案', '先 create_folder']
    .map((marker) => text.indexOf(marker))
  order.forEach((index) => assert.ok(index > 0))
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, '纲 → 提问 → 调整 → 最终确认 → 建课，顺序不能乱')
  assert.match(text, /一节课只讲一个知识点/)
  assert.match(text, /前置知识点他不清楚，就补进对应那节/)
  assert.match(text, /他最终确认之前，不要调用 create_folder/)
  assert.match(text, /在这场会议里不适用/)
  assert.match(text, /他最终确认之后，一个字也不要再对他说，也不要再调用 ask_user/)
  assert.match(text, /一节都不能漏/)
  assert.match(text, /start_course_generation/)
  assert.match(text, /每一节都按一堂课的规格来/)
  assert.match(text, /不写每节小结、不发任何消息给他/)
  // 全程的原则：已掌握的当台阶，去教没掌握的
  assert.match(text, /拿他已经掌握的知识当台阶，去教他还没掌握的知识点/)
  assert.match(text, /已经掌握的点当台阶/)
  // 对学生不能出现 AI 口径
  assert.match(text, /不要出现「AI」/)
})

test('the room always carries the series-planning skill alongside the baseline interview', async (t) => {
  const { page } = await enterRoom(t, {}, at('2026-09-22T19:30:00+08:00'))
  assert.equal(page.data.activeLearningMode, 'study-plan')
  assert.equal(page.data.includeUniverse, true)
  const { buildAgentMessageText } = require('../utils/learning-options')
  const sent = buildAgentMessageText({
    text: '开场指令',
    universe: page.data.includeUniverse,
    modeId: page.data.activeLearningMode,
    baseline: { status: 'ready' },
    attachOptions: true,
    attachBaseline: true
  })
  assert.match(sent, /\/learner-baseline-interview \/curriculum-planner/)
})

test('the opening carries both the learning universe and the subject assessment', () => {
  const { buildLiveSessionOpening } = require('../utils/live-session-brief')
  const { buildAgentMessageText } = require('../utils/learning-options')
  const { summarizeLearnerBaseline } = require('../utils/learner-baseline')
  const baseline = summarizeLearnerBaseline(
    { current_grade: 3, semester: '上学期', school_stage: '小学', textbook_version: '人教版' },
    {
      status: 'ready',
      universe: { evidenceCount: 12 },
      subjects: [{ id: 1, subject_key: 'math', display_name: '数学', display_order: 1 }],
      topics: [{ id: 11, subject_id: 1, display_name: '平均分' }, { id: 12, subject_id: 1, display_name: '表内除法' }],
      masteries: [{ knowledge_topic_id: 11, status: 'mastered' }, { knowledge_topic_id: 12, status: 'weak' }]
    }
  )
  const sent = buildAgentMessageText({
    text: buildLiveSessionOpening({ subject: '数学', teacherName: '王老师', diagnosis: { status: 'no_report', subject: '数学' } }),
    universe: true,
    modeId: 'study-plan',
    baseline,
    attachOptions: true,
    attachBaseline: true
  })
  // 两份数据缺一不可：学科的摸底诊断表 + 学习宇宙的知识点掌握证据
  assert.match(sent, /<zhilu-live-session>/)
  assert.match(sent, /<zhilu-learner-context>/)
  assert.match(sent, /小学3年级/)
  assert.match(sent, /表内除法/)
})

test('the waiting card names the teacher once, and no longer promises a voice note', () => {
  const template = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxml'), 'utf8')
  const start = template.indexOf("liveRoom.phase === 'waiting'}}\" class=\"live-room-standby\"")
  // 切到下一张卡（被拒/已结束那张）为止，别被头像占位的 </view> 截短
  const card = template.slice(start, template.indexOf('liveRoom.blocked', start))
  // 名字只在「等待某某上线」里出现一次，上面那行单独的名字删掉了
  assert.ok(!card.includes('live-room-standby-name'))
  assert.match(card, /liveRoom\.waitingTitle/)
  // 「到点后老师会先发一段语音」这句整个删掉
  assert.ok(!template.includes('会先发一段语音'))
})

// ——— 结束之后还能进来看记录；取消的什么都不给 ——————————————————

function closedPayload(extra = {}) {
  return invitePayload({ status: 'closed', sessionId: 'sess-7' }, {
    closed: true,
    closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。',
    closedAt: '2026-09-22T20:00:00Z',
    ...extra
  })
}

test('a student reopening a finished meeting sees the conversation again, but cannot speak', async (t) => {
  const resumed = []
  const { page, calls, prompts } = loadPage({
    payload: closedPayload(),
    roomReplies: [{
      status: 'ready', serverNow: '', lastId: '40', closed: true,
      messages: [
        { id: '32', sender: 'teacher', kind: 'text', content: '你好', readAt: '2026-09-22T19:10:00Z', createdAt: '' },
        { id: '40', sender: 'ai', kind: 'text', content: '【会议结束】学生超过 30 分钟没有发言，诊断会议自动关闭。', readAt: '', createdAt: '' }
      ]
    }]
  })
  t.after(() => page.onUnload())
  page.resumeAgentSession = (id, options) => resumed.push([id, options])
  page.onLoad({ inviteToken: 'tk1' })
  page._isPageVisible = true
  await sleep(10)

  assert.equal(page.data.liveRoom.phase, 'closed')
  // 当时那场对话原样回放（选择题卡片也在），老师插过的话从会议记录补上
  assert.deepEqual(resumed, [['sess-7', { keepMessages: true }]])
  assert.ok(calls.syncs.length >= 1)
  assert.ok(page.data.messages.some((item) => item.text === '你好'), '老师插过的话还在')
  // 开场时的上线提示与课前语音都在，语音不再带红点
  assert.equal(page.data.messages[0].text, '王老师已上线')
  const voice = page.data.messages.find((item) => item.kind === 'voice')
  assert.equal(voice.unread, false)
  // 【会议结束】那行是写给老师看的记录，这边已经有收场提示和结束卡片，不再重复成气泡
  assert.ok(!page.data.messages.some((item) => /【会议结束】/.test(item.text || '')))
  // 不开场、不能再发言
  assert.deepEqual(prompts, [])
  page.setData({ isSending: false })
  page.sendMessage('老师我还想问')
  assert.ok(!page.data.messages.some((item) => item.text === '老师我还想问'))
  assert.match(calls.toasts[calls.toasts.length - 1], /已结束/)
})

test('a parent reopening a finished meeting reads the whole record, and still cannot speak', async (t) => {
  const resumed = []
  const { page, calls } = loadPage({
    payload: closedPayload({ viewer: 'guardian' }),
    roomReplies: [{
      status: 'ready', serverNow: '', viewer: 'guardian', lastId: '14', closed: true,
      messages: [
        { id: '12', sender: 'ai', kind: 'text', content: '我看了你的数学摸底', readAt: '', createdAt: '' },
        { id: '13', sender: 'student', kind: 'text', content: '二次函数', readAt: '', createdAt: '' },
        { id: '14', sender: 'teacher', kind: 'text', content: '先别急着算', readAt: '', createdAt: '' }
      ]
    }]
  })
  t.after(() => page.onUnload())
  page.resumeAgentSession = (id, options) => resumed.push([id, options])
  page.onLoad({ inviteToken: 'tk1' })
  page._isPageVisible = true
  await sleep(10)

  assert.equal(page.data.liveRoom.phase, 'closed')
  assert.equal(page.data.liveRoom.observer, true)
  // 家长不接手孩子的会话，整场从会议记录读
  assert.deepEqual(resumed, [])
  const spoken = page.data.messages.filter((item) => item.roomId)
  assert.deepEqual(spoken.map((item) => item.text), ['我看了你的数学摸底', '二次函数', '先别急着算'])
  assert.deepEqual(spoken.map((item) => item.role), ['assistant', 'user', 'assistant'])
  page.setData({ isSending: false })
  page.sendMessage('家长补一句')
  assert.ok(!page.data.messages.some((item) => item.text === '家长补一句'))
})

test('a meeting the teacher cancelled shows nothing — no record, no replay', async (t) => {
  const resumed = []
  const { page, calls, prompts } = loadPage({ payload: { status: 'canceled', invite: null } })
  t.after(() => page.onUnload())
  page.resumeAgentSession = (id, options) => resumed.push([id, options])
  page.onLoad({ inviteToken: 'tk1' })
  page._isPageVisible = true
  await sleep(10)

  assert.equal(page.data.liveRoom.blocked, true)
  assert.match(page.data.liveRoom.stateTitle, /已取消/)
  assert.deepEqual(page.data.messages, [], '取消的会议不给任何记录')
  assert.deepEqual(resumed, [])
  assert.deepEqual(calls.syncs, [])
  assert.deepEqual(prompts, [])
})
