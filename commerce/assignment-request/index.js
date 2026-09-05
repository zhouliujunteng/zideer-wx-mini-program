const {
  loadPromoterAssignmentRequest,
  submitPromoterAssignmentRequest,
  cancelPromoterAssignmentRequest
} = require('../../services/identity')

const statusLabels = {
  pending: '等待处理',
  cancelled: '已撤回'
}

Page({
  data: {
    loading: true,
    submitting: false,
    request: null,
    attribution: null,
    form: { contact: '', region: '', availableTime: '' }
  },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true })
    try {
      const data = await loadPromoterAssignmentRequest()
      const request = data.request ? { ...data.request, statusLabel: statusLabels[data.request.status] || data.request.status || '处理中' } : null
      this.setData({ request, attribution: data.attribution || null })
    } catch (error) {
      wx.showToast({ title: error.message || '申请状态加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  updateContact(event) { this.setData({ 'form.contact': event.detail.value }) },
  updateRegion(event) { this.setData({ 'form.region': event.detail.value }) },
  updateAvailableTime(event) { this.setData({ 'form.availableTime': event.detail.value }) },
  async submit() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      await submitPromoterAssignmentRequest(this.data.form)
      wx.showToast({ title: '申请已提交', icon: 'success' })
      await this.loadPage()
    } catch (error) {
      wx.showToast({ title: error.message || '申请提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
  cancel() {
    const request = this.data.request
    if (!request || request.status !== 'pending' || this.data.submitting) return
    wx.showModal({
      title: '撤回申请',
      content: '撤回后可在需要时重新提交。',
      success: async (result) => {
        if (!result.confirm) return
        this.setData({ submitting: true })
        try {
          await cancelPromoterAssignmentRequest(request.idempotency_key)
          wx.showToast({ title: '申请已撤回', icon: 'success' })
          await this.loadPage()
        } catch (error) {
          wx.showToast({ title: error.message || '撤回失败', icon: 'none' })
        } finally {
          this.setData({ submitting: false })
        }
      }
    })
  }
})
