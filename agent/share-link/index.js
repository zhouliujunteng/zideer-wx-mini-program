const { loadCurrentPromotionCode } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { shareLinkPageUrl, inviteFriendCover } = require('../../services/promotion-view')
const { prepareShareCover, shareWithCover } = require('../../services/share-cover')
const { captureReferralContext, validPromotionCode } = require('../../utils/referral-context')
const { isTimelineSinglePage } = require('../../utils/timeline-single-page')

// 小程序链接（2026-09-29）：图文教推广的人用右上角「···」→「复制链接」拿到 #小程序://知鹿学习/… 蓝色链接，
// 入口在「我的邀请码」和两个海报分享层。
// 复制出来的链接打开的是「当前页 + 当前页的查询串」；改写查询串的 wx.onCopyUrl 官方只保证安卓，
// 所以本页地址自己就带 pc=<我的邀请码>，苹果、安卓复制出来的都带邀请人。
// 同一个地址被好友点开时，本页是小程序里唯一的一页（推广的人总是从别的页面点进来），据此区分：
// 好友 → 记下推荐人线索送回首页，由首页在后台兑现；朋友圈单页里不能跳页，只放一张邀请说明。

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    // 「第 1 步点这里」指向真实胶囊的「···」，页面滚动后收起，免得挡住内容
    pointerLeft: 0,
    pointerTop: 0,
    scrolled: false,
    code: ''
  },

  onLoad(options = {}) {
    attachUiAssets(this)
    if (getCurrentPages().length <= 1) {
      this.openAsInvitee(options)
      return
    }
    this.layoutTopbar()
    const code = validPromotionCode(options.pc)
    if (code) {
      this.setData({ loadState: 'ready', code })
      return
    }
    return this.loadCode()
  },

  openAsInvitee(options) {
    captureReferralContext(options)
    if (isTimelineSinglePage()) {
      this.setData({ loadState: 'timeline' })
      return
    }
    wx.reLaunch({ url: '/pages/home/index' })
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

  // 没带邀请码进来（入口手上没有码）：取到后把邀请码写进本页地址再显示，复制链接才带得上
  async loadCode() {
    this.setData({ loadState: 'loading', loadError: '' })
    try {
      const mine = await loadCurrentPromotionCode()
      const code = validPromotionCode(mine && mine.promotionCode)
      if (!code) throw new Error('邀请码暂不可用，请稍后重试。')
      wx.redirectTo({ url: shareLinkPageUrl(code) })
    } catch (error) {
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 画布渲染出来之后再画「发送给朋友」卡片的封面（封面写着我的邀请码）
  onReady() {
    if (this.data.loadState === 'ready') prepareShareCover(this, inviteFriendCover(this.data.code))
  },

  onShow() {
    this.stopCopyUrl()
    if (this.data.loadState !== 'ready' || !wx.onCopyUrl) return
    // 安卓上再兜一层：即使地址被改过，复制出来的也只带邀请码
    this._copyUrlHandler = () => ({ query: `pc=${this.data.code}` })
    wx.onCopyUrl(this._copyUrlHandler)
  },

  onHide() {
    this.stopCopyUrl()
  },

  onUnload() {
    this.stopCopyUrl()
  },

  stopCopyUrl() {
    if (this._copyUrlHandler && wx.offCopyUrl) wx.offCopyUrl(this._copyUrlHandler)
    this._copyUrlHandler = null
  },

  // 右上角菜单里的「复制链接」跟「转发给朋友」共存：页面不定义转发，菜单里就没有复制链接。
  // 转发卡片走推荐入口页，同样带邀请码；封面是「好友邀请你 · 一起来知鹿学习」（services/promotion-view.js）。
  // 复制出去的蓝色链接只是一行字，微信不给它配封面。
  onShareAppMessage() {
    const code = validPromotionCode(this.data.code)
    const share = {
      title: '好友邀请你来知鹿学习',
      path: code ? `/pages/referral-entry/index?pc=${code}` : '/pages/home/index'
    }
    return code ? shareWithCover(this, share, inviteFriendCover(code)) : share
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/agent/share-tools/index' })
  },

  copyCode() {
    const code = String(this.data.code || '')
    if (!code) return
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }) })
  }
})
