const { restoreAuthenticatedUser } = require('../../services/identity')
const { postAuthenticationUrl } = require('../../utils/referral-context')
const { attachUiAssets } = require('../../services/ui-assets')

const SPLASH_MIN_MS = 1500
const SESSION_WAIT_MS = 3000

Page({
  landing: false,
  disposed: false,
  sessionPromise: null,

  onLoad() {
    attachUiAssets(this)
    this.sessionPromise = Promise.race([
      restoreAuthenticatedUser().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(undefined), SESSION_WAIT_MS))
    ])
  },

  onUnload() {
    this.disposed = true
  },

  onReady() {
    const minimum = new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS))
    Promise.all([minimum, this.sessionPromise]).then(([, user]) => this.land(user || null))
  },

  land(user) {
    if (this.landing || this.disposed) return
    this.landing = true
    if (user && user.phoneVerified === true) {
      getApp().globalData.user = user
      wx.reLaunch({ url: postAuthenticationUrl(user), fail: () => wx.reLaunch({ url: '/pages/login/login' }) })
      return
    }
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
