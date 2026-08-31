const { restoreAuthenticatedUser, signInWithPhoneCode } = require('../../services/identity')

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
      wx.reLaunch({ url: '/pages/index/index' })
      return
    }
    this.setData({ checkingSession: false })
  },

  async handlePhoneAuthorization(event) {
    if (this.data.authorizing) return

    const detail = event.detail || {}
    if (detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '需要授权手机号后才能继续', icon: 'none' })
      return
    }

    this.setData({ authorizing: true })
    try {
      const user = await signInWithPhoneCode(detail.code)
      getApp().globalData.user = user
      wx.reLaunch({ url: '/pages/index/index' })
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none', duration: 3000 })
    } finally {
      this.setData({ authorizing: false })
    }
  }
})
