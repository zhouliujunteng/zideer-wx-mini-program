const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx } = require('../../utils/screen')

// 关于知鹿（「我的 → 知鹿服务」进入）：小程序图标、小程序备案号、《知鹿用户协议》与《隐私保护指引》。
// 小程序备案号与官网的网站备案号（-5）不是同一个，别混用。
const FILING_NUMBER = '粤ICP备2026107077号-6X'

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    filingNumber: FILING_NUMBER
  },
  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  copyFilingNumber() {
    wx.setClipboardData({ data: FILING_NUMBER, success: () => wx.showToast({ title: '备案号已复制', icon: 'none' }) })
  },
  openUserAgreement() { wx.navigateTo({ url: '/account/agreement/index' }) },
  // 隐私保护指引用小程序后台登记的官方版本，与登录页、微信授权弹窗里的是同一份。
  openPrivacyContract() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: '请升级微信后查看隐私保护指引', icon: 'none' })
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '隐私保护指引暂时无法打开', icon: 'none' }) })
  }
})
