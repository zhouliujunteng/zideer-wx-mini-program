const { restoreAuthenticatedUser, signInWithWechat } = require('../../services/identity')
const { postAuthenticationUrl } = require('../../utils/referral-context')

Page({
  data: {
    checkingSession: true,
    authorizing: false,
    errorMessage: ''
  },

  async onShow() {
    if (this.data.authorizing) return
    await this.restoreSession()
  },

  onUnload() { this.disposed = true },

  async restoreSession() {
    this.setData({ checkingSession: true })
    let user
    try {
      user = await restoreAuthenticatedUser()
    } catch (error) {
      if (this.disposed) return
      this.setData({
        checkingSession: false,
        errorMessage: /timeout|超时/i.test(String(error && error.message || ''))
          ? '登录服务响应超时，请保持网络畅通后重试。'
          : (error && error.message) || '登录状态暂时无法确认，请稍后重试。',
      })
      return
    }
    if (this.disposed) return
    if (user) {
      getApp().globalData.user = user
      this.navigateAfterAuthentication(user)
      return
    }
    this.setData({ checkingSession: false })
  },

  async handlePhoneLogin(event) {
    if (this.data.authorizing || this.data.checkingSession) return
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

  openPrivacyContract() {
    if (!wx.openPrivacyContract) return wx.showToast({ title: '请升级微信后查看隐私保护指引', icon: 'none' })
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '隐私保护指引暂时无法打开', icon: 'none' }) })
  },

  navigateAfterAuthentication(user) {
    if (!user || user.phoneVerified !== true) { this.setData({ checkingSession: false, errorMessage: '请授权手机号后完成登录。' }); return }
    wx.reLaunch({ url: postAuthenticationUrl(user) })
  }
})
