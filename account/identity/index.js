const {
  loadCurrentIdentityVerification,
  submitCurrentGuardianIdentityVerification,
  isAuthenticationRequired
} = require('../../services/identity')

const verificationLabels = {
  verified: '已实名核验',
  pending: '实名认证审核中',
  rejected: '实名认证未通过',
  expired: '实名认证已过期',
  not_started: '尚未完成实名认证'
}

const roleLabels = {
  USER: '学习用户',
  GUARDIAN: '家长',
  PROMOTER: '推广伙伴',
  TEACHER: '教师',
  student: '学生',
  guardian: '家长',
  promoter: '推广伙伴',
  teacher: '教师'
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function buildPageData(data) {
  const verification = data.verification || null
  const status = verification && verification.verification_status || 'not_started'
  const verifiedAt = verification && formatDate(verification.verified_at)
  const expiresAt = verification && formatDate(verification.expires_at)
  return {
    statusLabel: verificationLabels[status] || '实名认证状态待确认',
    statusClass: status,
    detail: verifiedAt ? `核验时间 ${verifiedAt}` : '家长绑定学生及涉及现金结算的功能需要实名认证。',
    expiry: expiresAt ? `有效至 ${expiresAt}` : '',
    method: verification && verification.verification_method || '',
    roles: (data.roles || []).map((role) => ({
      id: role.id || `${role.role_code}-${role.granted_at || ''}`,
      label: roleLabels[role.role_code] || role.role_code || '业务身份',
      grantedAt: formatDate(role.granted_at)
    }))
  }
}

Page({
  data: {
    loading: true,
    failed: false,
    identity: null,
    legalName: '',
    idCardNumber: '',
    submitting: false,
    submissionResult: null,
    submissionError: ''
  },

  onShow() {
    this._visible = true
    this._epoch = (this._epoch || 0) + 1
    this.setData({ submitting: !!this._submission })
    this.loadPage()
  },

  onHide() {
    this.setData({ legalName: '', idCardNumber: '' })
    this._visible = false
    this._epoch = (this._epoch || 0) + 1
  },

  onUnload() { this._visible = false; this._epoch = (this._epoch || 0) + 1 },

  isCurrent(epoch, session) {
    return this._visible && this._epoch === epoch && wx.getStorageSync('zion_runtime_token') === session
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    const epoch = this._epoch
    const session = wx.getStorageSync('zion_runtime_token')
    const requestId = this._loadId = (this._loadId || 0) + 1
    const current = () => this.isCurrent(epoch, session) && requestId === this._loadId
    this.setData({ loading: !this.data.identity, failed: false })
    try {
      const result = await loadCurrentIdentityVerification()
      if (current()) this.setData({ identity: buildPageData(result) })
    } catch (error) {
      if (!current()) return
      if (isAuthenticationRequired(error)) return
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '实名认证状态加载失败', icon: 'none' })
    } finally {
      if (current()) this.setData({ loading: false })
    }
  },

  openLoginIdentities() {
    wx.navigateTo({ url: '/account/login-identities/index' })
  },

  onNameInput(event) {
    this.setData({ legalName: event.detail.value })
  },

  onIdCardInput(event) {
    this.setData({ idCardNumber: String(event.detail.value || '').replace(/\s/g, '').toUpperCase() })
  },

  async submitVerification() {
    if (this._submission || this.data.submitting) return
    const epoch = this._epoch
    const session = wx.getStorageSync('zion_runtime_token')
    this._submission = true
    this.setData({ submitting: true, submissionResult: null, submissionError: '' })
    try {
      const result = await submitCurrentGuardianIdentityVerification({
        name: this.data.legalName,
        idCardNumber: this.data.idCardNumber
      })
      if (!this.isCurrent(epoch, session)) return
      this.setData({
        legalName: '',
        idCardNumber: '',
        submissionResult: result
      })
      wx.showToast({ title: result.message, icon: 'success' })
      await this.loadPage()
    } catch (error) {
      if (!this.isCurrent(epoch, session)) return
      const message = error.message || '实名认证提交失败，请稍后重新查询状态'
      this.setData({ submissionError: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this._submission = false
      if (this._visible && wx.getStorageSync('zion_runtime_token') === session) {
        this.setData({ submitting: false })
        // A returning page needs the authoritative result of the old request.
        if (this._epoch !== epoch) this.loadPage()
      }
    }
  }
})
