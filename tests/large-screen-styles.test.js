// 平板、电脑大屏适配（utils/screen.js、scripts/build-large-screen-styles.mjs）。
// 大屏下 rpx 按固定比例换算，靠每个 wxss 末尾引入的 .large.wxss；改了样式没重新生成、
// 或者绕开换算写了 rpx，平板上就会重新出现「整体放大、和胶囊比例失调」。
const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const generator = path.join(root, 'scripts/build-large-screen-styles.mjs')
const loadGenerator = () => import(require('node:url').pathToFileURL(generator).href)

function walk(dir, pattern, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'scripts'].includes(entry.name) || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, pattern, out)
    else if (pattern.test(entry.name)) out.push(full)
  }
  return out
}

test('generated large-screen styles are up to date (run node scripts/build-large-screen-styles.mjs)', () => {
  const result = spawnSync(process.execPath, [generator, '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('rpx converts like the base library at the large-screen scale, leaving strings and urls alone', async () => {
  const { convert } = await loadGenerator()
  const { LARGE_SCREEN_RPX } = require('../utils/screen')
  assert.equal(LARGE_SCREEN_RPX, 0.6)
  assert.equal(convert('22rpx 16rpx'), '13px 9px')
  assert.equal(convert('-8rpx'), '-5px')
  assert.equal(convert('1rpx solid #eee'), '0.5px solid #eee')
  assert.equal(convert('calc(100% - 72rpx)'), 'calc(100% - 43px)')
  assert.equal(convert('url(a-10rpx.png) 4rpx'), 'url(a-10rpx.png) 2px')
  assert.equal(convert('"12rpx"'), '"12rpx"')
})

test('rewrites keep the cascade: later same-family rules without rpx are carried along', async () => {
  const { largeStylesFromCss } = await loadGenerator()
  const css = largeStylesFromCss('.a{padding:20rpx;color:red}.b{padding-top:0;color:blue}@media (max-width: 350px){.a{padding:0}}')
  assert.match(css, /\.a\{padding:12px\}/)
  assert.match(css, /\.b\{padding-top:0\}/)
  assert.doesNotMatch(css, /color/)
  assert.doesNotMatch(css, /max-width: 350px/)
})

test('fixed bars and full-screen masks are pinned to the centered column', async () => {
  const { largeStylesFromCss } = await loadGenerator()
  const css = largeStylesFromCss([
    '.bar{position:fixed;right:0;bottom:0;left:0;padding:18rpx}',
    '.mask{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.3)}',
    '.pill{position:fixed;left:50%;transform:translateX(-50%)}'
  ].join(''))
  assert.match(css, /\.bar\{right:max\(0px, 50% - var\(--lg-col\) \/ 2\);bottom:0;left:max\(0px, 50% - var\(--lg-col\) \/ 2\);padding:10px\}/)
  assert.match(css, /\.mask\{[^}]*box-shadow:0 0 0 100vmax rgba\(0,0,0,.3\)/)
  // 居中定位的不动（为保持层叠顺序会原样重写一遍）
  assert.match(css, /\.pill\{left:50%\}/)
  const app = largeStylesFromCss('', { app: true })
  assert.match(app, /page\{--lg-col:450px;max-width:var\(--lg-col\)/)
})

test('every stylesheet with a .large.wxss imports it as its last statement', () => {
  const missing = []
  for (const large of walk(root, /\.large\.wxss$/)) {
    const source = large.replace(/\.large\.wxss$/, '.wxss')
    const text = fs.existsSync(source) ? fs.readFileSync(source, 'utf8').trim() : ''
    const last = text.split('\n').pop()
    if (!last.startsWith(`@import "./${path.basename(large)}";`)) missing.push(path.relative(root, source))
  }
  assert.deepEqual(missing, [])
})

// 行内 style 里的 rpx 由基础库按窗口宽度换算，大屏下会整体放大。
// 动态尺寸改为把 rpx 设计值写进 CSS 变量（style="--h: {{h}}"），在 wxss 里 calc(var(--h) * 1000rpx / 1000)。
test('wxml inline styles do not use rpx', () => {
  const offenders = []
  for (const file of walk(root, /\.wxml$/)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/style="([^"]*)"/g)) {
      if (/\drpx|\}\}rpx/.test(match[1])) offenders.push(`${path.relative(root, file)}: ${match[1].slice(0, 80)}`)
    }
  }
  assert.deepEqual(offenders, [])
})

// JS 里的 rpx 换算要和样式一致：大屏下 1rpx 不再等于 windowWidth / 750。
test('page scripts convert rpx through utils/screen instead of windowWidth / 750', () => {
  const offenders = walk(root, /\.js$/)
    .filter((file) => !file.endsWith(path.join('utils', 'screen.js')))
    .filter((file) => /(windowWidth|width)\s*\/\s*750|\*\s*750\s*\/\s*(windowWidth|width)|\/\s*750\b/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file))
  assert.deepEqual(offenders, [])
})

// 首页与四个 tab 页在大屏下放宽到同一栏（2026-09-24 用户：iPad 上只有首页适配了）。
// 同步设计稿时整文件替换 wxss 会把这段丢掉，页面就退回居中 450px 窄栏。
test('home and tab pages widen to LARGE_SCREEN_WIDE_COLUMN on large screens', () => {
  const { LARGE_SCREEN_WIDE_COLUMN } = require('../utils/screen')
  const tabPages = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).tabBar.list.map((item) => item.pagePath)
  assert.equal(tabPages.length, 5)
  const narrow = tabPages.filter((page) => {
    const css = fs.readFileSync(path.join(root, `${page}.wxss`), 'utf8')
    return !new RegExp(`@media \\(min-width: 450px\\) \\{\\s*page \\{ --lg-col: ${LARGE_SCREEN_WIDE_COLUMN}px; \\}`).test(css)
  })
  assert.deepEqual(narrow, [])
  // 宇宙页的球体居中与知识卡避让在 JS 里按栏宽算，要用同一个常量。
  const universe = fs.readFileSync(path.join(root, 'pages/knowledge-universe/index.js'), 'utf8')
  assert.doesNotMatch(universe, /columnWidth\(this\._windowWidth\)/)
})

test('iPad can rotate: app.json enables resizable', () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).resizable, true)
})

test('screen helper keeps phones on window-based rpx and pins large windows to the fixed scale', () => {
  const screen = require('../utils/screen')
  assert.equal(screen.rpxToPx(100, 390), 52)
  assert.equal(screen.columnWidth(390), 390)
  assert.equal(screen.isLargeScreen(449), false)
  assert.equal(screen.rpxToPx(100, 1180), 60)
  assert.equal(screen.columnWidth(1180), 450)
  assert.equal(screen.columnWidth(820, 1040), 820)
  assert.equal(screen.LARGE_SCREEN_COLUMN, 750 * screen.LARGE_SCREEN_RPX)
})
