// 小程序链接页：推广的人在这一页用右上角「复制链接」拿蓝色链接（2026-11-10 起不带邀请码）；
// 同一个地址被好友点开（本页是唯一一页）时直接回首页，朋友圈单页只放说明。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
require('./helpers/stub-ui-assets')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pagePath = require.resolve('../agent/share-link/index.js')
const identityPath = require.resolve('../services/identity.js')

function loadPage({ identity = {}, pageStack = [{}, {}], launchScene = 1001 } = {}) {
  delete require.cache[pagePath]
  const identityStub = {
    loadCurrentPromotionCode: async () => ({ promotionCode: 'ZLK7M2X4QP', qrUrl: '' }),
    ...identity
  }
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: identityStub }
  let definition = null
  const calls = { redirect: [], reLaunch: [], navigate: [], copyUrl: [], clipboard: [], toast: [] }
  const storage = {}
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => pageStack
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    getLaunchOptionsSync: () => ({ scene: launchScene, query: {} }),
    redirectTo: (opts) => calls.redirect.push(opts.url),
    reLaunch: (opts) => calls.reLaunch.push(opts.url),
    navigateTo: (opts) => calls.navigate.push(opts.url),
    navigateBack: () => calls.navigate.push('back'),
    onCopyUrl: (handler) => calls.copyUrl.push(handler),
    offCopyUrl: (handler) => { calls.copyUrl = calls.copyUrl.filter((item) => item !== handler) },
    setClipboardData: (opts) => { calls.clipboard.push(opts.data); if (opts.success) opts.success() },
    showToast: (opts) => calls.toast.push(opts.title),
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    removeStorageSync: (key) => { delete storage[key] }
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback() }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, calls, storage }
}

test('推广的人打开就看到教程，不读邀请码；转发卡片进首页', async () => {
  let loads = 0
  const { page, calls } = loadPage({ identity: { loadCurrentPromotionCode: async () => { loads += 1; return null } } })
  await page.onLoad({})
  assert.equal(page.data.loadState, 'ready')
  assert.equal(loads, 0)
  assert.equal(page.data.pointerLeft, Math.round(283 + 87 / 4))
  assert.equal(page.onShareAppMessage().path, '/pages/home/index')
  assert.deepEqual(calls.redirect, [])
})

test('好友点开复制的链接：回首页，不记推荐人线索', async () => {
  const { page, calls, storage } = loadPage({ pageStack: [{}] })
  await page.onLoad({ pc: 'ZLK7M2X4QP' })
  assert.deepEqual(calls.reLaunch, ['/pages/home/index'])
  assert.deepEqual(storage, {})
})

test('朋友圈单页里好友只看到说明，不跳页', async () => {
  const { page, calls } = loadPage({ pageStack: [{}], launchScene: 1154 })
  await page.onLoad({})
  assert.equal(page.data.loadState, 'timeline')
  assert.deepEqual(calls.reLaunch, [])
  assert.doesNotMatch(read('agent/share-link/index.wxml'), /邀请码/)
})
