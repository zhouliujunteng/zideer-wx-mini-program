const { getStoredToken, resetDevelopmentAccount } = require('../../services/identity')
const { readDevResetCode, onDevResetChange } = require('../../utils/dev-reset')

// 2026-09-28 用户规则：只有在「我的 → 兑换码」输入过开启码的手机才显示（不再按开发版显示），
// 打开后本机登录的任何账号都能重置自己；开启码由后端核对，见 utils/dev-reset.js。
function isUnlocked() {
  return Boolean(getStoredToken()) && Boolean(readDevResetCode())
}

function resetErrorMessage(error) {
  const message = String(error && error.message || error || '')
  if (/DEV_RESET_FORBIDDEN|DEV_RESET_LOCKED/.test(message)) return '开启码已失效，请到「我的 → 兑换码」重新输入。'
  if (/DEV_RESET_LOGIN_REQUIRED|AUTH_REQUIRED|PHONE_REQUIRED/.test(message)) return '登录状态已失效，请重新登录后重试。'
  if (/DEV_RESET_/.test(message)) return '重置失败，请稍后重试。'
  return message || '重置失败，请稍后重试。'
}

Component({
  data: { visible: false, resetting: false },
  lifetimes: {
    attached() {
      this._offDevReset = onDevResetChange(() => this.refreshVisibility())
      this.refreshVisibility()
    },
    detached() {
      if (this._offDevReset) this._offDevReset()
      this._offDevReset = null
    }
  },
  pageLifetimes: {
    show() { this.refreshVisibility() }
  },
  methods: {
    refreshVisibility() {
      const visible = isUnlocked()
      if (visible !== this.data.visible) this.setData({ visible })
    },
    handleTap() {
      if (this.data.resetting) return
      wx.showModal({
        title: '重置开发测试账号',
        content: '将解除当前账号的业务身份并清空本地会话，重新登录后从新用户流程开始。订单和历史审计数据会保留。确认继续吗？',
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
            this.refreshVisibility()
            wx.showToast({ title: resetErrorMessage(error), icon: 'none' })
          }
        }
      })
    }
  }
})
