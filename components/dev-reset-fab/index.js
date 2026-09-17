const { getStoredToken, resetDevelopmentAccount } = require('../../services/identity')

function isDevelopmentBuild() {
  try {
    const accountInfo = wx.getAccountInfoSync && wx.getAccountInfoSync()
    return Boolean(accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion === 'develop')
  } catch (error) {
    return false
  }
}

function resetErrorMessage(error) {
  const message = String(error && error.message || error || '')
  if (/DEV_RESET_FORBIDDEN/.test(message)) return '当前账号不在开发重开白名单中。'
  if (/DEV_RESET_LOGIN_REQUIRED|AUTH_REQUIRED|PHONE_REQUIRED/.test(message)) return '登录状态已失效，请重新登录后重试。'
  return message || '重置失败，请稍后重试。'
}

Component({
  data: { visible: false, resetting: false },
  lifetimes: {
    attached() { this.refreshVisibility() }
  },
  pageLifetimes: {
    show() { this.refreshVisibility() }
  },
  methods: {
    refreshVisibility() {
      this.setData({ visible: isDevelopmentBuild() && Boolean(getStoredToken()) })
    },
    handleTap() {
      if (this.data.resetting) return
      wx.showModal({
        title: '重置开发测试账号',
        content: '将解除当前业务身份并清空本地会话，重新登录后从新用户流程开始。订单和历史审计数据会保留。确认继续吗？',
        confirmText: '确认重置',
        confirmColor: '#A4472F',
        success: async (result) => {
          if (!result.confirm) return
          this.setData({ resetting: true })
          wx.showLoading({ title: '正在重置', mask: true })
          try {
            await resetDevelopmentAccount()
            wx.hideLoading()
            wx.showToast({ title: '重置完成', icon: 'success', duration: 900 })
            setTimeout(() => wx.reLaunch({ url: '/pages/login/login' }), 900)
          } catch (error) {
            wx.hideLoading()
            this.setData({ resetting: false })
            wx.showToast({ title: resetErrorMessage(error), icon: 'none' })
          }
        }
      })
    }
  }
})
