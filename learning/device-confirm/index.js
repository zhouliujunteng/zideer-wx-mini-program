const { approveCourseDevice } = require('../../services/identity')

Page({
  data: { code: '', busy: false, approved: false, error: '' },
  onLoad(options = {}) {
    this._unloaded = false
    this.setData({ code: String(options.code || '').replace(/\s/g, '').toUpperCase() })
  },
  onUnload() { this._unloaded = true },
  changeCode(event) {
    if (this._unloaded || this.data.busy) return
    const code = String(event.detail.value || '').replace(/\s/g, '').toUpperCase()
    this.setData({ code, error: '' })
    return code
  },
  async approve() {
    if (this._unloaded || this.data.busy || this.data.approved) return
    const code = this.data.code
    if (!/^[A-F0-9]{12}$/.test(code)) { this.setData({ error: '请输入完整的12位确认码。' }); return }
    this.setData({ busy: true, error: '' })
    try {
      const result = await new Promise((resolve) => wx.showModal({
        title: '授权学习设备',
        content: `确认码 ${code}。仅确认你正在使用的设备，不要确认他人发来的设备请求。`,
        confirmText: '本人设备', success: resolve, fail: () => resolve({ confirm: false })
      }))
      if (this._unloaded || !result.confirm) return
      await approveCourseDevice(code)
      if (!this._unloaded) this.setData({ approved: true })
    } catch (error) {
      if (!this._unloaded) this.setData({ error: error.message || '确认失败，请重试。' })
    } finally {
      if (!this._unloaded) this.setData({ busy: false })
    }
  },
  goBack() { wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/me/index' }) }) }
})
