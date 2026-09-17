const assert = require('node:assert/strict')
const test = require('node:test')

const { summarizeTopic, thinkingSummary } = require('../utils/course-agent-fold')

test('topic summary trims punctuation and clips long questions', () => {
  assert.equal(summarizeTopic('我想学一下微积分。'), '我想学一下微积分')
  assert.equal(summarizeTopic('  帮我讲讲初二物理里的浮力和压强到底怎么区分  '), '帮我讲讲初二物理里的浮力和压…')
  assert.equal(summarizeTopic(''), '')
})

test('thinking summary follows the phase of the run', () => {
  const ask = { topic: '我想学编程', answer: '' }
  const answer = { topic: '', answer: '7' }
  const confirm = { topic: '', answer: '确认方案，开始生成课程' }
  assert.equal(thinkingSummary(ask, 'thinking'), '正在思考「我想学编程」')
  assert.equal(thinkingSummary(answer, 'thinking'), '正在分析你的回答「7」')
  assert.equal(thinkingSummary(confirm, 'thinking'), '正在按确认的方案准备课程')
  assert.equal(thinkingSummary(ask, 'question'), '围绕「我想学编程」，先确认你的学习情况')
  assert.equal(thinkingSummary(confirm, 'course'), '按确认的方案开始生成课程')
  assert.equal(thinkingSummary(ask, 'answer'), '围绕「我想学编程」整理好了回答')
  assert.equal(thinkingSummary(ask, 'failed'), '这次没有完成，可以重新发送试试')
})

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
    request() { return { abort() {}, onChunkReceived() {} } },
    nextTick: (callback) => callback()
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

test('each turn gets its own thinking card and a summary of what it decided', () => {
  const page = loadPage()
  const reply = (text) => ({ role: 'assistant', content: [{ type: 'text', text }, { type: 'toolCall', name: 'ask_user' }] })
  ;[
    { id: 1, type: 'session_start', data: { prompt: '我想学编程' } },
    { id: 2, type: 'message_start', data: { message: { role: 'assistant', content: [] } } },
    { id: 3, type: 'message_end', data: { message: reply('你好呀，我先了解一下你的情况。') } },
    { id: 4, type: 'user_question', data: { question: '你接触过编程吗？', options: [{ id: 'none', label: '完全没碰过' }] } },
    { id: 5, type: 'session_end', data: { status: 'succeeded' } },
    { id: 6, type: 'user_message', data: { text: '完全没碰过' } },
    { id: 7, type: 'session_resumed', data: {} }
  ].forEach((event) => page.handleAgentEvent(event))

  const thinking = () => page.data.messages.filter((message) => message.kind === 'thinking')
  assert.equal(thinking()[0].preview, '围绕「我想学编程」，先确认你的学习情况')
  assert.equal(thinking()[1].preview, '正在分析你的回答「完全没碰过」', '思考中就给出方向')

  ;[
    { id: 8, type: 'message_start', data: { message: { role: 'assistant', content: [] } } },
    { id: 9, type: 'message_end', data: { message: reply('**零基础**，那我心里就有数了。先做个热身。') } },
    { id: 10, type: 'user_question', data: { question: 'x = 3 时 2x + 1 等于？', options: [{ id: 'seven', label: '7' }] } },
    { id: 11, type: 'session_end', data: { status: 'succeeded' } }
  ].forEach((event) => page.handleAgentEvent(event))

  const cards = thinking()
  assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, '同一毫秒回放也不会出现重复 key')
  assert.equal(cards[1].streaming, false)
  // 小字是"这一轮在想什么"的一句话总结，不是回复正文本身
  assert.equal(cards[1].preview, '根据你的回答「完全没碰过」，继续了解你的基础')
  page.onUnload()
})
