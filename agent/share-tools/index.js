const { loadCurrentPromotionCode } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { shareLinkPageUrl } = require('../../services/promotion-view')

// 我的邀请码（原名「推广工具」，2026-09-25 按用户要求改名）：只放邀请码与小程序码
// （2026-09-22 按用户要求，原先的邀请链接生成与已生成邀请记录一并移除）。
// 邀请码人人都有，所以这一页不做推广伙伴资格校验，不读成长中心。
// 2026-09-29 加「小程序链接」教程卡片：复制链接要在小程序链接页里操作（那一页的地址带邀请码）。
Page({
  data: {
    loadState: 'loading',
    loadError: '',
    title: '我的邀请码',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    code: '',
    qrUrl: ''
  },

  onLoad() {
    attachUiAssets(this)
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
      contentTop: statusBarHeight + navigationBarHeight + 10
    })
  },

  onShow() {
    return this.loadPage()
  },

  onPullDownRefresh() {
    return this.loadPage().finally(() => wx.stopPullDownRefresh())
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const mine = await loadCurrentPromotionCode()
      if (requestId !== this._loadRequestId) return
      this.setData({
        loadState: 'ready',
        code: (mine && mine.promotionCode) || '',
        qrUrl: (mine && mine.qrUrl) || ''
      })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      // 已经显示过邀请码时只提示，不把页面退回失败态
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '邀请码刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/promotion/index' })
  },

  copyCode() {
    const code = String(this.data.code || '')
    if (!code) return
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }) })
  },

  openShareLink() {
    wx.navigateTo({ url: shareLinkPageUrl(this.data.code) })
  },

  previewQr() {
    const url = String(this.data.qrUrl || '')
    if (url) wx.previewImage({ urls: [url], current: url })
  }
})
