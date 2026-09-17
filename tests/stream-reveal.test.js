const assert = require('node:assert/strict')
const test = require('node:test')

const {
  REVEAL_TICK_MS,
  FADE_MS,
  MIN_OPACITY,
  createStreamReveal,
  fadeTailHtml,
  closeDanglingMarkers,
  renderRevealFrame
} = require('../utils/stream-reveal')
const { renderMarkdown } = require('../utils/markdown')

test('a burst snapshot is released gradually and speeds up with backlog', () => {
  const reveal = createStreamReveal()
  const burst = '你好呀，我是知鹿的学习助手。看了下你的档案，初三上学期，数学二次函数还需要巩固。'
  reveal.setTarget(burst)
  let now = 0
  const first = reveal.tick(now)
  assert.ok(first.shown >= 1 && first.shown < burst.length / 4, '一整批文字不能一次性全部出现')
  const counts = [first.shown]
  for (let i = 0; i < 40; i += 1) {
    now += REVEAL_TICK_MS
    counts.push(reveal.tick(now).shown)
  }
  assert.equal(counts[counts.length - 1], Array.from(burst).length, '约 2 秒内追平')
  for (let i = 1; i < counts.length; i += 1) assert.ok(counts[i] >= counts[i - 1])

  // 积压大时单帧释放更多
  const big = createStreamReveal()
  big.setTarget('字'.repeat(800))
  assert.ok(big.tick(0).shown > first.shown)
})

test('each character fades from light to dark and the frame settles fully opaque', () => {
  const reveal = createStreamReveal()
  reveal.setTarget('渐变出现')
  reveal.tick(0)
  assert.equal(reveal.opacityAt(0, 0), MIN_OPACITY)
  const middle = reveal.opacityAt(0, FADE_MS / 2)
  assert.ok(middle > MIN_OPACITY && middle < 1)
  assert.equal(reveal.opacityAt(0, FADE_MS + REVEAL_TICK_MS), 1)

  reveal.setTarget('渐变出现', { final: true })
  let now = 0
  let frame
  for (let i = 0; i < 30; i += 1) {
    now += REVEAL_TICK_MS
    frame = reveal.tick(now)
    if (frame.done) break
  }
  assert.equal(frame.done, true)
  assert.equal(frame.text, '渐变出现')
})

test('rewritten snapshots rewind to the common prefix instead of showing stale text', () => {
  const reveal = createStreamReveal()
  reveal.setTarget('abcdef')
  for (let i = 0; i < 10; i += 1) reveal.tick(i * REVEAL_TICK_MS)
  reveal.setTarget('abXY')
  assert.ok(reveal.tick(1000).text.startsWith('ab'))
  assert.ok(!reveal.tick(1050).text.includes('c'))
})

test('fade spans wrap only visible tail characters and keep markdown markup intact', () => {
  const html = renderMarkdown('先看 **二次函数** & 图像')
  const faded = fadeTailHtml(html, (distance) => (distance < 3 ? 0.3 : 1))
  assert.match(faded, /<strong>二次函数<\/strong>/)
  assert.ok(!faded.includes('<span style="opacity:0.3;">&amp;</span>'), '距末尾第 3 个之外不包裹')
  assert.equal((faded.match(/opacity:0\.3/g) || []).length, 3)
  assert.ok(faded.endsWith('<span style="opacity:0.3;">像</span></p>'))

  const emoji = fadeTailHtml(renderMarkdown('你好👋'), () => 0.5)
  assert.ok(emoji.includes('<span style="opacity:0.5;">👋</span>'), 'emoji 代理对不能被拆开')

  const reveal = createStreamReveal()
  reveal.setTarget('第一行\n第二行')
  const frame = reveal.tick(0)
  const rendered = renderRevealFrame(frame.text, reveal, 0, renderMarkdown)
  assert.match(rendered, /opacity:0\.12/)
})

test('dangling bold and inline code are closed while streaming so markers never flash', () => {
  assert.equal(closeDanglingMarkers('档案：**初三上学'), '档案：**初三上学**')
  assert.equal(closeDanglingMarkers('档案：**初三上学期**，数学'), '档案：**初三上学期**，数学')
  assert.equal(closeDanglingMarkers('档案：**'), '档案：')
  assert.equal(closeDanglingMarkers('运行 `npm'), '运行 `npm`')
  assert.equal(closeDanglingMarkers('```js'), '```js')
  const reveal = createStreamReveal()
  reveal.setTarget('看了下你的档案：**初三上学')
  for (let i = 0; i < 40; i += 1) reveal.tick(i * REVEAL_TICK_MS)
  const html = renderRevealFrame('看了下你的档案：**初三上学', reveal, 5000, renderMarkdown)
  assert.ok(!html.includes('**'))
  assert.match(html, /<strong>初三上学<\/strong>/)
})

// ---------- 页面：直播流中成批快照被匀速渐显，结束后无残留 span ----------

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
    nextTick: (callback) => callback(),
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  const patches = []
  page.setData = (patch) => {
    patches.push(Object.keys(patch))
    Object.entries(patch).forEach(([key, value]) => {
      if (!/[.[]/.test(key)) page.data[key] = value
    })
  }
  return { page, patches }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('live stream reveals burst snapshots smoothly and patches only the streaming bubble', async () => {
  const { page, patches } = loadPage()
  page.onLoad({})
  page._agentStreamLive = true
  page.setData({ isSending: true, messages: [{ id: 'u', role: 'user', text: '讲讲二次函数' }, { id: 'a', role: 'assistant', text: '', isTyping: true }] })
  const reply = '二次函数的图像是一条抛物线。开口方向由 a 的正负决定，对称轴是 x = -b/2a。我们先从描点画图开始。'
  const assistant = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] })

  page.handleAgentEvent({ id: 1, type: 'message_update', data: { message: assistant(reply.slice(0, 30)) } })
  await sleep(REVEAL_TICK_MS * 2 + 20)
  const bubble = page.data.messages[1]
  assert.ok(bubble.text.length > 0 && bubble.text.length < 30, '成批快照被逐步释放')
  assert.match(bubble.markdownNodes, /opacity:0\.\d+/, '新出现的字带渐显')
  assert.ok(patches.some((keys) => keys.includes('messages[1].markdownNodes')), '只更新流式气泡')
  assert.ok(!patches.slice(-3).some((keys) => keys.includes('messages')), '渐显帧不整表下发')

  page.handleAgentEvent({ id: 2, type: 'message_update', data: { message: assistant(reply) } })
  page.handleAgentEvent({ id: 3, type: 'message_end', data: { message: assistant(reply) } })
  await sleep(1600)
  assert.equal(bubble.text, reply)
  assert.equal(bubble.isTyping, false)
  assert.ok(!bubble.markdownNodes.includes('opacity'), '收尾后没有残留渐变')
  assert.equal(page._streamReveal, null)
  page.onUnload()
})

test('history replay before caught_up renders without animation', async () => {
  const { page } = loadPage()
  page.onLoad({})
  page._agentStreamLive = false
  page.setData({ messages: [{ id: 'a', role: 'assistant', text: '', isTyping: true }] })
  page.handleAgentEvent({ id: 1, type: 'message_update', data: { message: { role: 'assistant', content: [{ type: 'text', text: '历史回复整段出现' }] } } })
  await sleep(200)
  assert.equal(page.data.messages[0].text, '历史回复整段出现')
  assert.ok(!page.data.messages[0].markdownNodes.includes('opacity'))
  page.onUnload()
})
