const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// 复述验收页（learning/agent-acceptance）：版式照诊断室，默认「按住说话」让学生开口复述（2026-10-04 用户要求）。

const pageSource = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.js'), 'utf8')
const COURSE = { stageId: 'stage-1', title: '一元一次方程' }

function reply(status, turns = [], extra = {}) {
  return { course: COURSE, acceptance: { status, learningComplete: true, learning: { completed: 3, total: 3 }, topics: [], ...extra }, turns }
}

const ASKED = reply('in_progress', [{ role: 'assistant', content: '什么是一元一次方程？' }])

function loadPage({ loads = [reply('not_started')], sends = [], asr = { text: '只含一个未知数、次数是一的方程', warning: '' }, setting = { 'scope.record': true }, authorize = true } = {}) {
  let definition
  const calls = { loads: 0, sends: [], toasts: [], redirects: [], modals: [], timeouts: [], transcribed: [], authorizes: 0, recorder: { starts: 0, stops: 0, cancels: 0 } }
  const bridge = {
    attach() {},
    start(owner) { calls.recorder.starts += 1; owner._recorderSessionId = calls.recorder.starts; return owner._recorderSessionId },
    stop() { calls.recorder.stops += 1; return true },
    cancelOwner() { calls.recorder.cancels += 1 }
  }
  const voiceInput = require('../utils/voice-input')
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
      showModal: (options) => { calls.modals.push(options.title); if (options.success) options.success({ confirm: false }) },
      hideKeyboard: () => {},
      redirectTo: (options) => calls.redirects.push(options.url),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812, safeArea: { bottom: 778 } }),
      getSetting: (options) => options.success({ authSetting: setting }),
      authorize: (options) => { calls.authorizes += 1; if (authorize) options.success(); else options.fail() }
    },
    require(name) {
      if (name.endsWith('/services/identity')) {
        return {
          loadAgentCourseAcceptance: async () => { calls.loads += 1; return loads.shift() || reply('not_started') },
          sendAgentCourseAcceptance: async (stageId, message) => {
            calls.sends.push(message)
            const next = sends.shift()
            if (next instanceof Error) throw next
            return next || ASKED
          }
        }
      }
      if (name.endsWith('/services/learning-streak')) return { loadCheckin: async () => ({}) }
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
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() }
  }
  return { page, calls }
}

const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

async function openChat(options = {}) {
  const loaded = loadPage({ loads: [ASKED], ...options })
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

test('the conversation opens on hold-to-speak: retelling is spoken, not picked', async () => {
  const { page } = await openChat()
  assert.equal(page.data.state, 'chat')
  assert.equal(page.data.voiceMode, true, '进对话默认就是「按住说话」')
  assert.deepEqual(Array.from(page.data.turns, (turn) => turn.role), ['assistant'])
  page.onUnload()
})

test('holding to speak records, turns the speech into text and sends it as the answer', async () => {
  const { page, calls } = await openChat()
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  assert.equal(calls.recorder.starts, 0, '只是碰一下不算，按住一会儿才开始录')
  calls.timeouts.pop()()
  assert.equal(page.data.voiceRecognizing, true)
  page._handleRecorderStart(null, page._recorderSessionId)
  page._handleRecorderFrame({ frameBuffer: new Uint8Array(6400).buffer }, page._recorderSessionId)
  page.handleSpeakTouchEnd()
  await flush()
  assert.equal(page.data.voiceRecognizing, false)
  assert.equal(calls.transcribed.length, 1)
  assert.deepEqual(calls.sends, ['只含一个未知数、次数是一的方程'], '转出来的字直接作为回答发出')
  page.onUnload()
})

test('typing still works after switching to the keyboard', async () => {
  const { page, calls } = await openChat()
  page.handleKeyboardButtonTap()
  assert.equal(page.data.voiceMode, false)
  page.handleInput({ detail: { value: '  方程里只有一个未知数  ' } })
  await page.handleSend()
  assert.deepEqual(calls.sends, ['方程里只有一个未知数'])
  assert.equal(page.data.draft, '', '发出去之后清空输入框')
  page.onUnload()
})

// 2026-11-09 用户反馈：打字框写长了字横着溢出；平板上键盘收起后卡住点不动。
// 现在是多行打字框按行数往上长（最多 5 行），输入框自己跟着键盘高度走，收起 / 失焦 / 切回语音都放回原位。
test('the typing box grows with its lines and follows the keyboard instead of pushing the page', async () => {
  const { page, calls } = await openChat()
  page.handleKeyboardButtonTap()
  const base = page.data.listBottomPadding
  page.handleKeyboardHeightChange({ detail: { height: 320 } })
  assert.equal(page.data.keyboardHeight, 320)
  assert.ok(page.data.listBottomPadding > base, '键盘弹起时记录底部让出键盘的高度')
  page.handleLineChange({ detail: { lineCount: 3, height: 66 } })
  assert.equal(page.data.inputLines, 3)
  page.handleLineChange({ detail: { lineCount: 9, height: 198 } })
  assert.equal(page.data.inputLines, 5, '最多长到 5 行，再多在框里滑')
  page.handleInputBlur()
  assert.equal(page.data.keyboardHeight, 0, '失焦就放回原位')
  page.handleInput({ detail: { value: '很长的一段回答' } })
  await page.handleSend()
  assert.deepEqual(calls.sends, ['很长的一段回答'])
  assert.equal(page.data.inputLines, 1, '发出去之后回到一行')
  page.handleKeyboardHeightChange({ detail: { height: 300 } })
  page.handleVoiceButtonTap()
  assert.equal(page.data.keyboardHeight, 0, '切回按住说话时键盘位置清零')
  assert.equal(page.data.listBottomPadding, base)
  page.onUnload()
})

test('sliding up before letting go throws the recording away', async () => {
  const { page, calls } = await openChat()
  holdAndSpeak(page, calls, { moveTo: 600 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  assert.deepEqual(calls.sends, [])
  page.onUnload()
})

test('a blip too short to be speech is not uploaded', async () => {
  const { page, calls } = await openChat()
  holdAndSpeak(page, calls, { bytes: 1000 })
  await flush()
  assert.deepEqual(calls.transcribed, [])
  assert.match(calls.toasts[0], /太短/)
  page.onUnload()
})

test('speaking is held off while the next question is still coming', async () => {
  const { page, calls } = await openChat()
  page.setData({ sending: true })
  page.handleSpeakTouchStart({ touches: [{ pageY: 700 }] })
  assert.equal(calls.timeouts.length, 0, '不开始计时，也就不录')
  assert.match(calls.toasts[0], /等它问完/)
  page.onUnload()
})

test('a spoken answer that did not go through lands in the input box instead of vanishing', async () => {
  const { page, calls } = await openChat({ sends: [new Error('网络不太好')] })
  holdAndSpeak(page, calls)
  await flush()
  assert.equal(page.data.draft, '只含一个未知数、次数是一的方程')
  assert.equal(page.data.voiceMode, false, '切到键盘，学生看得到、改得了，点发送再试')
  assert.equal(page.data.sending, false)
  page.onUnload()
})

test('a minute of talking is sent on its own instead of being cut off silently', async () => {
  const { page, calls } = await openChat()
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

test('starting asks for the microphone up front, and falls back to typing without it', async () => {
  const { page, calls } = loadPage({ setting: {}, authorize: false })
  page.onLoad({ stageId: 'stage-1' })
  page.onShow()
  await flush()
  assert.equal(page.data.state, 'intro')
  await page.start()
  assert.equal(calls.authorizes, 1)
  assert.deepEqual(calls.sends, [''], '空消息让验收智能体先提问')
  assert.equal(page.data.state, 'chat')
  assert.equal(page.data.voiceMode, false, '没给麦克风就直接打字')
  page.onUnload()
})

test('a failed attempt keeps the conversation on screen and ends it with the verdict and a retry', async () => {
  const turns = [{ role: 'assistant', content: '什么是一元一次方程？' }, { role: 'user', content: '不知道' }, { role: 'assistant', content: '回去再看看第二页吧' }]
  const { page } = await openChat({ loads: [reply('ai_retry', turns, { aiSummary: '没讲清未知数的次数' })] })
  assert.equal(page.data.state, 'retry')
  assert.equal(page.data.turns.length, 3, '最后那句点评还在，不被说明卡顶掉')
  assert.equal(page.data.result.title, '这次还差一点')
  assert.equal(page.data.result.copy, '没讲清未知数的次数')
  page.onUnload()
})

// 独立考官（2026-10-08）：没通过时列出没讲清的要点和说错的地方，不再只给一段总结
test('a failed attempt graded by the examiner lists the missed points and the misconceptions', async () => {
  const grade = { score: 0.33, points: [], weakPoints: ['未知数的次数是 1', '方程两边同时加减'], misconceptions: ['把等式说成了方程'] }
  const { page } = await openChat({ loads: [reply('ai_retry', [{ role: 'assistant', content: '这次还差一点。' }], { aiSummary: '写给老师的总结', grade })] })
  assert.equal(page.data.result.title, '这次还差一点')
  assert.deepEqual(Array.from(page.data.result.weakPoints), ['未知数的次数是 1', '方程两边同时加减'])
  assert.deepEqual(Array.from(page.data.result.misconceptions), ['把等式说成了方程'])
  assert.notEqual(page.data.result.copy, '写给老师的总结', '写给老师的总结不直接给学生看')
  page.onUnload()
})

test('a pass waiting for the teacher shows the topics after the conversation', async () => {
  const topics = [{ name: '一元一次方程的概念' }]
  const { page } = await openChat({ loads: [reply('pending_teacher', [{ role: 'assistant', content: '讲得很清楚！' }], { topics })] })
  assert.equal(page.data.state, 'pending')
  assert.equal(page.data.result.topicsTitle, '本课知识点')
  assert.deepEqual(Array.from(page.data.result.topics, (topic) => topic.name), ['一元一次方程的概念'])
  page.onUnload()
})

test('the page is the student\'s diagnosis room: custom top bar, same bubbles and the same voice composer', () => {
  const template = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.wxss'), 'utf8')
  const chatStyle = fs.readFileSync(path.join(__dirname, '../pages/diagnosis-room/index.wxss'), 'utf8')
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../learning/agent-acceptance/index.json'), 'utf8'))
  assert.equal(config.navigationStyle, 'custom', '顶栏和诊断室一样自己画')
  for (const name of ['agent-ambient', 'agent-topbar', 'diagnosis-room-scroll', 'agent-message-bubble', 'agent-composer', 'agent-composer-bar', 'agent-input', 'agent-send-button', 'agent-voice-speak-button', 'voice-demo-status', 'agent-welcome-avatar']) {
    assert.match(template, new RegExp(`class="[^"]*\\b${name}\\b`), `${name} 应沿用诊断室的类名`)
  }
  for (const rule of [
    '.agent-ambient { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 0;',
    '.agent-message-user .agent-message-bubble { padding: 16rpx 24rpx; border-radius: 28rpx 28rpx 8rpx 28rpx; background: #DCEEFF; color: #222A25; }',
    '.agent-composer-bar { display: flex; align-items: center; min-height: 104rpx; padding: 6rpx 18rpx;',
    '.agent-input { min-width: 0; flex: 1; height: 84rpx; margin: 0 14rpx; color: #2D3931; font-size: 29rpx;',
    '.agent-voice-speak-button { display: flex; flex: 1; align-items: center; justify-content: center; height: 84rpx;',
    '.agent-send-button.is-enabled, .agent-send-button.is-sending { background: #FD7C02; }'
  ]) {
    assert.ok(style.includes(rule), `样式与诊断室不一致：${rule.slice(0, 48)}`)
    assert.ok(chatStyle.includes(rule), `诊断室本身已改过这条规则，需要同步：${rule.slice(0, 48)}`)
  }
  // 话筒、键盘、发送图标走后端素材
  for (const icon of ['agent-voice', 'keyboard-icon', 'agent-send']) {
    assert.match(template, new RegExp(`UA\\.src\\(ui, '\\.\\./\\.\\./assets/${icon}\\.svg'\\)`))
  }
  assert.ok(!/class="acc-(composer|input|send)\b/.test(template), '旧的自绘输入框应已移除')
  // 打字框是多行 textarea（2026-11-09 用户反馈：单行 input 写长了字横着溢出；平板上键盘收起后卡住点不动）
  assert.match(template, /<textarea[^>]*class="agent-input acc-answer-input"/)
  assert.ok(!/<input\b/.test(template), '打字框不能再是单行 input')
  for (const attr of ['fixed="{{true}}"', 'adjust-position="{{false}}"', 'bindlinechange="handleLineChange"', 'bindkeyboardheightchange="handleKeyboardHeightChange"', 'bindblur="handleInputBlur"']) {
    assert.ok(template.includes(attr), `打字框缺少 ${attr}`)
  }
  assert.match(template, /class="agent-composer" style="bottom: \{\{keyboardHeight > 0 \? keyboardHeight : composerBottomOffset\}\}px;"/)
  assert.match(style, /\.acc-answer-input \{[^}]*height: calc\(var\(--lines, 1\) \* 42rpx\);/)
})
