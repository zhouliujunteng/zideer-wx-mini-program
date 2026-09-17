const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/agent-chat/index.js')

function loadPage() {
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
    request(options) {
      if (options.method === 'POST' && options.success) options.success({ statusCode: 202, data: { id: 's' }, header: {} })
      return { abort() {}, onChunkReceived() {} }
    },
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[parts[parts.length - 1]] = value
    })
  }
  page.onLoad({})
  return page
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const kinds = (page) => page.data.messages.map((message) => message.kind || message.role)
const tool = (id, toolName, type, args = {}) => ({ id, ts: Date.now(), type, data: { toolName, toolCallId: `call-${toolName}`, args, result: { content: [] } } })

test('tools fired in the same millisecond appear one by one in a live stream', async () => {
  const page = loadPage()
  page._agentStreamLive = true
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: '讲讲二次函数' }] })
  ;[
    { id: 1, ts: Date.now(), type: 'session_start', data: {} },
    tool(2, 'search_chats', 'tool_execution_start', { limit: 10 }),
    tool(3, 'search_chats', 'tool_execution_end'),
    tool(4, 'search_classrooms', 'tool_execution_start', { limit: 10 }),
    tool(5, 'search_classrooms', 'tool_execution_end'),
    tool(6, 'list_materials', 'tool_execution_start'),
    tool(7, 'list_materials', 'tool_execution_end')
  ].forEach((event) => page.enqueueAgentEvent(event))

  const toolCount = () => page.data.messages.filter((message) => message.kind === 'tool').length
  assert.equal(toolCount(), 1, '第一条立即出现')
  await sleep(200)
  assert.equal(toolCount(), 1, '同一批的后续工具不会同时蹦出')
  await sleep(300)
  assert.equal(toolCount(), 2)
  await sleep(400)
  assert.equal(toolCount(), 3)
  const labels = page.data.messages.filter((message) => message.kind === 'tool').map((message) => message.label)
  assert.deepEqual(labels, ['翻看历史对话', '翻看已学课程', '查看素材清单'])
  assert.equal(page.data.messages.filter((message) => message.kind === 'thinking').length, 1, '一轮只有一张思考卡')
  page.onUnload()
})

test('history replay (not live) applies the same events immediately', () => {
  const page = loadPage()
  page._agentStreamLive = false
  page.enqueueAgentEvent(tool(2, 'search_chats', 'tool_execution_start'))
  page.enqueueAgentEvent(tool(4, 'search_classrooms', 'tool_execution_start'))
  assert.equal(page.data.messages.filter((message) => message.kind === 'tool').length, 2)
  page.onUnload()
})

test('ask_user shows only the question card, thinking settles, and nothing keeps spinning', () => {
  const page = loadPage()
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: 'hi' }, { id: 'a', role: 'assistant', text: '', isTyping: true }] })
  page.handleAgentEvent({ id: 1, type: 'session_start', data: {} })
  const reply = { role: 'assistant', content: [{ type: 'text', text: '先热个身。' }, { type: 'toolCall', name: 'ask_user' }] }
  page.handleAgentEvent({ id: 2, type: 'message_update', data: { message: reply } })
  page.handleAgentEvent({ id: 3, type: 'message_end', data: { message: reply } })
  page.handleAgentEvent({ id: 4, type: 'tool_execution_start', data: { toolName: 'ask_user', toolCallId: 'call-ask', args: {} } })
  page.handleAgentEvent({ id: 5, type: 'user_question', data: { question: 'y = 2x + 1 经过哪个点？', options: [{ id: 'a', label: '(0, 1)' }, { id: 'b', label: '不会 / 没学过' }] } })
  page.handleAgentEvent({ id: 6, type: 'tool_execution_end', data: { toolName: 'ask_user', toolCallId: 'call-ask' } })
  page.handleAgentEvent({ id: 7, type: 'session_end', data: { status: 'succeeded' } })

  assert.ok(!kinds(page).includes('tool'), 'ask_user 不再显示为工具卡')
  const thinking = page.data.messages.filter((message) => message.kind === 'thinking')
  assert.equal(thinking.length, 1)
  assert.equal(thinking[0].streaming, false)
  assert.equal(page.data.isSending, false)
  page.onUnload()
})

test('answered question cards keep the question and the chosen answer visible', async () => {
  const page = loadPage()
  page._agentSessionId = 's'
  page.loadBaselineForAgent = () => Promise.resolve(null)
  page.ensureAgentAccess = () => Promise.resolve()
  page.startAgentStream = () => {}
  page.setData({ messages: [{ id: 'u', role: 'user', text: 'hi' }] })
  page.handleAgentEvent({ id: 5, type: 'user_question', data: { question: '小明说「如果今天下雨，我就不去打球」。今天没下雨，他一定去打球吗？', options: [{ id: 'yes', label: '一定去' }, { id: 'no', label: '不一定' }] } })
  page.handleAgentEvent({ id: 7, type: 'session_end', data: { status: 'succeeded' } })

  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'no' } } })
  const card = page.data.messages.find((message) => message.kind === 'question')
  assert.equal(card.answered, false, '单选点选后先不提交，等确认')
  assert.equal(card.options.find((option) => option.id === 'no').selected, true, '选中态写在选项上供 WXML 直接读取')
  page.handleQuestionConfirm({ currentTarget: { dataset: { questionId: card.id } } })
  assert.equal(card.answered, true)
  assert.deepEqual(card.selectedIds, ['no'])
  assert.ok(card.question.includes('小明说'), '题目内容保留')
  // 已回答卡片再点不生效
  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'yes', questionId: card.id } } })
  assert.deepEqual(card.selectedIds, ['no'])
  await sleep(350)
  page.handleAgentEvent({ id: 8, type: 'user_message', data: { text: '不一定' } })
  assert.equal(page.data.messages.filter((message) => message.role === 'user').length, 2)
  assert.ok(page.data.messages.includes(card))

  // 用户自己打字回答：记录为「我的回答」
  page.handleAgentEvent({ id: 9, type: 'user_question', data: { question: '说说你最卡在哪里？', options: [] } })
  page.handleAgentEvent({ id: 10, type: 'user_message', data: { text: '应用题读不懂' } })
  const typed = page.data.messages.filter((message) => message.kind === 'question').pop()
  assert.equal(typed.answered, true)
  assert.equal(typed.answerText, '应用题读不懂')
  page.onUnload()
})

test('a live question card waits for the text above it to finish revealing', async () => {
  const page = loadPage()
  page._agentStreamLive = true
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: 'hi' }, { id: 'a', role: 'assistant', text: '', isTyping: true }] })
  const text = '看了下你的档案，初三上学期，数学里二次函数还需要巩固，我们先热个身，做一道小题。'
  const reply = { role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', name: 'ask_user' }] }
  page.enqueueAgentEvent({ id: 2, type: 'message_update', data: { message: reply } })
  page.enqueueAgentEvent({ id: 3, type: 'message_end', data: { message: reply } })
  page.enqueueAgentEvent({ id: 5, type: 'user_question', data: { question: '先热身', options: [{ id: 'a', label: 'A' }] } })
  await sleep(150)
  assert.ok(!kinds(page).includes('question'), '正文还在渐显时问题卡先不出现')
  await sleep(1500)
  assert.ok(kinds(page).includes('question'))
  assert.equal(page.data.messages.find((message) => message.role === 'assistant').text, text)
  page.onUnload()
})

test('single and multi select both require an explicit confirm, with visible selected state', async () => {
  const page = loadPage()
  page._agentSessionId = 's'
  page.loadBaselineForAgent = () => Promise.resolve(null)
  page.ensureAgentAccess = () => Promise.resolve()
  page.startAgentStream = () => {}
  const sent = []
  const originalSend = page.sendMessage
  page.sendMessage = function (text) { sent.push(text); return originalSend.call(this, text) }
  page.handleAgentEvent({ id: 1, type: 'user_question', data: { multiSelect: true, question: '最想从哪一类开始上手？（可多选）', options: [{ id: 'mcu', label: '单片机小发明' }, { id: 'solder', label: '电路与焊接' }, { id: 'print', label: '结构与外观' }] } })
  page.handleAgentEvent({ id: 2, type: 'session_end', data: { status: 'succeeded' } })
  const card = page.data.messages.find((message) => message.kind === 'question')
  assert.equal(card.confirmLabel, '确认')
  assert.equal(card.selectedCount, 0)

  // 没选就确认：提示，不发送
  page.handleQuestionConfirm({ currentTarget: { dataset: { questionId: card.id } } })
  assert.equal(sent.length, 0)

  const tap = (id) => page.handleQuestionOptionTap({ currentTarget: { dataset: { id, questionId: card.id } } })
  tap('mcu')
  tap('print')
  tap('mcu')
  tap('solder')
  assert.deepEqual(card.options.map((option) => option.selected), [false, true, true])
  assert.equal(card.confirmLabel, '确认（已选 2 项）')
  assert.equal(sent.length, 0, '多选点选不会直接发送')

  page.handleQuestionConfirm({ currentTarget: { dataset: { questionId: card.id } } })
  assert.deepEqual(sent, ['电路与焊接、结构与外观'])
  assert.equal(card.answered, true)
  tap('mcu')
  assert.equal(card.options[0].selected, false, '已提交的卡片不再响应点选')
  await sleep(350)
  page.onUnload()

  // 单选：再点另一项会切换，不会叠加
  const single = loadPage()
  single.handleAgentEvent({ id: 3, type: 'user_question', data: { question: '热身：2x + 1，x = 3？', options: [{ id: 'six', label: '6' }, { id: 'seven', label: '7' }] } })
  const singleCard = single.data.messages.find((message) => message.kind === 'question')
  single.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'six', questionId: singleCard.id } } })
  single.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'seven', questionId: singleCard.id } } })
  assert.deepEqual(singleCard.selectedIds, ['seven'])
  assert.equal(singleCard.answered, false)
  single.onUnload()
})

test('replayed answers restore the chosen options on the answered card', () => {
  const page = loadPage()
  page.handleAgentEvent({ id: 1, type: 'user_question', data: { multiSelect: true, question: '可多选', options: [{ id: 'a', label: '应用题读不懂' }, { id: 'b', label: '计算容易出错' }, { id: 'c', label: '几何' }] } })
  page.handleAgentEvent({ id: 2, type: 'user_message', data: { text: '应用题读不懂、几何' } })
  const card = page.data.messages.find((message) => message.kind === 'question')
  assert.deepEqual(card.options.filter((option) => option.selected).map((option) => option.id), ['a', 'c'])
  assert.equal(card.answerText, undefined)
  page.onUnload()
})

test('WXML expressions never call methods (unsupported on device)', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const root = path.join(__dirname, '..')
  const calls = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(full)
      } else if (entry.name.endsWith('.wxml')) {
        const wxml = fs.readFileSync(full, 'utf8')
        for (const expression of wxml.match(/\{\{[^}]*\}\}/g) || []) {
          if (/[A-Za-z_$][\w$]*\s*\(/.test(expression)) calls.push(`${path.relative(root, full)}: ${expression}`)
        }
      }
    }
  }
  walk(root)
  assert.deepEqual(calls, [], 'WXML 不支持在 {{}} 里调用 indexOf / includes 等方法，请在 JS 里预先算好')
})
