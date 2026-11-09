// 小程序链接页：推广的人在这一页用右上角「复制链接」拿蓝色链接，页面地址自带邀请码；
// 同一个地址被好友点开（本页是唯一一页）时记下推荐人线索回首页，朋友圈单页只放邀请说明。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
require('./helpers/stub-ui-assets')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const pagePath = require.resolve('../agent/share-link/index.js')
const identityPath = require.resolve('../services/identity.js')
const view = require('../services/promotion-view')

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

test('a promoter opening the page with their code sees the tutorial at once and copies a link carrying the code', async () => {
  let loads = 0
  const { page, calls } = loadPage({ identity: { loadCurrentPromotionCode: async () => { loads += 1; return null } } })
  await page.onLoad({ pc: 'zlk7m2x4qp' })
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.code, 'ZLK7M2X4QP')
  assert.equal(loads, 0, '地址里已有邀请码就不再读后端')
  // 「第 1 步点这里」对准胶囊左半边「···」的中心、胶囊下方 6px
  assert.equal(page.data.pointerLeft, Math.round(283 + 87 / 4))
  assert.equal(page.data.pointerTop, 50 + 32 + 6)

  page.onShow()
  assert.equal(calls.copyUrl.length, 1)
  assert.deepEqual(calls.copyUrl[0](), { query: 'pc=ZLK7M2X4QP' })
  page.onHide()
  assert.equal(calls.copyUrl.length, 0)

  // 菜单里「复制链接」要靠页面定义转发才出现；转发卡片同样带邀请码
  assert.equal(page.onShareAppMessage().path, '/pages/referral-entry/index?pc=ZLK7M2X4QP')

  page.copyCode()
  assert.deepEqual(calls.clipboard, ['ZLK7M2X4QP'])
  page.handleScroll({ detail: { scrollTop: 120 } })
  assert.equal(page.data.scrolled, true, '滚动后收起指向胶囊的提示')
  page.handleScroll({ detail: { scrollTop: 0 } })
  assert.equal(page.data.scrolled, false)
})

test('without a code in the address the page fetches mine and writes it into its own address', async () => {
  const { page, calls } = loadPage()
  await page.onLoad({})
  assert.deepEqual(calls.redirect, ['/agent/share-link/index?pc=ZLK7M2X4QP'])
  assert.equal(page.data.loadState, 'loading', '换地址之前只显示骨架')
})

test('a malformed code in the address is not trusted', async () => {
  const { page, calls } = loadPage()
  await page.onLoad({ pc: 'not-a-code' })
  assert.deepEqual(calls.redirect, ['/agent/share-link/index?pc=ZLK7M2X4QP'])
})

test('failing to read the code shows an error with retry instead of a link without a referrer', async () => {
  let attempt = 0
  const { page, calls } = loadPage({
    identity: {
      loadCurrentPromotionCode: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('邀请码分配失败，请稍后重试。')
        return { promotionCode: 'ZLK7M2X4QP' }
      }
    }
  })
  await page.onLoad({})
  assert.equal(page.data.loadState, 'failed')
  assert.match(page.data.loadError, /邀请码分配失败/)
  page.onShow()
  assert.equal(calls.copyUrl.length, 0, '没有邀请码时不接管复制链接')
  await page.loadCode()
  assert.deepEqual(calls.redirect, ['/agent/share-link/index?pc=ZLK7M2X4QP'])
})

test('a friend opening a copied link keeps the referral and goes home', async () => {
  let loads = 0
  const { page, calls, storage } = loadPage({
    pageStack: [{}],
    identity: { loadCurrentPromotionCode: async () => { loads += 1; return null } }
  })
  await page.onLoad({ pc: 'ZLK7M2X4QP' })
  assert.deepEqual(calls.reLaunch, ['/pages/home/index'])
  assert.equal(storage.pending_referral_context.code, 'ZLK7M2X4QP')
  assert.equal(loads, 0, '好友看不到推广的人的教程页，也不读邀请码')
})

test('a friend arriving in the moments single page sees an invitation note and is not redirected', async () => {
  const { page, calls, storage } = loadPage({ pageStack: [{}], launchScene: 1154 })
  await page.onLoad({ pc: 'ZLK7M2X4QP' })
  assert.equal(page.data.loadState, 'timeline')
  assert.deepEqual(calls.reLaunch, [])
  assert.equal(storage.pending_referral_context.code, 'ZLK7M2X4QP')
})

test('every entry opens the link page with the code in its address when the code is known', () => {
  assert.equal(view.shareLinkPageUrl('zlk7m2x4qp'), '/agent/share-link/index?pc=ZLK7M2X4QP')
  assert.equal(view.shareLinkPageUrl('pm04_demo'), '/agent/share-link/index', '不合格式的码交给那一页自己取')
  assert.equal(view.shareLinkPageUrl(''), '/agent/share-link/index')

  const app = JSON.parse(read('app.json'))
  const agent = (app.subpackages || app.subPackages).find((item) => item.root === 'agent')
  assert.ok(agent.pages.includes('share-link/index'))

  // 我的邀请码卡片、海报详情与 AI 海报的分享层都有入口
  assert.match(read('agent/share-tools/index.wxml'), /bindtap="openShareLink"/)
  assert.match(read('agent/poster-detail/index.wxml'), /bindtap="handleOpenShareLink"[\s\S]*复制链接/)
  assert.match(read('agent/ai-poster/index.wxml'), /bindtap="handleOpenShareLink"[\s\S]*复制链接/)

  const wxml = read('agent/share-link/index.wxml')
  assert.match(wxml, /<dev-reset-fab\s*\/>/)
  // 邀请码是后端数据：没读到之前只画骨架
  assert.match(wxml, /wx:if="\{\{loadState === 'ready'\}\}" class="share-link-hero-code-row"/)
  assert.match(wxml, /wx:else class="sk share-link-sk-code"/)
})
