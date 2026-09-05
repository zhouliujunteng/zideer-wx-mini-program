const tabs = [
  '/pages/home/index',
  '/pages/learning/index',
  '/pages/knowledge-map/index',
  '/pages/me/index'
]

function getNavigationMetrics() {
  let statusBarHeight = 20
  let navigationBarHeight = 44

  try {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menu = wx.getMenuButtonBoundingClientRect()
    statusBarHeight = windowInfo.statusBarHeight || statusBarHeight
    const menuGap = Math.max(menu.top - statusBarHeight, 4)
    navigationBarHeight = Math.max(menu.height + menuGap * 2, 44)
  } catch (error) {
    // The fallback matches WeChat's compact navigation bar.
  }

  return {
    statusBarHeight,
    navigationBarHeight,
    contentTop: statusBarHeight + navigationBarHeight
  }
}

function syncTab(page, selected) {
  if (!page || typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar) tabBar.setData({ selected })
}

function switchTab(index) {
  const url = tabs[index]
  if (url) wx.switchTab({ url })
}

module.exports = {
  getNavigationMetrics,
  syncTab,
  switchTab
}
