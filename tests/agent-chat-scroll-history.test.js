const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/agent-chat/index.js')

function loadPage({ storage = {}, onRequest } = {}) {
  delete require.cache[pagePath]
  let definition = null
  const requests = []
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast() {},
    request(options) {
      requests.push(options)
      if (onRequest) onRequest(options)
      return { abort() {}, onChunkReceived() {} }
    },
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  const patches = []
  page.setData = (patch, callback) => {
    patches.push(patch)
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return { page, requests, patches }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const touch = (y) => ({ touches: [{ clientY: y }], changedTouches: [{ clientY: y }] })

test('scrolling up during streaming is never pulled back to the bottom', () => {
  const { page, patches } = loadPage()
  page.onLoad({})
  page._isPageVisible = true
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: 'hi' }, { id: 'a', role: 'assistant', text: '...', isTyping: true }] })
  page._lastChatScrollTop = 1800
  page._lastChatScrollDistance = 0

  patches.length = 0
  page.handleChatTouchStart(touch(500))
  assert.ok(!patches.some((patch) => 'scrollTop' in patch), '按下时不能回写 scrollTop（会把上滑拉回底部）')

  // 真机上 touchmove 可能不回调：只有 scroll 事件
  page.handleChatScroll({ detail: { scrollTop: 1700, scrollHeight: 2600, height: 700 } })
  page.handleChatTouchEnd()
  assert.equal(page._chatFollowEnabled, false)
  assert.equal(page.getChatScrollTarget(), '')

  // 松手后继续流式刷新：不再下发滚动请求
  patches.length = 0
  page.renderAgentMessages()
  page.setData(page.getChatScrollUpdate())
  assert.ok(!patches.some((patch) => 'scrollTop' in patch))

  // 惯性滚动中内容增长触发的 scroll 事件也不会恢复跟随
  page.handleChatScroll({ detail: { scrollTop: 1690, scrollHeight: 2700, height: 700 } })
  assert.equal(page._chatFollowEnabled, false)
  assert.equal(page.data.showScrollToBottom, true, '显示回到底部按钮')

  // 用户自己滑回最底部：恢复跟随
  page.handleChatScroll({ detail: { scrollTop: 2000, scrollHeight: 2700, height: 700 } })
  assert.equal(page._chatFollowEnabled, true)
  page.onUnload()
})

test('a stale "at bottom" distance on touchend no longer re-enables following', () => {
  const { page } = loadPage()
  page.onLoad({})
  page.setData({ isSending: true })
  page._lastChatScrollDistance = 0
  page.handleChatTouchStart(touch(500))
  page.handleChatTouchEnd()
  assert.equal(page._chatFollowEnabled, false, '是否恢复只看松手后的实测位置')
  page.onUnload()
})

test('reopening the page restores the last conversation, including finished ask_user runs', async () => {
  const storage = {
    zion_runtime_token: 'jwt',
    'course-agent-access-token': 'access',
    'course-agent-session-id': 'session-7'
  }
  const { page, requests } = loadPage({
    storage,
    onRequest(options) {
      if (/\/api\/agent\/sessions\/session-7$/.test(options.url)) {
        options.success({ statusCode: 200, data: { id: 'session-7', status: 'succeeded' }, header: {} })
      }
    }
  })
  page.onLoad({})
  await sleep(50)
  const stream = requests.find((request) => /\/events\?lastEventId=0$/.test(request.url))
  assert.ok(stream, '已结束（停在提问）的会话也从头回放')
  assert.equal(page._agentSessionId, 'session-7')

  // 回放：首条提问来自 session_start，之后的回答来自 user_message
  const prompt = '我想学编程\n\n<zhilu-learner-context>\n{}\n</zhilu-learner-context>\n【知鹿学习选项】参考我的宇宙：开 · 学习模式：未选择\n/learner-baseline-interview'
  ;[
    { id: 1, type: 'session_start', data: { prompt } },
    { id: 2, type: 'message_start', data: { message: { role: 'assistant', content: [] } } },
    { id: 3, type: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: '先摸个底。' }, { type: 'toolCall', name: 'ask_user' }] } } },
    { id: 4, type: 'user_question', data: { question: '你接触过编程吗？', options: [{ id: 'none', label: '完全没碰过' }] } },
    { id: 5, type: 'session_end', data: { status: 'succeeded' } },
    { id: 6, type: 'user_message', data: { text: '完全没碰过' } },
    { id: 7, type: 'session_resumed', data: {} },
    { id: 7.5, type: 'message_start', data: { message: { role: 'assistant', content: [] } } },
    { id: 8, type: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: '好，那我们从零开始。' }, { type: 'toolCall', name: 'ask_user' }] } } },
    { id: 9, type: 'user_question', data: { question: '热身小题：x = 3 时 2x + 1 等于？', options: [{ id: 'seven', label: '7' }] } },
    { id: 10, type: 'session_end', data: { status: 'succeeded' } }
  ].forEach((event) => page.enqueueAgentEvent(event))

  const timeline = page.data.messages.map((message) => message.kind || `${message.role}:${message.text}`)
  assert.deepEqual(timeline.filter((item) => item.startsWith('user:')), ['user:我想学编程', 'user:完全没碰过'], '首条提问与回答都恢复，且不含附录')
  assert.ok(timeline.includes('assistant:先摸个底。') && timeline.includes('assistant:好，那我们从零开始。'))
  const questions = page.data.messages.filter((message) => message.kind === 'question')
  assert.equal(questions.length, 2)
  assert.equal(questions[0].answered, true)
  assert.equal(questions[1].answered, false, '最后一题可以继续作答')
  page.onUnload()
})

test('entering from the home prompt starts a new conversation instead of restoring', () => {
  const storage = { 'course-agent-session-id': 'session-7' }
  const { page, requests } = loadPage({ storage })
  page.onLoad({ prompt: encodeURIComponent('讲讲勾股定理') })
  assert.equal(page._agentSessionId, '')
  assert.ok(!requests.some((request) => /session-7/.test(request.url)))
  page.onUnload()
})

test('a network failure while restoring keeps the remembered conversation', async () => {
  const storage = { zion_runtime_token: 'jwt', 'course-agent-access-token': 'access', 'course-agent-session-id': 'session-7' }
  const { page } = loadPage({
    storage,
    onRequest(options) {
      if (/session-7$/.test(options.url)) options.fail({ errMsg: 'request:fail timeout' })
    }
  })
  page.onLoad({})
  await sleep(50)
  assert.equal(storage['course-agent-session-id'], 'session-7', '非 404 不遗忘')
  page.onUnload()
})
