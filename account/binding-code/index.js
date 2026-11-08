const { createCurrentStudentBindingCode } = require('../../services/identity')

function remainingSeconds(expiresAt) {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(remaining / 1000))
}

function countdownText(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

Page({
  data: {
    loading: true,
    // 第一次拿到绑定码前显示骨架；之后 onShow 换新码时保留旧码，不再回到骨架
    loaded: false,
    refreshing: false,
    failed: false,
    code: '',
    countdown: '01:00',
    expired: false
  },

  onShow() {
    this.loadCode()
  },

  onHide() { this.stopTimer() },
  onUnload() { this.stopTimer() },

  async onPullDownRefresh() {
    await this.loadCode(true)
    wx.stopPullDownRefresh()
  },

  async loadCode(forceRefresh = false) {
    this.stopTimer()
    this.setData({ loading: !this.data.loaded, refreshing: forceRefresh, failed: false })
    try {
      const data = await createCurrentStudentBindingCode()
      const seconds = remainingSeconds(data.expiresAt)
      this.expiresAt = data.expiresAt
      this.setData({
        loaded: true,
        code: data.code,
        countdown: countdownText(seconds),
        expired: seconds === 0
      })
      if (seconds > 0) this.startTimer()
    } catch (error) {
      // 已有绑定码时刷新失败只提示，旧码按原倒计时继续
      if (this.data.loaded) { if (!this.data.expired && this.expiresAt) this.startTimer() }
      else this.setData({ failed: true })
      wx.showToast({ title: error.message || '绑定码生成失败', icon: 'none' })
    } finally {
      this.setData({ loading: false, refreshing: false })
    }
  },

  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => {
      const seconds = remainingSeconds(this.expiresAt)
      this.setData({ countdown: countdownText(seconds), expired: seconds === 0 })
      if (seconds === 0) this.stopTimer()
    }, 1000)
  },

  stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  },

  refreshCode() {
    if (this.data.refreshing) return
    this.loadCode(true)
  }
})
