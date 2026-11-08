const { rpxToPx, getMenuButtonRect } = require('../../utils/screen')
const { isTimelineSinglePage } = require('../../utils/timeline-single-page')

// 「设为星标 / 添加到桌面」引导（2026-09-29 用户要求）：进首页时弹一个说明卡，箭头指着右上角胶囊的「···」。
// - 每次打开小程序最多弹一次（模块级标记，热启动、reLaunch 回首页都不再弹）。
// - 点「不再提醒」后这台手机以后都不弹（本地记住；删掉小程序、清缓存才会重新出现）。
// - 从桌面图标打开的（场景值 1023）、已经设为星标的（wx.checkIsAddedToMyMiniProgram）、朋友圈单页里都不弹。
// 首页是自定义底栏，弹出时把底栏收起，关掉再放出来，遮罩才盖得住整屏。
const DISMISS_KEY = 'zhilu_favorite_guide_dismissed'
const DESKTOP_ICON_SCENE = 1023
const SHOW_DELAY_MS = 800
const CLOSE_MS = 200
// 卡片上沿小三角的半宽（rpx），箭头尖对准「···」
const ARROW_HALF_RPX = 14
// 卡片宽度与 wxss 一致：620rpx，窄屏时左右各留 24rpx
const CARD_WIDTH_RPX = 620
const CARD_GUTTER_RPX = 24
// 箭头离卡片右边至少这么远（px），不贴着圆角
const ARROW_EDGE_PX = 24

let attemptedThisLaunch = false

function dismissed() {
  try {
    return Boolean(wx.getStorageSync(DISMISS_KEY))
  } catch (error) {
    return false
  }
}

function openedFromDesktopIcon() {
  try {
    const launch = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : null
    return Boolean(launch && Number(launch.scene) === DESKTOP_ICON_SCENE)
  } catch (error) {
    return false
  }
}

function alreadyStarred() {
  return new Promise((resolve) => {
    if (!wx.checkIsAddedToMyMiniProgram) {
      resolve(false)
      return
    }
    wx.checkIsAddedToMyMiniProgram({
      success: (result) => resolve(Boolean(result && result.added)),
      fail: () => resolve(false)
    })
  })
}

function currentTabBar() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const page = pages[pages.length - 1]
  return page && typeof page.getTabBar === 'function' ? page.getTabBar() : null
}

Component({
  data: {
    visible: false,
    closing: false,
    ringLeft: 0,
    ringTop: 0,
    ringSize: 0,
    cardTop: 0,
    cardRight: 0,
    arrowRight: 0
  },

  lifetimes: {
    attached() {
      if (attemptedThisLaunch || dismissed() || openedFromDesktopIcon() || isTimelineSinglePage()) return
      attemptedThisLaunch = true
      this._showTimer = setTimeout(() => {
        this._showTimer = null
        this.maybeShow()
      }, SHOW_DELAY_MS)
    },

    detached() {
      if (this._showTimer) clearTimeout(this._showTimer)
      if (this._closeTimer) clearTimeout(this._closeTimer)
      this.setTabBarHidden(false)
    }
  },

  methods: {
    async maybeShow() {
      if (await alreadyStarred()) return
      this.setData({ visible: true, closing: false, ...this.layout() })
      this.setTabBarHidden(true)
    },

    // 胶囊位置只在弹出时读一次（转屏时胶囊坐标可能还是旧值，见 AGENTS.md 大屏适配一节）
    layout() {
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const windowWidth = windowInfo.windowWidth || 375
      const menu = getMenuButtonRect(windowInfo)
      const menuRight = menu.left + menu.width
      // 胶囊左半边是「···」
      const dotsX = menu.left + menu.width / 4
      const arrowHalf = rpxToPx(ARROW_HALF_RPX, windowWidth)
      const cardWidth = Math.min(rpxToPx(CARD_WIDTH_RPX, windowWidth), windowWidth - 2 * rpxToPx(CARD_GUTTER_RPX, windowWidth))
      // 手机上卡片水平居中；大屏上胶囊离得远，卡片往右靠，保证箭头落在卡片上
      const centered = (windowWidth - cardWidth) / 2
      const farthest = windowWidth - dotsX - arrowHalf - ARROW_EDGE_PX
      const cardRight = Math.max(windowWidth - menuRight, Math.min(centered, farthest))
      const ringSize = Math.round(menu.height + 16)
      return {
        ringLeft: Math.round(dotsX - ringSize / 2),
        ringTop: Math.round(menu.top + menu.height / 2 - ringSize / 2),
        ringSize,
        cardTop: Math.round(menu.top + menu.height + 14),
        cardRight: Math.round(cardRight),
        arrowRight: Math.round(windowWidth - cardRight - dotsX - arrowHalf)
      }
    },

    setTabBarHidden(hidden) {
      const tabBar = hidden ? currentTabBar() : this._tabBar
      if (hidden) this._tabBar = tabBar
      if (tabBar && tabBar.data && tabBar.data.hidden !== hidden) tabBar.setData({ hidden })
      if (!hidden) this._tabBar = null
    },

    close() {
      if (!this.data.visible || this.data.closing) return
      this.setData({ closing: true })
      this.setTabBarHidden(false)
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null
        this.setData({ visible: false, closing: false })
      }, CLOSE_MS)
    },

    handleLater() {
      this.close()
    },

    handleNeverAgain() {
      try {
        wx.setStorageSync(DISMISS_KEY, true)
      } catch (error) {
        // 存不下时这次照样关掉，下次启动再提醒
      }
      this.close()
    },

    noop() {}
  }
})
