const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../pages/agent-chat/index.js')

// 历史抽屉的标题来自服务端一句话总结；没有总结（旧会话）才退回首条提问。
function loadPage({ storage = {}, onRequest } = {}) {
  delete require.cache[pagePath]
  let definition = null
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 276, top: 26, width: 87, height: 32 }),
    getStorageSync: (key) => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] },
    showToast() {},
    request(options) {
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
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let target = page.data
      parts.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return page
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const PROMPT = '帮我把三年级下册分数加减讲清楚，孩子通分老是错\n\n<zhilu-learner-context>\n{}\n</zhilu-learner-context>\n【知鹿学习选项】参考我的宇宙：开'

function openHistory(sessions) {
  const storage = { zion_runtime_token: 'jwt', 'course-agent-access-token': 'access' }
  const page = loadPage({
    storage,
    onRequest(options) {
      if (/\/api\/agent\/sessions$/.test(options.url)) {
        options.success({ statusCode: 200, data: sessions, header: {} })
      }
    }
  })
  page.onLoad({})
  page.openHistory()
  return page
}

test('历史对话标题用服务端总结，不是用户第一段话', async () => {
  const page = openHistory([
    { id: 'session-1', prompt: PROMPT, title: '三年级分数加减通分', status: 'succeeded', updatedAt: Date.now() }
  ])
  await sleep(30)

  const item = page.data.historyItems[0]
  assert.equal(item.title, '三年级分数加减通分')
  assert.ok(!item.title.includes('孩子通分老是错'), '标题不再是提问原文的截断')
  page.onUnload()
})

test('没有总结的旧会话仍退回首条提问，并去掉学习选项附录', async () => {
  const page = openHistory([
    { id: 'session-2', prompt: PROMPT, status: 'succeeded', updatedAt: Date.now() }
  ])
  await sleep(30)

  const item = page.data.historyItems[0]
  assert.equal(item.title, '帮我把三年级下册分数加减讲清楚，孩子通分老是错'.slice(0, 24))
  assert.ok(!item.title.includes('知鹿学习选项'))
  page.onUnload()
})

test('标题变成总结之后，按提问原话仍能搜到', async () => {
  const page = openHistory([
    { id: 'session-1', prompt: PROMPT, title: '三年级分数加减通分', status: 'succeeded', updatedAt: Date.now() }
  ])
  await sleep(30)

  page.handleHistorySearch({ detail: { value: '孩子通分老是错' } })
  assert.equal(page.data.historyItems.length, 1, '提问原话仍在可搜索字段里')

  page.handleHistorySearch({ detail: { value: '没有这句话' } })
  assert.equal(page.data.historyItems.length, 0)
  page.onUnload()
})
