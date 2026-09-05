const { bindCurrentGuardianToStudent } = require('../../services/identity')

Page({
  data: { code: '', submitting: false },

  onCodeInput(event) {
    const code = String(event.detail.value || '').replace(/\D/g, '').slice(0, 8)
    this.setData({ code })
  },

  async submit() {
    if (this.data.submitting) return
    if (this.data.code.length !== 8) {
      wx.showToast({ title: '请输入 8 位数字绑定码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await bindCurrentGuardianToStudent(this.data.code)
      wx.showToast({ title: '学生绑定成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      wx.showToast({ title: error.message || '绑定学生失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
