const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pageSource = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.js'), 'utf8')

function room(messages, extra = {}) {
  return { status: 'ready', serverNow: '', invite: { inviteId: '5', subject: '数学', status: 'active' }, messages, lastId: messages.length ? messages[messages.length - 1].id : '0', ...extra }
}

const FIRST = [
  { id: '1', sender: 'teacher', kind: 'voice', content: '课前语音', readAt: '2026-09-22T19:01:00+08:00', createdAt: '2026-09-22T19:00:05+08:00' },
  { id: '2', sender: 'ai', kind: 'text', content: '我看了你的数学摸底。', readAt: '2026-09-22T19:01:10+08:00', createdAt: '2026-09-22T19:01:10+08:00' },
  { id: '3', sender: 'student', kind: 'text', content: '二次函数', readAt: '', createdAt: '2026-09-22T19:02:00+08:00' }
]

// setData 的路径写法（messages[0].playing）照微信的语义落到对应字段上
function applyPatch(data, patch) {
  Object.keys(patch).forEach((key) => {
    const path = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let target = data
    for (let i = 0; i < path.length - 1; i += 1) target = target[path[i]]
    target[path[path.length - 1]] = patch[key]
  })
}

function loadPage({ watchReplies = [room(FIRST)], sayReply = null, asr = { text: '先看第二步', warning: '' } } = {}) {
  let definition
  const calls = { watches: [], says: [], toasts: [], navigations: [], intervals: 0, clearedIntervals: 0, failNext: false, setDataCount: 0, rects: null, timeouts: [], transcribed: [], recorder: { starts: 0, stops: 0, cancels: 0 }, audio: null, modals: [] }
  const bridge = {
    attach(owner) { this.owner = owner },
    start(owner) { calls.recorder.starts += 1; owner._recorderSessionId = calls.recorder.starts; return owner._recorderSessionId },
    stop() { calls.recorder.stops += 1; return true },
    cancelOwner() { calls.recorder.cancels += 1 }
  }
  const voiceInput = require('../utils/voice-input')
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    setInterval: () => { calls.intervals += 1; return 9 },
    clearInterval: () => { calls.clearedIntervals += 1 },
    // 计时器不自己走：用例需要时手动触发（按住说话的那 320ms）
    setTimeout: (callback) => { calls.timeouts.push(callback); return calls.timeouts.length },
    clearTimeout: () => {},
    console,
    encodeURIComponent,
    decodeURIComponent,
    Date,
    wx: {
      showToast: (options) => calls.toasts.push(options.title),
      showLoading: () => {},
      hideLoading: () => {},
      showModal: (options) => calls.modals.push(options.title),
      hideKeyboard: () => {},
      navigateTo: (options) => calls.navigations.push(options.url),
      stopPullDownRefresh: () => {},
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, safeArea: { bottom: 778 } }),
      getSetting: (options) => options.success({ authSetting: { 'scope.record': true } }),
      createInnerAudioContext() {
        const audio = { src: '', plays: 0, pauses: 0, stops: 0, handlers: {} }
        for (const name of ['Ended', 'Stop', 'Error']) audio['on' + name] = (callback) => { audio.handlers[name] = callback }
        audio.play = () => { audio.plays += 1 }
        audio.pause = () => { audio.pauses += 1 }
        audio.stop = () => { audio.stops += 1 }
        audio.destroy = () => {}
        calls.audio = audio
        return audio
      },
      // 量位置：rects 由用例摆好「记录列表」与「记录末尾」的位置
      createSelectorQuery() {
        const query = {
          select: () => ({ boundingClientRect: () => query }),
          exec: (callback) => callback(calls.rects ? [calls.rects.list, calls.rects.tail] : [null, null])
        }
        return query
      }
    },
    require(name) {
      if (name.endsWith('/live-room-service')) {
        return {
          watchTeacherRoom: async (request) => {
            calls.watches.push(request)
            if (calls.failNext) throw new Error('断网')
            return watchReplies.shift() || room([])
          },
          sayAsTeacher: async (request) => { calls.says.push(request); return sayReply || room([]) }
        }
      }
      if (name.endsWith('/teacher-room-view')) return require('../services/teacher-room-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => {} }
      if (name.endsWith('/utils/navigation')) return { getNavigationMetrics: () => ({ statusBarHeight: 44, navigationBarHeight: 40, contentTop: 84 }) }
      if (name.endsWith('/utils/voice-input')) {
        return {
          ...voiceInput,
          getRecorderBridge: () => bridge,
          transcribeVoiceChunks: async (chunks) => { calls.transcribed.push(chunks); return asr }
        }
      }
      throw new Error(`Unexpected import ${name}`)
    }
  })

  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { calls.setDataCount += 1; applyPatch(this.data, patch); if (callback) callback() }
  }
  return { page, calls }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('the teacher sees the whole meeting, with his own lines and the AI ones told apart', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5', subject: '数学' })
  await page.loadRoom()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.room.title, '数学专属诊断会议', '标题和学生诊断室同一个说法')
  assert.deepEqual(Array.from(page.data.messages, (item) => item.side), ['left', 'left', 'right'], '老师方向在左、学生在右，和学生屏幕一致')
  assert.deepEqual(Array.from(page.data.messages, (item) => item.tag || ''), ['课前语音', 'AI 代答', ''])
  assert.equal(page.data.summary, '共 3 条 · 学生已全部读到')
  assert.equal(calls.watches[0].since, '0')
  page.onUnload()
})

test('polling only asks for what it has not seen, and never shows a line twice', async () => {
  const later = room([{ id: '4', sender: 'student', kind: 'text', content: '这个不会', readAt: '', createdAt: '2026-09-22T19:04:00+08:00' }])
  const { page, calls } = loadPage({ watchReplies: [room(FIRST), later, later] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  await page.loadRoom()
  await page.loadRoom()
  assert.equal(calls.watches[1].since, '3')
  assert.equal(calls.watches[2].since, '4')
  assert.equal(page.data.messages.length, 4, '同一条重复返回不能在屏幕上出现两次')
  page.onUnload()
})

test('a line the teacher types goes out as the teacher and lands in the record', async () => {
  const said = room(FIRST.concat([{ id: '4', sender: 'teacher', kind: 'text', content: '先别急着算', readAt: '', createdAt: '2026-09-22T19:05:00+08:00' }]))
  const { page, calls } = loadPage({ sayReply: said })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  page.handleInput({ detail: { value: '先别急着算' } })
  await page.handleSend()
  assert.equal(calls.says[0].inviteId, '5')
  assert.equal(calls.says[0].text, '先别急着算')
  assert.match(calls.says[0].clientKey, /^t-\d+$/, '幂等键：重试不会发两遍')
  assert.equal(page.data.draft, '', '发出去之后输入框清空')
  const last = page.data.messages[page.data.messages.length - 1]
  assert.equal(last.tag, '我发的')
  assert.equal(last.readLabel, '未读', '学生还没看到')
  page.onUnload()
})

test('an empty draft sends nothing', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  page.handleInput({ detail: { value: '   ' } })
  await page.handleSend()
  assert.deepEqual(calls.says, [])
  page.onUnload()
})

test('a backend refusal stops the polling and says why, instead of an empty screen', async () => {
  const { page, calls } = loadPage({ watchReplies: [{ status: 'not_deployed', messages: [], lastId: '' }] })
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  assert.equal(page.data.loadState, 'blocked')
  assert.match(page.data.stateTitle, /还没部署/)
  assert.ok(calls.clearedIntervals >= 1, '读不到就别接着轮询')
  page.onUnload()
})

test('a network blip does not wipe the transcript already on screen', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  assert.equal(page.data.messages.length, 3)
  // 已经有记录时读失败只是这一轮没拿到，不该把画面换成错误页
  calls.failNext = true
  await page.loadRoom()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.messages.length, 3)
  page.onUnload()
})

test('the composer is the same one as the chat page, not a second implementation', () => {
  const template = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxss'), 'utf8')
  const chatStyle = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  for (const name of ['agent-composer', 'agent-composer-bar', 'agent-input', 'agent-send-button']) {
    assert.match(template, new RegExp(`class="[^"]*\\b${name}\\b`), `${name} 应沿用对话页的类名`)
  }
  // 关键数值与对话页一致：抄歪了就不是「同一个输入框」了
  for (const rule of [
    '.agent-composer-bar { display: flex; align-items: center; min-height: 104rpx; padding: 6rpx 18rpx;',
    '.agent-input { min-width: 0; flex: 1; height: 84rpx; margin: 0 14rpx; color: #2D3931; font-size: 29rpx;',
    '.agent-send-button.is-enabled, .agent-send-button.is-sending { background: #FD7C02; }'
  ]) {
    assert.ok(style.includes(rule), `样式与对话页不一致：${rule.slice(0, 40)}`)
    assert.ok(chatStyle.includes(rule), `对话页本身已改过这条规则，需要同步：${rule.slice(0, 40)}`)
  }
  // 发送图标走后端素材（界面图片一律后端下发）
  assert.match(template, /UA\.src\(ui, '\.\.\/\.\.\/assets\/agent-send\.svg'\)/)
  assert.ok(!/class="room-(composer|input|send)\b/.test(template), '旧的自绘输入框应已移除')
})

test('the composer sits above the home indicator like the chat page does', async () => {
  const { page } = loadPage()
  page.onLoad({ inviteId: '5' })
  assert.equal(page.data.composerBottomOffset, 52, '812-778=34，34+18=52')
  page.onUnload()
})

// 列表底边 700，底部给输入框留白 52 + 112 = 164，记录末尾停在 536 就是滚到底了
const AT_BOTTOM = { list: { bottom: 700 }, tail: { bottom: 540 } }
const SCROLLED_UP = { list: { bottom: 700 }, tail: { bottom: 2400 } }
const LATER = room([{ id: '4', sender: 'student', kind: 'text', content: '这个不会', readAt: '', createdAt: '2026-09-22T19:04:00+08:00' }])

function scrollTo(page, calls, rects) {
  // 手指按下、松开、滚停后量一次位置（测试里计时器不走，直接量）
  page.handleListTouchStart()
  page.handleListTouchEnd()
  calls.rects = rects
  page.measureFollow()
}

test('polling with nothing new leaves the transcript and the scroll position alone', async () => {
  const { page, calls } = loadPage({ watchReplies: [room(FIRST), room([])] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  const scrollTop = page.data.scrollTop
  assert.ok(scrollTop > 0, '第一次读到就停在最新一条')
  const before = calls.setDataCount
  await page.loadRoom()
  assert.equal(calls.setDataCount, before, '没有新消息不重绘整列，以前每 4 秒都把老师拉回底部')
  assert.equal(page.data.scrollTop, scrollTop)
  page.onUnload()
})

test('a teacher who scrolled up to read is not dragged back down when new lines arrive', async () => {
  const { page, calls } = loadPage({ watchReplies: [room(FIRST), LATER] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  scrollTo(page, calls, SCROLLED_UP)
  assert.equal(page.data.showJump, true, '翻上去就给回到底部的按钮')
  assert.equal(page.data.unseenCount, 0)
  const scrollTop = page.data.scrollTop
  await page.loadRoom()
  assert.equal(page.data.messages.length, 4, '新消息照样进记录')
  assert.equal(page.data.scrollTop, scrollTop, '但不动老师正在看的位置')
  assert.equal(page.data.unseenCount, 1)

  page.handleJumpToBottom()
  assert.ok(page.data.scrollTop > scrollTop, '点按钮回到底部')
  assert.equal(page.data.showJump, false)
  assert.equal(page.data.unseenCount, 0)
  page.onUnload()
})

test('a teacher sitting at the latest line keeps following new ones', async () => {
  const { page, calls } = loadPage({ watchReplies: [room(FIRST), LATER] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  scrollTo(page, calls, AT_BOTTOM)
  assert.equal(page.data.showJump, false)
  const scrollTop = page.data.scrollTop
  await page.loadRoom()
  assert.ok(page.data.scrollTop > scrollTop, '停在最新处时新消息来了跟着滚')
  assert.equal(page.data.unseenCount, 0)
  page.onUnload()
})

test('a finger on the list stops the following before the list even moves', async () => {
  const { page } = loadPage({ watchReplies: [room(FIRST), LATER] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  const scrollTop = page.data.scrollTop
  page.handleListTouchStart()
  await page.loadRoom()
  assert.equal(page.data.scrollTop, scrollTop, '按住记录时下发滚动会和手指抢位置')
  page.onUnload()
})

test('the teacher\'s own line brings the view down even when scrolled up', async () => {
  const said = room([{ id: '4', sender: 'teacher', kind: 'text', content: '先别急着算', readAt: '', createdAt: '2026-09-22T19:05:00+08:00' }])
  const { page, calls } = loadPage({ sayReply: said })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  scrollTo(page, calls, SCROLLED_UP)
  const scrollTop = page.data.scrollTop
  page.handleInput({ detail: { value: '先别急着算' } })
  await page.handleSend()
  assert.ok(page.data.scrollTop > scrollTop, '自己发的话要看得到')
  assert.equal(page.data.showJump, false)
  page.onUnload()
})

/* ---------- 和学生诊断室同一套：老师头像与名字、课前语音条、按住说话 ---------- */

const EXTRAS = { teacherName: '王建国', teacherAvatarUrl: 'https://cdn/a.png', voiceUrl: 'https://cdn/v.mp3?sig=1', voiceDurationMs: 42000, scheduledOnlineAt: '2026-09-22T19:00:00+08:00' }

test('the teacher\'s face, name and the voice link from the first read survive the incremental polls', async () => {
  const first = room(FIRST, { serverNow: '2026-09-22T19:05:00+08:00', invite: { inviteId: '5', subject: '数学', status: 'scheduled', ...EXTRAS } })
  // 增量轮询的 invite 不带头像、名字、语音地址（后端只在从头读时签发）
  const later = room([{ id: '4', sender: 'student', kind: 'text', content: '这个不会', readAt: '', createdAt: '2026-09-22T19:04:00+08:00' }], { invite: { inviteId: '5', subject: '数学', status: 'scheduled' } })
  const { page } = loadPage({ watchReplies: [first, later] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  await page.loadRoom()
  assert.equal(page.data.room.teacherName, '王建国老师')
  assert.equal(page.data.room.teacherAvatarUrl, 'https://cdn/a.png')
  assert.equal(page.data.room.voiceUrl, 'https://cdn/v.mp3?sig=1')
  assert.equal(page.data.room.onlineNotice, '王建国老师已上线')
  assert.equal(page.data.messages[0].durationText, '42″', '语音条带时长，和学生那边一样')
  page.onUnload()
})

test('the pre-class voice plays and pauses from its bar', async () => {
  const first = room(FIRST, { invite: { inviteId: '5', subject: '数学', status: 'scheduled', ...EXTRAS } })
  const { page, calls } = loadPage({ watchReplies: [first] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  const tap = { currentTarget: { dataset: { id: '1' } } }
  page.handleVoicePlay(tap)
  assert.equal(calls.audio.src, 'https://cdn/v.mp3?sig=1')
  assert.equal(calls.audio.plays, 1)
  assert.equal(page.data.messages[0].playing, true)
  page.handleVoicePlay(tap)
  assert.equal(calls.audio.pauses, 1, '再点一下暂停')
  assert.equal(page.data.messages[0].playing, false)
  page.handleVoicePlay(tap)
  calls.audio.handlers.Ended()
  assert.equal(page.data.messages[0].playing, false, '放完波形停下')
  page.onUnload()
})

test('without a voice link (backend not redeployed yet) the bar says so instead of playing silence', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  page.handleVoicePlay({ currentTarget: { dataset: { id: '1' } } })
  assert.equal(calls.audio, null)
  assert.match(calls.toasts[0], /读不到这段语音/)
  page.onUnload()
})

function holdAndSpeak(page, calls, { moveTo = null, bytes = 6400 } = {}) {
  page.handleVoiceButtonTap()
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  calls.timeouts.pop()()
  const sessionId = page._recorderSessionId
  page._handleRecorderStart(null, sessionId)
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(bytes).buffer }, sessionId)
  if (moveTo !== null) page.handleSpeakTouchMove({ touches: [{ pageY: moveTo }] })
  page.handleSpeakTouchEnd()
}

test('holding to speak records, turns the speech into text and sends it as the teacher', async () => {
  const said = room([{ id: '4', sender: 'teacher', kind: 'text', content: '先看第二步', readAt: '', createdAt: '2026-09-22T19:05:00+08:00' }])
  const { page, calls } = loadPage({ sayReply: said })
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  page.handleVoiceButtonTap()
  assert.equal(page.data.voiceMode, true, '点话筒切到「按住说话」')
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  assert.equal(calls.recorder.starts, 0, '只是碰一下不算，按住一会儿才开始录')
  calls.timeouts.pop()()
  assert.equal(page.data.voiceRecognizing, true)
  assert.equal(calls.recorder.starts, 1)
  page._handleRecorderStart(null, page._recorderSessionId)
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(6400).buffer }, page._recorderSessionId)
  page.handleSpeakTouchEnd()
  await flush()
  await flush()
  assert.equal(page.data.voiceRecognizing, false)
  assert.equal(calls.transcribed.length, 1)
  assert.equal(calls.says[0].text, '先看第二步', '转出来的字以老师的身份发出去')
  assert.equal(page.data.messages[page.data.messages.length - 1].tag, '我发的')
  page.onUnload()
})

test('sliding up before letting go throws the recording away', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  holdAndSpeak(page, calls, { moveTo: 600 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  assert.deepEqual(calls.says, [])
  page.onUnload()
})

test('a blip too short to be speech is not uploaded', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  holdAndSpeak(page, calls, { bytes: 1000 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  assert.match(calls.toasts[calls.toasts.length - 1], /太短/)
  page.onUnload()
})

test('a failed recognition says why and sends nothing', async () => {
  const { page, calls } = loadPage({ asr: { text: '', warning: '没听清，请再试一次' } })
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  holdAndSpeak(page, calls)
  await flush()
  await flush()
  assert.deepEqual(calls.says, [])
  assert.equal(calls.toasts[calls.toasts.length - 1], '没听清，请再试一次')
  page.onUnload()
})

test('spoken text that could not be sent goes back into the input box instead of vanishing', async () => {
  const { page, calls } = loadPage({ sayReply: { status: 'unavailable', messages: [], lastId: '' } })
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  holdAndSpeak(page, calls)
  await flush()
  await flush()
  assert.equal(calls.says.length, 1)
  assert.equal(page.data.draft, '先看第二步')
  assert.equal(page.data.voiceMode, false, '切回键盘，老师改两个字就能重发')
  page.onUnload()
})

test('leaving the page mid-recording drops it without sending', async () => {
  const { page, calls } = loadPage()
  page.onLoad({ inviteId: '5' })
  page.onShow()
  await page.loadRoom()
  page.handleVoiceButtonTap()
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  calls.timeouts.pop()()
  page.onHide()
  assert.equal(page.data.voiceRecognizing, false)
  assert.ok(calls.recorder.stops >= 1)
  page.handleSpeakTouchEnd()
  await flush()
  assert.deepEqual(calls.transcribed, [])
  page.onUnload()
})

/* ---------- 会议结束 ---------- */

const CLOSED_ROW = { id: '9', sender: 'ai', kind: 'text', content: '【会议结束】学生超过 30 分钟没有发言，诊断会议自动关闭。', readAt: '', createdAt: '2026-09-22T19:40:00+08:00' }

test('a closed meeting ends like the student\'s does: closing card, no composer, no more sending', async () => {
  const closed = room(FIRST.concat([CLOSED_ROW]), { invite: { inviteId: '5', subject: '数学', status: 'closed', closedReason: '你超过 30 分钟没有说话，这场诊断已经自动结束了。' } })
  const { page, calls } = loadPage({ watchReplies: [closed] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  assert.equal(page.data.room.phase, 'closed')
  assert.match(page.data.room.closedReason, /^学生超过 30 分钟/)
  assert.equal(page.data.messages.length, 3, '结束那一行不画成 AI 说的话')
  page.handleInput({ detail: { value: '还在吗' } })
  await page.handleSend()
  assert.deepEqual(calls.says, [])
  const template = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxml'), 'utf8')
  assert.match(template, /<view wx:if="\{\{room\.phase !== 'closed'\}\}" class="agent-composer"/, '结束后输入框收起')
  page.onUnload()
})

test('a meeting closing while the teacher watches redraws the room without touching the transcript', async () => {
  const open = room(FIRST, { invite: { inviteId: '5', subject: '数学', status: 'scheduled' } })
  const nowClosed = room([], { invite: { inviteId: '5', subject: '数学', status: 'closed' } })
  const { page } = loadPage({ watchReplies: [open, nowClosed] })
  page.onLoad({ inviteId: '5' })
  await page.loadRoom()
  const messages = page.data.messages
  const scrollTop = page.data.scrollTop
  await page.loadRoom()
  assert.equal(page.data.room.phase, 'closed')
  assert.equal(page.data.messages, messages, '列表没有重画')
  assert.equal(page.data.scrollTop, scrollTop)
  page.onUnload()
})

test('the page is the student\'s diagnosis room: custom top bar, voice bar and voice composer from the same styles', () => {
  const template = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.wxss'), 'utf8')
  const chatStyle = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../teacher/live-room/index.json'), 'utf8'))
  assert.equal(config.navigationStyle, 'custom', '顶栏和诊断室一样自己画')
  for (const name of ['agent-ambient', 'agent-topbar', 'agent-activity-voice', 'live-msg-sender', 'live-msg-meta', 'agent-voice-speak-button', 'voice-demo-status', 'live-room-standby', 'live-room-closed']) {
    assert.match(template, new RegExp(`class="[^"]*\\b${name}\\b`), `${name} 应沿用诊断室的类名`)
  }
  for (const rule of [
    '.agent-message-user .agent-message-bubble { padding: 16rpx 24rpx; border-radius: 28rpx 28rpx 8rpx 28rpx; background: #DCEEFF; color: #222A25; }',
    '.agent-activity-voice { display: flex; min-width: 200rpx; max-width: 420rpx; padding: 24rpx 28rpx;',
    '.live-msg-avatar { display: block; flex: none; width: 40rpx; height: 40rpx;',
    '.agent-voice-speak-button { display: flex; flex: 1; align-items: center; justify-content: center; height: 84rpx;',
    '.agent-ambient { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;'
  ]) {
    assert.ok(style.includes(rule), `样式与诊断室不一致：${rule.slice(0, 48)}`)
    assert.ok(chatStyle.includes(rule), `诊断室本身已改过这条规则，需要同步：${rule.slice(0, 48)}`)
  }
  // 话筒与键盘图标同样走后端素材
  assert.match(template, /UA\.src\(ui, '\.\.\/\.\.\/assets\/agent-voice\.svg'\)/)
  assert.match(template, /UA\.src\(ui, '\.\.\/\.\.\/assets\/keyboard-icon\.svg'\)/)
  assert.ok(!/🎤/.test(template), '课前语音不再是一块写着「课前语音」的橙色字')
})
