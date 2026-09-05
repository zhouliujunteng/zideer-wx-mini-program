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
    submissionResult: null
  },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ identity: buildPageData(await loadCurrentIdentityVerification()) })
    } catch (error) {
      if (isAuthenticationRequired(error)) return
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '实名认证状态加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
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
    if (this.data.submitting) return
    this.setData({ submitting: true, submissionResult: null })
    try {
      const result = await submitCurrentGuardianIdentityVerification({
        name: this.data.legalName,
        idCardNumber: this.data.idCardNumber
      })
      this.setData({
        legalName: '',
        idCardNumber: '',
        submissionResult: result
      })
      wx.showToast({ title: result.message, icon: 'success' })
      await this.loadPage()
    } catch (error) {
      wx.showToast({ title: error.message || '实名认证提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
