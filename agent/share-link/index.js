const { attachUiAssets } = require('../../services/ui-assets')
const { inviteFriendCover } = require('../../services/promotion-view')
const { prepareShareCover, shareWithCover } = require('../../services/share-cover')
const { isTimelineSinglePage } = require('../../utils/timeline-single-page')

// 小程序链接（2026-09-29）：图文教推广的人用右上角「···」→「复制链接」拿到 #小程序://知鹿学习/… 蓝色链接，
// 入口在两个海报分享层。
// 2026-11-10 起没有邀请码 / 推荐人（改由爱心妈妈输入家长 ID 绑定家庭）：链接不再带邀请码，好友点开直接进小程序。
// 同一个地址被好友点开时，本页是小程序里唯一的一页（推广的人总是从别的页面点进来）：好友 → 送回首页；
// 朋友圈单页里不能跳页，只放一张说明。

Page({
  data: {
    loadState: 'ready',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    // 「第 1 步点这里」指向真实胶囊的「···」，页面滚动后收起，免得挡住内容
    pointerLeft: 0,
    pointerTop: 0,
    scrolled: false
  },

  onLoad() {
    attachUiAssets(this)
    if (getCurrentPages().length <= 1) {
      if (isTimelineSinglePage()) return this.setData({ loadState: 'timeline' })
      wx.reLaunch({ url: '/pages/home/index' })
      return
    }
    this.layoutTopbar()
  },

  layoutTopbar() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      // 胶囊左半边是「···」，箭头尖对准它的中心
      pointerLeft: Math.round(menuButton.left + menuButton.width / 4),
      pointerTop: Math.round(menuButton.top + menuButton.height + 6)
    })
  },

  handleScroll(e) {
    const scrolled = Number(e && e.detail && e.detail.scrollTop) > 24
    if (scrolled !== this.data.scrolled) this.setData({ scrolled })
  },

  // 画布渲染出来之后再画「发送给朋友」卡片的封面
  onReady() {
    if (this.data.loadState === 'ready') prepareShareCover(this, inviteFriendCover())
  },

  // 右上角菜单里的「复制链接」跟「转发给朋友」共存：页面不定义转发，菜单里就没有复制链接。
  onShareAppMessage() {
    const share = { title: '好友邀请你来知鹿学习', path: '/pages/home/index' }
    return shareWithCover(this, share, inviteFriendCover())
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/agent/promotion/index' })
  }
})
