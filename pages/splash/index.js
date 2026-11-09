const { restoreAuthenticatedUser } = require('../../services/identity')
const { postAuthenticationUrl } = require('../../utils/referral-context')
const { attachUiAssets } = require('../../services/ui-assets')

const SPLASH_MIN_MS = 1500
// 确认登录状态要依次请求三次后端（手机号登录状态、初始化用户、读学习档案），冷启动常超过 3 秒。
// 开屏页等到确认完毕再进入小程序（2026-09-26 用户要求）；只有后端长时间无响应才直接放行，免得卡死在开屏。
const SESSION_WAIT_MS = 15000
const HOME_URL = '/pages/home/index'

Page({
  landing: false,
  disposed: false,
  sessionPromise: null,

  onLoad() {
    attachUiAssets(this)
    this.sessionPromise = Promise.race([
      restoreAuthenticatedUser().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), SESSION_WAIT_MS))
    ])
  },

  onUnload() {
    this.disposed = true
  },

  onReady() {
    const minimum = new Promise((resolve) => setTimeout(resolve, SPLASH_MIN_MS))
    Promise.all([minimum, this.sessionPromise]).then(([, user]) => this.land(user))
  },

  land(user) {
    if (this.landing || this.disposed) return
    this.landing = true
    if (user && user.phoneVerified === true) {
      getApp().globalData.user = user
      wx.reLaunch({ url: postAuthenticationUrl(user), fail: () => wx.reLaunch({ url: HOME_URL }) })
      return
    }
    // 没登录也直接进首页浏览，用到要登录的功能时再登录（2026-09-27 用户规则，按微信小程序平台规则不能强制登录）。
    // 凭证还在却没确认成功（网络异常或超时；凭证失效时已被清掉）的也进首页：各页读数据时会再确认，确认失效才按游客显示。
    wx.reLaunch({ url: HOME_URL })
  }
})
