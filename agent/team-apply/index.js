const { loadAgentApplication, proposeLoveMom } = require('../../services/identity')
const { rpxToPx } = require('../../utils/screen')

// 团长替别人申请爱心妈妈（2026-11-10 用户规则）：输入对方用户 ID 和联系电话提交；平台联系对方签合同，
// 审核通过后对方开通爱心妈妈，并自动进这个团长的团。下面列团长提交过的申请与审核结果。
const STATUS_TEXT = { submitted: '审核中', approved: '已通过', rejected: '未通过' }

function dateText(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}
function proposalsView(list) {
  return (list || []).map((item) => ({
    id: item.id,
    name: item.person && item.person.name || '未命名',
    publicId: item.person && item.person.publicId || '',
    phone: item.contactPhone || '',
    status: item.status,
    statusText: STATUS_TEXT[item.status] || '',
    dateText: dateText(item.submittedAt),
    reviewNote: item.reviewNote || ''
  }))
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    canPropose: false,
    proposals: [],
    publicId: '',
    phone: '',
    note: '',
    formError: '',
    submitting: false
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() { this.load() },
  async load() {
    try {
      const result = await loadAgentApplication()
      this.setData({ loaded: true, loadFailed: false, canPropose: !!result.canPropose, proposals: proposalsView(result.proposals) })
    } catch (error) {
      if (this.data.loaded) return wx.showToast({ title: error.message || '申请记录暂时无法读取', icon: 'none' })
      this.setData({ loadFailed: true, errorMessage: error.message || '申请记录暂时无法读取，请稍后重试。' })
    }
  },
  retry() { this.setData({ loadFailed: false }); this.load() },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  handleIdInput(event) { this.setData({ publicId: String(event.detail.value || '').replace(/\D/g, ''), formError: '' }) },
  handlePhoneInput(event) { this.setData({ phone: String(event.detail.value || '').replace(/\D/g, ''), formError: '' }) },
  handleNoteInput(event) { this.setData({ note: String(event.detail.value || '').slice(0, 200) }) },
  async handleSubmit() {
    if (this.data.submitting) return
    const { publicId, phone, note } = this.data
    if (!/^\d{4,12}$/.test(publicId)) return this.setData({ formError: '请输入对方的用户 ID（「我的」页头像下方的数字）' })
    if (!/^1\d{10}$/.test(phone)) return this.setData({ formError: '请输入对方的 11 位手机号，平台会联系她签合同' })
    this.setData({ submitting: true, formError: '' })
    try {
      const result = await proposeLoveMom({ publicId, contactPhone: phone, note })
      this.setData({ proposals: proposalsView(result.proposals), publicId: '', phone: '', note: '' })
      wx.showToast({ title: '已提交', icon: 'success' })
    } catch (error) {
      this.setData({ formError: error.message || '申请没有提交成功，请稍后重试。' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
