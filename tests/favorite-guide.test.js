// 首页「设为星标 / 添加到桌面」引导：进首页弹一次，箭头指着胶囊「···」；
// 点「不再提醒」后这台手机不再弹；桌面图标打开、已设星标、朋友圈单页都不弹。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const componentPath = require.resolve('../components/favorite-guide/index.js')

function loadGuide({ storage = {}, scene = 1001, starred = false, checkApi = true } = {}) {
  delete require.cache[componentPath]
  let definition = null
  const tabBar = { data: { hidden: false }, setData(patch) { Object.assign(this.data, patch) } }
  global.Component = (value) => { definition = value }
  global.getCurrentPages = () => [{ route: 'pages/home/index', getTabBar: () => tabBar }]
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 283, top: 50, width: 87, height: 32 }),
    getLaunchOptionsSync: () => ({ scene, query: {} }),
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    checkIsAddedToMyMiniProgram: checkApi ? ({ success }) => success({ added: starred }) : undefined
  }
  require(componentPath)
  const make = () => {
    const instance = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) { Object.assign(this.data, patch) },
      ...definition.methods
    }
    return {
      instance,
      attach: () => definition.lifetimes.attached.call(instance),
      detach: () => definition.lifetimes.detached.call(instance)
    }
  }
  return { make, storage, tabBar }
}

async function flush(t, ms) {
  t.mock.timers.tick(ms)
  await new Promise((resolve) => setImmediate(resolve))
}

test('entering home shows the guide once, pointing at the capsule dots, and hides the tab bar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { make, tabBar } = loadGuide()
  const first = make()
  first.attach()
  assert.equal(first.instance.data.visible, false, '稍等一下再弹，不和首页首帧抢')
  await flush(t, 800)
  const data = first.instance.data
  assert.equal(data.visible, true)
  assert.equal(tabBar.data.hidden, true, '自定义底栏收起，遮罩盖得住整屏')
  // 光圈圆心在胶囊左半边（「···」）中心
  assert.equal(data.ringLeft + data.ringSize / 2, Math.round(283 + 87 / 4))
  assert.equal(data.ringTop + data.ringSize / 2, 50 + 32 / 2)
  // 卡片挂在胶囊下方，手机上水平居中（620rpx = 310px）；箭头尖对准「···」（箭头半宽 14rpx = 7px）
  assert.equal(data.cardTop, 50 + 32 + 14)
  assert.equal(data.cardRight, Math.round((375 - 310) / 2))
  assert.ok(Math.abs(375 - data.cardRight - data.arrowRight - 7 - (283 + 87 / 4)) <= 1, '箭头尖对准「···」（取整误差 1px 内）')

  first.instance.handleLater()
  assert.equal(tabBar.data.hidden, false, '关掉就放出底栏')
  await flush(t, 200)
  assert.equal(first.instance.data.visible, false)

  // 同一次打开里再回到首页（reLaunch 重建首页）不再弹
  const again = make()
  again.attach()
  await flush(t, 800)
  assert.equal(again.instance.data.visible, false)
})

test('on a wide window the card moves right so the arrow still lands on it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { make } = loadGuide()
  global.wx.getWindowInfo = () => ({ windowWidth: 1024, windowHeight: 768, statusBarHeight: 24 })
  global.wx.getMenuButtonBoundingClientRect = () => ({ left: 930, top: 28, width: 87, height: 32 })
  const guide = make()
  guide.attach()
  await flush(t, 800)
  const { cardRight, arrowRight } = guide.instance.data
  const cardWidth = 620 * 0.6
  const dotsX = 930 + 87 / 4
  assert.ok(arrowRight >= 24 && arrowRight <= cardWidth - 24, '箭头落在卡片上、不贴边')
  assert.ok(Math.abs(1024 - cardRight - arrowRight - 14 * 0.6 - dotsX) <= 1)
})

test('never-again is remembered on this phone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { make, storage } = loadGuide()
  const guide = make()
  guide.attach()
  await flush(t, 800)
  guide.instance.handleNeverAgain()
  assert.equal(storage.zhilu_favorite_guide_dismissed, true)

  // 下次打开小程序（模块重新加载）也不再弹
  const next = loadGuide({ storage }).make()
  next.attach()
  await flush(t, 800)
  assert.equal(next.instance.data.visible, false)
})

test('opening from the desktop icon, from moments, or when already starred shows nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const options of [{ scene: 1023 }, { scene: 1154 }, { starred: true }]) {
    const { make, tabBar } = loadGuide(options)
    const guide = make()
    guide.attach()
    await flush(t, 800)
    assert.equal(guide.instance.data.visible, false, JSON.stringify(options))
    assert.equal(tabBar.data.hidden, false)
  }
})

test('without the starred check API the guide still shows', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const guide = loadGuide({ checkApi: false }).make()
  guide.attach()
  await flush(t, 800)
  assert.equal(guide.instance.data.visible, true)
})

test('leaving home while the guide is open gives the tab bar back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { make, tabBar } = loadGuide()
  const guide = make()
  guide.attach()
  await flush(t, 800)
  assert.equal(tabBar.data.hidden, true)
  guide.detach()
  assert.equal(tabBar.data.hidden, false)
})

test('home mounts the guide and the tab bar can be hidden', () => {
  assert.equal(JSON.parse(read('pages/home/index.json')).usingComponents['favorite-guide'], '/components/favorite-guide/index')
  assert.match(read('pages/home/index.wxml'), /<favorite-guide\s*\/>/)
  assert.match(read('custom-tab-bar/index.wxml'), /<view wx:if="\{\{!hidden\}\}" class="tabbar"/)
  const wxml = read('components/favorite-guide/index.wxml')
  assert.match(wxml, /bindtap="handleNeverAgain"[^>]*>不再提醒</)
  assert.match(wxml, /设为星标/)
  assert.match(wxml, /添加到桌面/)
})
