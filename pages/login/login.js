const { getStoredToken, restoreAuthenticatedUser, signInWithWechat } = require('../../services/identity')
const { postAuthenticationUrl } = require('../../utils/referral-context')
const { attachUiAssets } = require('../../services/ui-assets')
const { USER_AGREEMENT } = require('./user-agreement')

// 登录页（设计稿 ui-ref b5d394a「手机号一键登录」）：视觉照设计稿，登录仍走微信手机号授权。
// 必须先勾选协议才能授权手机号：没勾选时登录按钮只弹确认框，确认框里的「同意并继续」本身就是授权按钮。
Page({
  data: {
    ui: {},
    checkingSession: false,
    authorizing: false,
    errorMessage: '',
    hasAgreed: false,
    agreementPromptVisible: false,
    userAgreement: null,
    canGoBack: false,
    backButtonTop: 26,
    backButtonSize: 32
  },

  onLoad() {
    attachUiAssets(this)
    // 未登录也能浏览（2026-09-27 用户规则）：登录页多由浏览中点了要登录的功能打开（navigateTo），有返回键，不想登录可以回去接着看；
    // 登录失效时被带过来（reLaunch）没有上一页，不显示返回键，改在登录按钮下给「先随便看看」进首页。
    // 胶囊位置只在这里读一次（转屏时按钮到顶边的距离不变）。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null
    this.setData({
      canGoBack: getCurrentPages().length > 1,
      backButtonTop: (menuButton && menuButton.top) || statusBarHeight + 6,
      backButtonSize: (menuButton && menuButton.height) || 32
    })
  },

  async onShow() {
    if (this.data.authorizing) return
    await this.restoreSession()
  },

  onUnload() { this.disposed = true },

  // 第一次确认登录状态、且本地有登录凭证要请求后端时，按钮显示「正在确认登录状态」；
  // 没有凭证不用请求，直接显示登录按钮。之后回到本页（如看完隐私保护指引）静默复查，不闪按钮。
  async restoreSession() {
    const firstCheck = !this.sessionChecked
    if (firstCheck && getStoredToken()) this.setData({ checkingSession: true })
    let user
    try {
      user = await restoreAuthenticatedUser()
    } catch (error) {
      if (this.disposed) return
      this.sessionChecked = true
      this.setData({
        checkingSession: false,
        errorMessage: /timeout|超时/i.test(String(error && error.message || ''))
          ? '登录服务响应超时，请保持网络畅通后重试。'
          : (error && error.message) || '登录状态暂时无法确认，请稍后重试。',
      })
      return
    }
    if (this.disposed) return
    this.sessionChecked = true
    if (user) {
      getApp().globalData.user = user
      this.navigateAfterAuthentication(user)
      return
    }
    this.setData({ checkingSession: false })
  },

  toggleAgreement() {
    this.setData({ hasAgreed: !this.data.hasAgreed })
  },

  requestAgreement() {
    if (this.data.checkingSession || this.data.authorizing) return
    this.setData({ agreementPromptVisible: true })
  },

  closeAgreementPrompt() {
    this.setData({ agreementPromptVisible: false })
  },

  // 确认框里点「同意并继续」：视为已同意（授权被拒也保持勾选），接着按正常授权结果处理。
  handleAgreedPhoneLogin(event) {
    this.setData({ hasAgreed: true, agreementPromptVisible: false })
    return this.handlePhoneLogin(event)
  },

  async handlePhoneLogin(event) {
    if (this.data.authorizing || this.data.checkingSession || !this.data.hasAgreed) return
    const detail = event && event.detail || {}
    if (!detail.code) {
      const message = Number(detail.errno) === 1400001
        ? '手机号授权服务暂不可用，请稍后重试。'
        : /deny|cancel|reject/i.test(String(detail.errMsg || ''))
          ? '你尚未授权手机号，授权后才能完成登录。'
          : '未获取到手机号授权，请重新点击按钮。'
      this.setData({ errorMessage: message })
      return
    }

    this.setData({ authorizing: true, errorMessage: '' })
    try {
      const user = await signInWithWechat(detail.code)
      if (this.disposed) return
      getApp().globalData.user = user
      this.navigateAfterAuthentication(user)
    } catch (error) {
      if (this.disposed) return
      this.setData({ errorMessage: error.message || '登录未完成，请重新授权手机号。' })
    } finally {
      if (!this.disposed) this.setData({ authorizing: false })
    }
  },

  openUserAgreement() {
    this.setData({ userAgreement: USER_AGREEMENT })
  },

  closeUserAgreement() {
    this.setData({ userAgreement: null })
  },

  // 隐私保护指引用小程序后台登记的官方版本，与微信授权弹窗里链接的是同一份。
  openPrivacyContract() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: '请升级微信后查看隐私保护指引', icon: 'none' })
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '隐私保护指引暂时无法打开', icon: 'none' }) })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  browseAsGuest() {
    wx.switchTab({ url: '/pages/home/index' })
  },

  noop() {},

  navigateAfterAuthentication(user) {
    if (!user || user.phoneVerified !== true) { this.setData({ checkingSession: false, errorMessage: '请授权手机号后完成登录。' }); return }
    // 浏览中点进来登录的：登录完回原页面；还没建档的先去建档（换掉登录页），建完也回原页面（见 profile-setup）
    if (getCurrentPages().length > 1) {
      if (user.profileCompleted) wx.navigateBack({ delta: 1 })
      else wx.redirectTo({ url: postAuthenticationUrl(user) })
      return
    }
    wx.reLaunch({ url: postAuthenticationUrl(user) })
  }
})
