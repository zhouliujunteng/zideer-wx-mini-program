const { restoreAuthenticatedUser, signInWithWechat } = require('../../services/identity')
const { postAuthenticationUrl } = require('../../utils/referral-context')

Page({
  data: {
    checkingSession: true,
    authorizing: false
  },

  async onShow() {
    await this.restoreSession()
  },

  async restoreSession() {
    this.setData({ checkingSession: true })
    const user = await restoreAuthenticatedUser()
    if (user) {
      getApp().globalData.user = user
      this.navigateAfterAuthentication(user)
      return
    }
    this.setData({ checkingSession: false })
  },

  async handleWechatLogin() {
    if (this.data.authorizing) return

    this.setData({ authorizing: true })
    try {
      const user = await signInWithWechat()
      getApp().globalData.user = user
      this.navigateAfterAuthentication(user)
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ authorizing: false })
    }
  },

  navigateAfterAuthentication(user) {
    wx.reLaunch({ url: postAuthenticationUrl(user) })
  }
})
