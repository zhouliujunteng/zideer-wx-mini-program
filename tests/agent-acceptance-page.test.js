const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 第三关「当小老师」（learning/agent-acceptance，2026-11-17，docs/当小老师记录.md）：孩子按住说话给 AI 同学讲课，
// 同学们按顺序出声（每句一个声音）、轮流提问，黑板点亮讲清的事；默认「按住说话」（2026-10-04 用户规则）。

const pageSource = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.js'), 'utf8')
const COURSE = { stageId: 'stage-1', title: '分数的约分' }
const PEERS = [
  { id: 'xiaoman', name: '小满', level: 'good', stars: 0 },
  { id: 'doudou', name: '豆豆', level: 'medium', stars: 0 },
  { id: 'ale', name: '阿乐', level: 'weak', stars: 0 }
]

function classState(extra = {}) {
  return {
    peers: PEERS,
    board: [{ topic: '什么是约分', state: 'todo' }, { topic: '约分后大小变不变', state: 'todo' }],
    done: 0,
    total: 2,
    rounds: 0,
    maxRounds: 8,
    asking: null,
    finished: false,
    ...extra
  }
}

function reply(status, { turns = [], peerClass = null, lines = [], ...extra } = {}) {
  return {
    course: COURSE,
    acceptance: { status, learningComplete: true, learning: { completed: 3, total: 3 }, topics: [], ...extra },
    turns,
    peerClass,
    lines
  }
}

const GREETING = [
  { peer: 'xiaoman', text: '小老师好！', kind: 'greet' },
  { peer: 'doudou', text: '今天讲什么呀？', kind: 'greet' },
  { peer: 'ale', text: '讲慢一点哦。', kind: 'greet' }
]
const OPENED = reply('in_progress', {
  turns: GREETING.map((line) => ({ role: 'assistant', content: line.text, speaker: line.peer })),
  peerClass: classState(),
  lines: GREETING
})
// 进页面时读到的正在上的课（GET 不带 lines）
const IN_CLASS = { ...OPENED, lines: undefined }
const ROUND_LINES = [
  { peer: 'xiaoman', text: '我学会了什么是约分！', kind: 'react', gained: 1 },
  { peer: 'doudou', text: '嗯嗯。', kind: 'react', gained: 0 },
  { peer: 'ale', text: '是只除分子吗？', kind: 'ask', askKind: 'confused' }
]
const AFTER_ROUND = reply('in_progress', {
  turns: [...IN_CLASS.turns, { role: 'user', content: '约分就是分子分母同时除以同一个数', speaker: 'learner' },
    ...ROUND_LINES.map((line) => ({ role: 'assistant', content: line.text, speaker: line.peer }))],
  peerClass: classState({
    rounds: 1,
    done: 1,
    board: [{ topic: '什么是约分', state: 'done' }, { topic: '约分后大小变不变', state: 'todo' }],
    peers: [{ ...PEERS[0], stars: 1 }, PEERS[1], PEERS[2]],
    asking: { peer: 'ale', kind: 'confused', topic: '什么是约分' }
  }),
  lines: ROUND_LINES
})

function loadPage({ loads = [reply('not_started')], sends = [], asr = { text: '约分就是分子分母同时除以同一个数', warning: '' }, setting = { 'scope.record': true }, authorize = true, modalConfirm = false, storage = {} } = {}) {
  let definition
  const calls = { loads: 0, sends: [], toasts: [], redirects: [], modals: [], timeouts: [], transcribed: [], authorizes: 0, sequences: [], recorder: { starts: 0, stops: 0, cancels: 0 } }
  const bridge = {
    attach() {},
    start(owner) { calls.recorder.starts += 1; owner._recorderSessionId = calls.recorder.starts; return owner._recorderSessionId },
    stop() { calls.recorder.stops += 1; return true },
    cancelOwner() { calls.recorder.cancels += 1 }
  }
  const voiceInput = require('../utils/voice-input')
  const peerClassView = require('../utils/peer-class-view')
  vm.runInNewContext(pageSource, {
    Page(config) { definition = config },
    setInterval: () => 7,
    clearInterval: () => {},
    // 计时器不自己走：用例需要时手动触发（按住说话的那 320ms）
    setTimeout: (callback) => { calls.timeouts.push(callback); return calls.timeouts.length },
    clearTimeout: () => {},
    getCurrentPages: () => [{}],
    console,
    encodeURIComponent,
    Date,
    wx: {
      showToast: (options) => calls.toasts.push(options.title),
      showLoading: () => {},
      hideLoading: () => {},
      showModal: (options) => { calls.modals.push(options); if (options.success) options.success({ confirm: modalConfirm }) },
      hideKeyboard: () => {},
      redirectTo: (options) => calls.redirects.push(options.url),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, safeArea: { bottom: 778 } }),
      getSetting: (options) => options.success({ authSetting: setting }),
      authorize: (options) => { calls.authorizes += 1; if (authorize) options.success(); else options.fail() },
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value }
    },
    require(name) {
      if (name.endsWith('/services/identity')) {
        return {
          loadAgentCourseAcceptance: async () => { calls.loads += 1; return loads.shift() || reply('not_started') },
          sendAgentCourseAcceptance: async (stageId, message, options) => {
            calls.sends.push({ message, ...options })
            const next = sends.shift()
            if (next instanceof Error) throw next
            return next || IN_CLASS
          }
        }
      }
      if (name.endsWith('/services/learn-speech')) {
        return {
          // 朗读不自己走：用例里手动推进每一句（start / end），或整串读完（done）
          playSequence(items, handlers) {
            const sequence = { items, handlers, stopped: false }
            sequence.stop = () => { sequence.stopped = true; handlers.onDone({ stopped: true }) }
            sequence.playAll = () => {
              items.forEach((item, index) => { handlers.onStart(index); handlers.onEnd(index) })
              handlers.onDone({ stopped: false })
            }
            calls.sequences.push(sequence)
            return { stop: () => sequence.stop() }
          },
          stopSpeech() {}
        }
      }
      if (name.endsWith('/services/learning-streak')) return { loadCheckin: async () => ({}) }
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => {} }
      if (name.endsWith('/utils/navigation')) return { getNavigationMetrics: () => ({ statusBarHeight: 44, navigationBarHeight: 40, contentTop: 84 }) }
      if (name.endsWith('/utils/peer-class-view')) return peerClassView
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
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() }
  }
  return { page, calls, storage }
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

async function openClass(options = {}) {
  const loaded = loadPage({ loads: [IN_CLASS], ...options })
  loaded.page.onLoad({ stageId: 'stage-1' })
  loaded.page.onShow()
  await flush()
  return loaded
}

function holdAndSpeak(page, calls, { moveTo = null, bytes = 6400 } = {}) {
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  calls.timeouts.pop()()
  const sessionId = page._recorderSessionId
  page._handleRecorderStart(null, sessionId)
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(bytes).buffer }, sessionId)
  if (moveTo !== null) page.handleSpeakTouchMove({ touches: [{ pageY: moveTo }] })
  page.handleSpeakTouchEnd()
}

test('starting the class asks for the microphone, the peers greet one by one in their own voices', async () => {
  const { page, calls } = loadPage({ sends: [OPENED] })
  page.onLoad({ stageId: 'stage-1' })
  page.onShow()
  await flush()
  assert.equal(page.data.state, 'intro')
  assert.deepEqual(page.data.peers.map((peer) => peer.id), ['xiaoman', 'doudou', 'ale'], '开课前也画出三个同学')
  await page.start()
  assert.deepEqual(calls.sends, [{ message: '', peerClass: true, finish: false, restart: false }])
  assert.equal(page.data.state, 'class')
  assert.equal(page.data.voiceMode, true, '默认就是「按住说话」')
  const sequence = calls.sequences[0]
  assert.deepEqual(sequence.items.map((item) => item.voice), ['xiaoman', 'doudou', 'ale'])
  assert.equal(page.data.playing, true)
  assert.equal(page.data.hint, '同学们在说…')
  assert.equal(page.data.peers[1].bubble, '', '还没读到的同学先不亮气泡')
  sequence.handlers.onStart(0)
  assert.equal(page.data.peers[0].speaking, true)
  assert.equal(page.data.peers[0].bubble, '小老师好！')
  assert.equal(page.data.peers[0].mood, 'happy')
  sequence.handlers.onEnd(0)
  sequence.handlers.onStart(1)
  sequence.handlers.onEnd(1)
  sequence.handlers.onStart(2)
  sequence.handlers.onEnd(2)
  sequence.handlers.onDone({ stopped: false })
  assert.equal(page.data.playing, false)
  assert.equal(page.data.hint, '先从黑板第一件事讲起，讲给同学们听吧')
  assert.deepEqual(page.data.board.items.map((item) => item.state), ['todo', 'todo'])
  page.onUnload()
})

test('a spoken segment goes to the peers, they react in order and the asker keeps his face until answered', async () => {
  const { page, calls } = await openClass({ sends: [AFTER_ROUND] })
  holdAndSpeak(page, calls)
  await flush()
  assert.equal(calls.transcribed.length, 1)
  assert.deepEqual(calls.sends, [{ message: '约分就是分子分母同时除以同一个数', peerClass: true, finish: false, restart: false }])
  const sequence = calls.sequences[calls.sequences.length - 1]
  assert.deepEqual(sequence.items.map((item) => item.voice), ['xiaoman', 'doudou', 'ale'])
  sequence.playAll()
  assert.equal(page.data.board.done, 1)
  assert.equal(page.data.peers[0].mood, 'happy', '学会了的举着笔记本')
  assert.deepEqual(page.data.peers[0].starIcons, [true, false])
  assert.equal(page.data.peers[2].mood, 'confused', '记混了在挠头')
  assert.equal(page.data.peers[2].asking, true)
  assert.equal(page.data.hint, '阿乐在提问，讲给他听吧')
  assert.equal(page.data.records[page.data.records.length - 4].name, '我（小老师）', '课堂记录里有小老师讲的那段')
  page.onUnload()
})

test('the hint says the peers are taking notes while the segment is being graded', async () => {
  let answer
  const { page, calls } = await openClass()
  page.handleKeyboardButtonTap()
  page.handleInput({ detail: { value: '约分' } })
  calls.sends.length = 0
  const original = page.post
  page.post = function (body) {
    this.render({ sending: true })
    return new Promise((resolve) => { answer = () => { this.setData({ sending: false }); this.apply(AFTER_ROUND); resolve() } })
  }
  const sending = page.handleSend()
  assert.equal(page.data.hint, '同学们在记笔记…')
  assert.equal(page.data.lastSaid, '约分', '提示下面一行显示刚讲的那段')
  answer()
  await sending
  assert.equal(page.data.lastSaid, '')
  page.post = original
  page.onUnload()
})

test('holding to speak while the peers are talking stops them and everyone listens', async () => {
  const { page, calls } = await openClass({ sends: [AFTER_ROUND] })
  page.handleKeyboardButtonTap()
  page.handleInput({ detail: { value: '约分就是同时除以同一个数' } })
  await page.handleSend()
  const sequence = calls.sequences[calls.sequences.length - 1]
  sequence.handlers.onStart(0)
  assert.equal(page.data.playing, true)
  page.handleVoiceButtonTap()
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  assert.equal(sequence.stopped, true, '小老师一开口，同学们就停下来')
  assert.equal(page.data.playing, false)
  assert.equal(page.data.revealed, ROUND_LINES.length, '没读完的话一起亮出来')
  calls.timeouts.pop()()
  assert.equal(page.data.voiceRecognizing, true)
  assert.ok(page.data.peers.every((peer) => peer.mood === 'listen'), '按住说话时所有人都在听')
  page.onUnload()
})

test('typing still works after switching to the keyboard', async () => {
  const { page, calls } = await openClass()
  page.handleKeyboardButtonTap()
  assert.equal(page.data.voiceMode, false)
  page.handleInput({ detail: { value: '  分子分母同时除以公因数  ' } })
  await page.handleSend()
  assert.equal(calls.sends[0].message, '分子分母同时除以公因数')
  assert.equal(page.data.draft, '', '发出去之后清空输入框')
  page.onUnload()
})

test('the typing box grows with its lines and follows the keyboard', async () => {
  const { page } = await openClass()
  page.handleKeyboardButtonTap()
  page.handleKeyboardHeightChange({ detail: { height: 320 } })
  assert.equal(page.data.keyboardHeight, 320)
  page.handleLineChange({ detail: { lineCount: 9, height: 198 } })
  assert.equal(page.data.inputLines, 5, '最多长到 5 行，再多在框里滑')
  page.handleInputBlur()
  assert.equal(page.data.keyboardHeight, 0, '失焦就放回原位')
  page.handleKeyboardHeightChange({ detail: { height: 300 } })
  page.handleVoiceButtonTap()
  assert.equal(page.data.keyboardHeight, 0, '切回按住说话时键盘位置清零')
  page.onUnload()
})

test('sliding up throws the recording away and a blip is not uploaded', async () => {
  const { page, calls } = await openClass()
  holdAndSpeak(page, calls, { moveTo: 600 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  holdAndSpeak(page, calls, { bytes: 1000 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  assert.match(calls.toasts[0], /太短/)
  assert.deepEqual(calls.sends, [])
  page.onUnload()
})

test('speaking is held off while the peers are taking notes', async () => {
  const { page, calls } = await openClass()
  page.setData({ sending: true })
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  assert.equal(calls.timeouts.length, 0, '不开始计时，也就不录')
  assert.match(calls.toasts[0], /记笔记/)
  page.onUnload()
})

test('a spoken segment that did not go through lands in the input box instead of vanishing', async () => {
  const { page, calls } = await openClass({ sends: [new Error('网络不太好')] })
  holdAndSpeak(page, calls)
  await flush()
  assert.equal(page.data.draft, '约分就是分子分母同时除以同一个数')
  assert.equal(page.data.voiceMode, false, '切到键盘，看得到、改得了，点发送再试')
  assert.equal(page.data.sending, false)
  page.onUnload()
})

test('a minute of talking is sent on its own instead of being cut off silently', async () => {
  const { page, calls } = await openClass()
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  calls.timeouts.pop()()
  const sessionId = page._recorderSessionId
  page._handleRecorderStart(null, sessionId)
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(1920000 - 32000 * 5).buffer }, sessionId)
  page.updateVoiceVisualizer()
  assert.equal(page.data.voiceRemaining, 5, '最后 10 秒提示还能说几秒')
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(32000 * 5).buffer }, sessionId)
  assert.equal(page.data.voiceRecognizing, false, '录满就当松手')
  page.handleSpeakTouchEnd()
  await flush()
  assert.equal(calls.transcribed.length, 1, '手指后来松开也不会再发一次')
  assert.equal(calls.sends.length, 1)
  page.onUnload()
})

test('without the microphone the class falls back to typing', async () => {
  const { page, calls } = loadPage({ setting: {}, authorize: false, sends: [OPENED] })
  page.onLoad({ stageId: 'stage-1' })
  page.onShow()
  await flush()
  await page.start()
  assert.equal(calls.authorizes, 1)
  assert.equal(page.data.voiceMode, false)
  page.onUnload()
})

test('class can only be dismissed after at least one segment, and asks before ending', async () => {
  const finished = reply('pending_teacher', {
    turns: AFTER_ROUND.turns,
    peerClass: classState({ rounds: 1, done: 1, finished: true, peers: [{ ...PEERS[0], stars: 2 }, { ...PEERS[1], stars: 1 }, PEERS[2]] }),
    lines: [{ peer: 'xiaoman', text: '谢谢小老师！', kind: 'bye' }]
  })
  finished.checkin = { status: 'checked_in' }
  const early = await openClass()
  early.page.handleFinishTap()
  assert.equal(early.calls.modals.length, 0)
  assert.match(early.calls.toasts[0], /先给同学们讲一段/)
  early.page.onUnload()

  const { page, calls } = await openClass({ loads: [AFTER_ROUND], sends: [finished], modalConfirm: true })
  page.handleFinishTap()
  assert.equal(calls.modals[0].title, '要下课了吗？')
  assert.match(calls.modals[0].content, /还有 1 件事没讲清/)
  await flush()
  assert.deepEqual(calls.sends, [{ message: '', peerClass: true, finish: true, restart: false }])
  assert.equal(page.data.state, 'pending')
  assert.equal(page.data.result, null, '同学们说完再出结论')
  assert.equal(page.data.checkinNotice, null)
  calls.sequences[calls.sequences.length - 1].playAll()
  assert.equal(page.data.result.title, '同学们都听懂了！')
  assert.ok(page.data.peers.every((peer) => peer.mood === 'happy'), '过关后大家举着笔记本')
  assert.deepEqual(page.data.checkinNotice, { status: 'checked_in' }, '打卡弹窗照旧')
  page.onUnload()
})

test('with auto reading off, lines show at once and the verdict is not held back', async () => {
  const { page, calls, storage } = await openClass({ sends: [AFTER_ROUND] })
  page.toggleAutoRead()
  assert.equal(storage.zhilu_peer_class_auto_read, 'off')
  page.handleKeyboardButtonTap()
  page.handleInput({ detail: { value: '约分' } })
  await page.handleSend()
  assert.equal(calls.sequences.length, 0)
  assert.equal(page.data.revealed, ROUND_LINES.length)
  assert.equal(page.data.peers[2].bubble, '是只除分子吗？')
  page.onUnload()
})

test('not passing names what a classmate still missed and offers to teach again', async () => {
  const retry = reply('ai_retry', {
    turns: AFTER_ROUND.turns,
    peerClass: classState({ rounds: 2, done: 1, finished: true, board: [{ topic: '什么是约分', state: 'done' }, { topic: '约分后大小变不变', state: 'half' }] }),
    grade: { weakPoints: [], misconceptions: ['把约分说成了只除分子'] }
  })
  const { page, calls } = await openClass({ loads: [retry], sends: [OPENED] })
  assert.equal(page.data.state, 'retry')
  assert.equal(page.data.result.title, '还有同学没听明白')
  assert.deepEqual(Array.from(page.data.result.unclear), ['约分后大小变不变'])
  assert.deepEqual(Array.from(page.data.result.misconceptions), ['把约分说成了只除分子'])
  await page.restart()
  assert.deepEqual(calls.sends, [{ message: '', peerClass: true, finish: false, restart: true }])
  assert.equal(page.data.state, 'class')
  page.onUnload()
})

test('opening a class whose last segment got no answer sends that segment again, without adding it twice', async () => {
  const stalled = reply('in_progress', {
    turns: [...IN_CLASS.turns, { role: 'user', content: '约分就是除以同一个数', speaker: 'learner' }],
    peerClass: classState()
  })
  const { page, calls } = await openClass({ loads: [stalled], sends: [AFTER_ROUND] })
  assert.equal(calls.sends[0].message, '约分就是除以同一个数')
  assert.equal(calls.sends[0].peerClass, true)
  page.onUnload()
})

test('a class that ended without a verdict asks for it on opening', async () => {
  const settling = reply('in_progress', { turns: IN_CLASS.turns, peerClass: classState({ rounds: 8, finished: true }) })
  const { page, calls } = await openClass({ loads: [settling], sends: [reply('ai_retry', { peerClass: classState({ rounds: 8, finished: true }) })] })
  assert.deepEqual(calls.sends, [{ message: '', peerClass: true, finish: false, restart: false }])
  assert.equal(page.data.state, 'retry')
  page.onUnload()
})

test('the practice level comes first', async () => {
  const notCleared = { ...reply('not_started'), practice: { cleared: false } }
  const { page, calls } = await openClass({ loads: [notCleared] })
  assert.equal(calls.modals[0].title, '先闯过互动练习')
  page.onUnload()
})

test('the page is a classroom: peers at desks with name plates, a blackboard and the hold-to-teach button', () => {
  const template = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.wxss'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.json'), 'utf8'))
  assert.equal(config.navigationStyle, 'custom')
  assert.match(template, /class="pc-topbar-title">当小老师</)
  assert.match(template, /UA\.src\(ui, '\/assets\/peer-class\/classroom\.jpg'\)/)
  assert.match(template, /UA\.src\(ui, '\/assets\/peer-class\/desk\.png'\)/)
  assert.match(template, /UA\.src\(ui, item\.art\)/)
  assert.match(template, /黑板 · 这节课要讲的/)
  assert.match(template, /已讲 \{\{board\.done\}\}\/\{\{board\.total\}\}/)
  assert.match(template, /<text>按住 讲给同学听<\/text>/)
  assert.match(template, /bindtap="handleFinishTap"[^>]*>下课</)
  // 键盘、话筒、发送图标走后端素材
  for (const icon of ["'../../assets/keyboard-icon.svg'", "'../../assets/agent-voice.svg'", "'../../assets/agent-send.svg'", "'/assets/quest/mic.svg'"]) {
    assert.ok(template.includes(`UA.src(ui, ${icon})`), icon)
  }
  for (const attr of ['adjust-position="{{false}}"', 'bindlinechange="handleLineChange"', 'bindkeyboardheightchange="handleKeyboardHeightChange"', 'bindblur="handleInputBlur"']) {
    assert.ok(template.includes(attr), `打字框缺少 ${attr}`)
  }
  // 行内样式不写 rpx；不用渐变
  for (const match of template.matchAll(/style="([^"]*)"/g)) assert.doesNotMatch(match[1], /rpx/)
  assert.doesNotMatch(style, /gradient/)
})
