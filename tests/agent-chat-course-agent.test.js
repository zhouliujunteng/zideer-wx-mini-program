const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/agent-chat/index.js')

function loadPage() {
  delete require.cache[pagePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo() {
      return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }
    },
    getMenuButtonBoundingClientRect() {
      return { left: 276, top: 26, width: 87, height: 32 }
    },
    getStorageSync() { return '' },
    setStorageSync() {},
    showToast() {},
    setClipboardData() {},
    request() {},
    nextTick(callback) { callback() },
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  return definition
}

function instantiate(definition) {
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('agent-chat keeps the designer page contract and boots idle', () => {
  const definition = loadPage()
  assert.ok(definition && typeof definition.sendMessage === 'function')
  const page = instantiate(definition)
  page.onLoad({})
  assert.equal(page._agentMock, false)
  assert.equal(page.data.messages.length, 0)
  assert.equal(page.data.isSending, false)
})

test('mock timeline drives the designer page into a pseudo-thinking conversation', async () => {
  const definition = loadPage()
  const page = instantiate(definition)
  page.onLoad({ mock: '1' })
  assert.ok(page._mockPlayer, 'mock 时间线应立即启动')

  // c1(web_search) 于 1050ms 开始、2450ms 结束；留渲染节流余量
  await sleep(2700)
  const kinds = page.data.messages.map((message) => message.kind || message.role)
  assert.ok(kinds.includes('user'), '用户气泡应已出现')
  assert.ok(kinds.includes('thinking'), '伪思考条应已出现')
  assert.ok(kinds.includes('tool'), '工具卡应已出现')

  const tool = page.data.messages.find((message) => message.kind === 'tool')
  assert.equal(tool.state, 'done')
  assert.equal(tool.label, '联网搜索「小学五年级 分数加减 教学要点」')
  assert.ok(tool.argsText.includes('query'))
  assert.equal(tool.resultText, '8 条来源：同分母先加减、异分母通分、约分最简…')

  const thinking = page.data.messages.find((message) => message.kind === 'thinking')
  assert.ok(thinking.lines.length >= 1)
  page.onUnload()
})

test('ask_user lands a question card; answering resumes and streams the final reply', async () => {
  const definition = loadPage()
  const page = instantiate(definition)
  page.onLoad({ mock: '1' })
  await sleep(8600)
  const question = page.data.messages.find((message) => message.kind === 'question' && !message.answered)
  assert.ok(question, '问题卡应已出现')
  assert.equal(question.options.length, 3)

  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'quiz' } } })
  page.handleQuestionConfirm({ currentTarget: { dataset: { questionId: question.id } } })
  // 作答后的下半场累计约 6350ms
  await sleep(6900)

  const assistant = page.data.messages.filter((message) => message.role === 'assistant').pop()
  assert.ok(assistant, '助手回复应已生成')
  assert.ok(assistant.text.includes('分数加减'))
  assert.equal(assistant.isTyping, false)
  assert.equal(page.data.isSending, false)

  const stage = page.data.messages.find((message) => message.kind === 'stage')
  assert.ok(stage, '课程链接卡应已出现')
  const answered = page.data.messages.find((message) => message.kind === 'question')
  assert.equal(answered.answered, true)
  page.onUnload()
})

test('tool cards expand into code blocks and thinking bar settles with the reply', async () => {
  const definition = loadPage()
  const page = instantiate(definition)
  page.onLoad({ mock: '1' })
  await sleep(8600)

  const tool = page.data.messages.find((message) => message.kind === 'tool')
  page.handleActivityToggle({ currentTarget: { dataset: { id: tool.id } } })
  await sleep(200)
  const expanded = page.data.messages.find((message) => message.id === tool.id)
  assert.equal(expanded.expanded, true)

  const thinking = page.data.messages.find((message) => message.kind === 'thinking')
  assert.equal(thinking.streaming, true, 'run 停在提问时思考条仍打开')
  page.onUnload()
})

test('sendMessage appends the user bubble and keeps composer state consistent', async () => {
  const definition = loadPage()
  const page = instantiate(definition)
  page.onLoad({ mock: '1' })
  // mock 时间线已在跑：等首轮问题出现后由用户继续追问
  await sleep(8600)
  page.setData({ inputValue: '再加一页练习' })
  page.sendMessage('再加一页练习')
  assert.equal(page.data.messages[page.data.messages.length - 1].text, '再加一页练习')
  assert.equal(page.data.isSending, true)
  page.onUnload()
})
