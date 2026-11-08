const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const screen = require('../utils/screen')
const normalWindow = { windowWidth: 640, windowHeight: 954, screenWidth: 640, statusBarHeight: 40 }
const scaledWindow = { windowWidth: 480, windowHeight: 715, screenWidth: 640, statusBarHeight: 40 }
const normalMenu = { left: 536, top: 46, width: 96, height: 32, right: 632, bottom: 78 }
const scaledMenu = { left: 501, top: 61, width: 96, height: 32, right: 597, bottom: 93 }

test('both observed OPPO widths use fixed-size layout; phone widths stay unchanged', () => {
  for (const width of [480, 640]) {
    assert.equal(screen.isLargeScreen(width), true)
    assert.equal(screen.rpxToPx(176, width), 105.6)
    assert.equal(screen.columnWidth(width, 1040), width)
  }
  for (const width of [320, 375, 390, 440]) {
    assert.equal(screen.isLargeScreen(width), false)
    assert.equal(screen.rpxToPx(100, width), 100 * (width / 750))
  }
})

test('OPPO capsule origins outside the viewport are converted, preserving native size', () => {
  assert.equal(typeof screen.normalizeMenuButtonRect, 'function')
  const menu = screen.normalizeMenuButtonRect(scaledWindow, scaledMenu)
  assert.equal(menu.left, 375.75)
  assert.equal(menu.top, 45.75)
  assert.equal(menu.width, 96)
  assert.equal(menu.height, 32)
  assert.equal(menu.right, 471.75)
  const buttonRight = 480 - menu.left + 8
  assert.equal(buttonRight, 112.25)
  assert.equal(480 - buttonRight, menu.left - 8)
})

test('valid native rectangles stay unchanged, including real split-screen windows', () => {
  assert.equal(typeof screen.normalizeMenuButtonRect, 'function')
  assert.deepEqual(screen.normalizeMenuButtonRect(normalWindow, normalMenu), normalMenu)
  const splitMenu = { left: 376, top: 46, width: 96, height: 32, right: 472, bottom: 78 }
  assert.deepEqual(screen.normalizeMenuButtonRect(scaledWindow, splitMenu), splitMenu)
  const phoneMenu = { left: 281, top: 50, width: 87, height: 32 }
  assert.deepEqual(screen.normalizeMenuButtonRect({ windowWidth: 390 }, phoneMenu), phoneMenu)
})

test('tab pages and capsule guide use the same normalized menu reader', () => {
  for (const file of ['pages/home/index.js', 'pages/me/index.js', 'pages/learning/index.js', 'pages/knowledge-map/index.js', 'pages/knowledge-universe/index.js', 'components/favorite-guide/index.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    assert.match(source, /getMenuButtonRect\(windowInfo\)/, file)
    assert.doesNotMatch(source, /wx\.getMenuButtonBoundingClientRect\(/, file)
  }
})

test('actual home/me onLoad place actions left of the capsule in both captured states', () => {
  const vm = require('node:vm')
  for (const [windowInfo, rawMenu] of [[normalWindow, normalMenu], [scaledWindow, scaledMenu]]) {
    const wxMock = { getWindowInfo: () => windowInfo, getMenuButtonBoundingClientRect: () => rawMenu }
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/screen.js'), 'utf8'), { module, wx: wxMock })
    const helpers = module.exports
    for (const pageName of ['home', 'me']) {
      let page
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../pages/${pageName}/index.js`), 'utf8'), {
        wx: wxMock, Page: value => { page = value },
        require: name => name.endsWith('/screen') ? helpers : {
          attachUiAssets() {}, membershipView: () => ({}), getMeModel: () => ({}),
          withGuardianQuickActions: values => values, isGuardianAccount: () => false,
          miniProgramVersionText: () => ''
        }
      })
      const instance = { data: {}, setData(value) { Object.assign(this.data, value) } }
      page.onLoad.call(instance)
      const menu = helpers.normalizeMenuButtonRect(windowInfo, rawMenu)
      const right = pageName === 'home' ? instance.data.streakEntryRight : instance.data.editProfileRight
      const top = pageName === 'home' ? instance.data.streakEntryTop : instance.data.editProfileTop
      assert.equal(windowInfo.windowWidth - right, menu.left - 8, pageName)
      assert.equal(top, menu.top, pageName)
      assert.ok(instance.data.contentTop > menu.bottom, pageName)
    }
  }
})

test('streak calendar keeps seven date cells from shrinking into overlapping numbers', async () => {
  const { largeStylesFromCss } = await import('../scripts/build-large-screen-styles.mjs')
  const source = fs.readFileSync(path.join(__dirname, '../components/streak-card/index.wxss'), 'utf8')
  assert.match(source, /\.streak-card\s*\{[^}]*flex-wrap:\s*wrap/)
  assert.match(source, /\.streak-week\s*\{[^}]*flex:\s*1 1 392rpx/)
  assert.match(source, /\.streak-day\s*\{[^}]*flex:\s*1 0 56rpx/)
  const generated = largeStylesFromCss(source.replace(/@import[^;]+;/g, ''))
  assert.match(generated, /min-width:235px/)
  // 480px window: card interior ~406px; summary 264 + calendar 235 + gap 19 cannot share a row.
  assert.ok(264 + 235 + 19 > 480 - 42 - 32)
  // 640px window: the same content fits without shrinking a single day below its 33px mark.
  assert.ok(264 + 235 + 19 < 640 - 42 - 32)
})
