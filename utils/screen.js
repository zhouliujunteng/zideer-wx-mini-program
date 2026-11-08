// 平板、电脑大屏适配（2026-09-24）。
//
// rpx 按窗口宽度折算：手机上 1rpx ≈ 0.5px，iPad 竖屏 ≈ 1.1px、横屏 ≈ 1.6px。状态栏、胶囊按钮、tabBar 却是固定大小，
// 所以页面在平板上整体放大两三倍，而且凡是「高度按胶囊算 px、里面图标按 rpx」的地方都会比例失调。
//
// 窗口宽度达到 LARGE_SCREEN_MIN_WIDTH 时进入「大屏模式」：
// - rpx 固定按 1rpx = LARGE_SCREEN_RPX px 折算（相当于一台 450px 宽的手机），不再随窗口放大；
// - 页面收进居中的一栏，默认宽 LARGE_SCREEN_COLUMN（样式变量 --lg-col，页面可以在自己的大屏样式里调宽）；
// - 固定定位的顶栏、底栏、弹层跟着收进这一栏。
// 样式部分由 scripts/build-large-screen-styles.mjs 按这里的常量生成：每个 wxss 末尾 @import 同名的 .large.wxss。
// JS 里凡是「n * windowWidth / 750」这类 rpx 换算，一律改用 rpxToPx，否则大屏下会和样式对不上。
// OPPO Pad Mini 普通运行时也会给出 480px 窗口（屏幕仍为 640px，rpx 仍按屏幕算）。
// 从默认内容栏宽 450px 起使用固定尺寸，覆盖这种窗口，同时保留 320～440px 手机布局。
const LARGE_SCREEN_MIN_WIDTH = 450
const LARGE_SCREEN_RPX = 0.6
const LARGE_SCREEN_COLUMN = 750 * LARGE_SCREEN_RPX
// 首页与四个 tab 页（学习、宇宙、图谱、我的）在大屏下放宽到这一栏，wxss 里对应写 --lg-col: 1040px。
const LARGE_SCREEN_WIDE_COLUMN = 1040

function readWindowWidth() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    return info.windowWidth || 375
  } catch (error) {
    return 375
  }
}

function isLargeScreen(windowWidth = readWindowWidth()) {
  return windowWidth >= LARGE_SCREEN_MIN_WIDTH
}

// 1rpx 对应的 px。
function rpxUnit(windowWidth = readWindowWidth()) {
  return isLargeScreen(windowWidth) ? LARGE_SCREEN_RPX : windowWidth / 750
}

function rpxToPx(value, windowWidth = readWindowWidth()) {
  return value * rpxUnit(windowWidth)
}

// 页面内容栏的宽度：手机上就是窗口宽度，大屏下是居中那一栏（页面调宽过 --lg-col 的，把调宽后的值传进来）。
function columnWidth(windowWidth = readWindowWidth(), column = LARGE_SCREEN_COLUMN) {
  return isLargeScreen(windowWidth) ? Math.min(windowWidth, column) : windowWidth
}

// 部分安卓平板缩放窗口的胶囊 API：left/top 仍在屏幕坐标系，width/height 已是窗口 px。
// 只校正越出窗口、且换算后能完整落入窗口的矩形；正常分屏、iPad、手机原样返回。
function normalizeMenuButtonRect(windowInfo, menu) {
  const width = windowInfo.windowWidth
  const screenWidth = windowInfo.screenWidth
  if (!(width > 0 && screenWidth > width && menu.width > 0 && menu.height > 0)) return menu
  if (!(menu.left >= 0 && menu.top >= 0 && menu.left + menu.width > width)) return menu
  const scale = width / screenWidth
  const left = menu.left * scale
  const top = menu.top * scale
  if (left + menu.width > width) return menu
  return { ...menu, left, top, right: left + menu.width, bottom: top + menu.height }
}

function getMenuButtonRect(windowInfo) {
  const width = windowInfo.windowWidth || 375
  const statusBarHeight = windowInfo.statusBarHeight == null ? 20 : windowInfo.statusBarHeight
  const fallback = { left: width - 92, top: statusBarHeight + 6, width: 87, height: 32 }
  let menu = fallback
  try {
    const actual = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
    if (actual && actual.height > 0 && Number.isFinite(actual.top)) menu = actual
  } catch (error) {}
  return normalizeMenuButtonRect(windowInfo, menu)
}

module.exports = {
  LARGE_SCREEN_MIN_WIDTH,
  LARGE_SCREEN_RPX,
  LARGE_SCREEN_COLUMN,
  LARGE_SCREEN_WIDE_COLUMN,
  isLargeScreen,
  rpxUnit,
  rpxToPx,
  columnWidth,
  normalizeMenuButtonRect,
  getMenuButtonRect
}
