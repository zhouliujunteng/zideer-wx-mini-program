const assert = require('node:assert/strict')
const test = require('node:test')

const servicePath = require.resolve('../services/course-agent-service.js')

// 真机行为：wx.request 参数里的 onChunkReceived 会被忽略，分块只通过 RequestTask.onChunkReceived 投递。
function loadServiceWithDeviceRequest() {
  delete require.cache[servicePath]
  const calls = []
  global.wx = {
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
    request(options) {
      const listeners = []
      const task = {
        aborted: false,
        abort() { task.aborted = true },
        onChunkReceived(listener) { listeners.push(listener) },
        push(text) {
          const bytes = Buffer.from(text, 'utf8')
          listeners.forEach((listener) => listener({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }))
        },
        listeners
      }
      calls.push({ options, task })
      return task
    }
  }
  return { service: require(servicePath), calls }
}

test('event stream subscribes chunks on the RequestTask, not the request options', () => {
  const { service, calls } = loadServiceWithDeviceRequest()
  const events = []
  const statuses = []
  service.streamCourseAgentEvents('session-1', {
    lastEventId: 3,
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status)
  })
  const { options, task } = calls[0]
  assert.equal(options.enableChunked, true)
  assert.match(options.url, /\/api\/agent\/sessions\/session-1\/events\?lastEventId=3$/)
  assert.equal(options.onChunkReceived, undefined, '参数里的回调在真机上无效，不应依赖')
  assert.equal(task.listeners.length, 1, '必须在 RequestTask 上注册分块监听')

  const question = JSON.stringify({ id: 5, ts: 1, type: 'user_question', data: { question: '今天想先攻哪一科？', options: [{ id: 'math', label: '数学' }] } })
  const frame = `: replaying from event 3\n\nid: 5\nevent: user_question\ndata: ${question}\n\nevent: caught_up\ndata: {}\n\n`
  // 在多字节中文字符中间切开，模拟真实分块边界
  const bytes = Buffer.from(frame, 'utf8')
  const cut = bytes.indexOf(Buffer.from('攻', 'utf8')) + 1
  const listener = task.listeners[0]
  listener({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + cut) })
  assert.equal(events.length, 0)
  listener({ data: bytes.buffer.slice(bytes.byteOffset + cut, bytes.byteOffset + bytes.length) })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'user_question')
  assert.equal(events[0].data.question, '今天想先攻哪一科？')
  assert.deepEqual(statuses, ['live'])
})

// ---------- 页面：服务端预加载技能的 read 不应提前结束“发送中” ----------

const pagePath = require.resolve('../pages/agent-chat/index.js')

test('assistant tool-call messages keep the reply pending until session_end', async () => {
  delete require.cache[pagePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    request() { return { abort() {}, onChunkReceived() {} } },
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (!key.includes('.')) { page.data[key] = value; return }
      const path = key.split('.')
      let target = page.data
      path.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[path[path.length - 1]] = value
    })
  }
  page.onLoad({})
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: 'hi' }, { id: 'a', role: 'assistant', text: '', isTyping: true }] })

  const readCall = { role: 'assistant', content: [{ type: 'toolCall', id: 'call_sklpre', name: 'read', arguments: { path: '/app/skills/agent-runtime/learner-baseline-interview/SKILL.md' } }] }
  page.handleAgentEvent({ id: 6, type: 'message_start', data: { message: readCall } })
  page.handleAgentEvent({ id: 7, type: 'message_end', data: { message: readCall } })
  assert.equal(page.data.isSending, true, '预加载技能不是回复终点')

  const reply = { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '你好呀，我先问你一个问题。' }, { type: 'toolCall', id: 'call_ask', name: 'ask_user', arguments: {} }] }
  page.handleAgentEvent({ id: 10, type: 'message_start', data: { message: reply } })
  page.handleAgentEvent({ id: 76, type: 'message_end', data: { message: reply } })
  assert.equal(page.data.isSending, true)
  assert.ok(page.data.messages.some((message) => message.role === 'assistant' && message.text === '你好呀，我先问你一个问题。' && !message.isTyping))

  page.handleAgentEvent({ id: 78, type: 'user_question', data: { question: '今天想先攻哪一科？', options: [{ id: 'math', label: '数学' }] } })
  page.handleAgentEvent({ id: 84, type: 'session_end', data: { status: 'succeeded' } })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(page.data.isSending, false)
  assert.ok(page.data.messages.some((message) => message.kind === 'question' && !message.answered))
  page.onUnload()
})

// ---------- 页面：caught_up 后连接仍开着，不能泄漏成多条并发长连接 ----------

test('a live stream is reused instead of leaking a new long connection per message', () => {
  delete require.cache[pagePath]
  delete require.cache[servicePath]
  let definition = null
  const tasks = []
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {},
    request(options) {
      const listeners = []
      const task = {
        options,
        aborted: false,
        abort() { task.aborted = true },
        onChunkReceived(listener) { listeners.push(listener) },
        push(text) {
          const bytes = Buffer.from(text, 'utf8')
          listeners.forEach((listener) => listener({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }))
        }
      }
      tasks.push(task)
      return task
    },
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = () => {}
  page.onLoad({})
  page._isPageVisible = true
  page._agentSessionId = 'session-1'

  const openStreams = () => tasks.filter((task) => /\/events\?/.test(task.options.url) && !task.aborted)

  page.startAgentStream()
  openStreams()[0].push('event: caught_up\ndata: {}\n\n')
  assert.ok(page._agentStream, 'caught_up 后连接仍开着，必须保留引用')

  // 发送下一条消息时的判断：已有流就不再开新流
  if (!page._agentStream) page.startAgentStream()
  assert.equal(openStreams().length, 1)

  // 显式重开会关掉旧流；旧流迟到的结束回调不能清掉新流
  const first = openStreams()[0]
  page.startAgentStream()
  assert.equal(first.aborted, true)
  assert.equal(openStreams().length, 1)
  first.options.success({ statusCode: 200 })
  assert.ok(page._agentStream, '旧流的回调不应影响当前流')

  page.onHide()
  assert.equal(openStreams().length, 0, '离开页面必须断开所有事件流')
  page.onUnload()
})
