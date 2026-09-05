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
    this.setData({ loading: !forceRefresh, refreshing: forceRefresh, failed: false, expired: false })
    try {
      const data = await createCurrentStudentBindingCode()
      const seconds = remainingSeconds(data.expiresAt)
      this.expiresAt = data.expiresAt
      this.setData({
        code: data.code,
        countdown: countdownText(seconds),
        expired: seconds === 0
      })
      if (seconds > 0) this.startTimer()
    } catch (error) {
      this.setData({ failed: true })
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
